"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const { fork } = require('node:child_process');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const store = require('../models/store');
const { updateRuntimeConfig, getRuntimeConfig, getDefaultSystemConfig } = require('../config/config');
const { sendPushooMessage, sendWxPusherMessage, sendWxPusherWechatMessage } = require('../services/push');
const { createDataProvider } = require('./data-provider');
const { createReloginReminderService } = require('./relogin-reminder');
const { createRuntimeState } = require('./runtime-state');
const { createWorkerManager } = require('./worker-manager');
const { startWxKeepAlive, stopWxKeepAlive, applyWxKeepAliveConfig, notifyAccountOffline, cancelPendingRelogin } = require('../services/wx-keepalive');
const { ensureFreshGameCode } = require('../services/wx-credential');
const { recordAutoRefreshSuccess, recordAutoRefreshFailure } = require('../services/preflight-stats');
const { createQqBotPushService } = require('../services/qq-bot-push');
const { listHostedSessions, findAccountSession } = require('../session/ipc');
const OPERATION_KEYS = ['harvest', 'farming', 'fertilize', 'plant', 'steal', 'helpFarming', 'taskClaim', 'sell', 'upgrade'];
function createRuntimeEngine(options = {}) {
    const processRef = options.processRef || process;
    // Detect if running from source (tsx) or compiled (node)
    const isRunningFromSource = __dirname.includes(`${path.sep}src${path.sep}`);
    const fileExt = isRunningFromSource ? '.ts' : '.js';
    const mainEntryPath = options.mainEntryPath || path.join(__dirname, `../../client${fileExt}`);
    const workerScriptPath = options.workerScriptPath || path.join(__dirname, `../core/worker${fileExt}`);
    const runtimeMode = String(options.runtimeMode || processRef.env.FARM_RUNTIME_MODE || 'thread').toLowerCase();
    const onStatusSync = typeof options.onStatusSync === 'function' ? options.onStatusSync : null;
    const onLog = typeof options.onLog === 'function' ? options.onLog : null;
    const onAccountLog = typeof options.onAccountLog === 'function' ? options.onAccountLog : null;
    const startAdminServer = typeof options.startAdminServer === 'function' ? options.startAdminServer : null;
    const runtimeState = createRuntimeState({
        store,
        operationKeys: OPERATION_KEYS,
    });
    const { workers, globalLogs: GLOBAL_LOGS, accountLogs: ACCOUNT_LOGS, runtimeEvents, nextConfigRevision, buildConfigSnapshotForAccount, log, addAccountLog, normalizeStatusForPanel, buildDefaultStatus, filterLogs, } = runtimeState;
    const qqBotPush = createQqBotPushService({ store, log });
    const reloginReminder = createReloginReminderService({
        store,
        sendPushooMessage,
        sendWxPusherMessage,
        sendWxPusherWechatMessage,
        log,
    });
    const { triggerOfflineReminder, sendConfiguredPush, } = reloginReminder;
    const findAccount = (accountId) => store.getAccounts().accounts.find((account) => String(account.id) === accountId);
    const { startWorker, stopWorker, restartWorker, callWorkerApi, startAccountWorker, stopAccountWorker, detachAllWorkers, cancelStoredCodeRetry, cancelAllStoredCodeRetries } = createWorkerManager({
        fork,
        WorkerThread: Worker,
        runtimeMode,
        processRef,
        mainEntryPath,
        workerScriptPath,
        workers,
        globalLogs: GLOBAL_LOGS,
        log,
        addAccountLog,
        normalizeStatusForPanel,
        buildConfigSnapshotForAccount,
        triggerOfflineReminder: (payload) => {
            void triggerOfflineReminder(payload);
            void qqBotPush.sendOfflineNotification(payload);
        },
        sendConfiguredPush,
        addOrUpdateAccount: store.addOrUpdateAccount,
        getAccount: findAccount,
        deleteAccount: store.deleteAccount,
        onStatusSync: (accountId, status, accountName) => {
            const payload = { ...status, accountRuntime: dataProvider.getAccountRuntime(accountId) };
            runtimeEvents.emit('status', { accountId, status: payload, accountName });
            if (onStatusSync)
                onStatusSync(accountId, payload, accountName);
        },
        onWorkerLog: (entry, accountId, accountName) => {
            runtimeEvents.emit('worker_log', { entry, accountId, accountName });
            if (onLog)
                onLog(entry, accountId, accountName);
            qqBotPush.enqueueLog(entry, accountName, accountId);
        },
        onAccountOffline: (accountId, _accountName, reason) => {
            notifyAccountOffline(accountId, reason);
        },
    });
    function startAccountKeepAlive() {
        startWxKeepAlive({
            restartWorker: (account) => startWorker(account),
            isAccountRunning: (accountId) => workers[accountId]?.status?.connection?.connected === true,
            log,
            addAccountLog,
            // 自动续期账本：只记到期前预防 / 掉线重登，供账号卡片展示无人值守结果。
            recordPreflightResult: (accountId, ok, at) => {
                if (ok)
                    recordAutoRefreshSuccess(accountId, at);
                else
                    recordAutoRefreshFailure(accountId, at);
            },
        });
    }
    /** 系统配置里改了「掉线重登」后，把新策略读回来并写进系统日志。 */
    function applyAccountKeepAliveConfig() {
        applyWxKeepAliveConfig();
    }
    const dataProvider = createDataProvider({
        workers,
        globalLogs: GLOBAL_LOGS,
        accountLogs: ACCOUNT_LOGS,
        store,
        getAccounts: store.getAccounts,
        callWorkerApi,
        buildDefaultStatus,
        normalizeStatusForPanel,
        filterLogs,
        addAccountLog,
        nextConfigRevision,
        broadcastConfigToWorkers,
        buildConfigSnapshotForAccount,
        broadcastGameConfigReload,
        startWorker: startAccountWorker,
        stopWorker: stopAccountWorker,
        restartWorker,
        // 手动停止 / 启动 / 重启要先撤掉「等待重登」，否则定时器到点会把账号拉回来。
        cancelPendingRelogin: (accountId) => {
            cancelStoredCodeRetry(accountId);
            cancelPendingRelogin(accountId);
        },
        ensureFreshGameCode,
        applyAccountKeepAliveConfig,
    });
    runtimeEvents.on('log', (entry) => {
        if (onLog)
            onLog(entry, entry && entry.accountId ? entry.accountId : '', entry && entry.accountName ? entry.accountName : '');
    });
    runtimeEvents.on('account_log', (entry) => {
        if (onAccountLog)
            onAccountLog(entry);
    });
    function broadcastConfigToWorkers(targetAccountId = '') {
        const targetId = String(targetAccountId || '').trim();
        for (const [accId, worker] of Object.entries(workers)) {
            if (targetId && String(accId) !== targetId)
                continue;
            const snapshot = buildConfigSnapshotForAccount(accId);
            try {
                worker.process.send({ type: 'config_sync', config: snapshot });
            }
            catch {
                // ignore IPC failures for exited workers
            }
        }
    }
    function broadcastGameConfigReload() {
        for (const worker of Object.values(workers)) {
            try {
                worker.process.send({ type: 'reload_config' });
            }
            catch {
                // ignore IPC failures for exited workers
            }
        }
    }
    /**
     * 启动所有账号。
     *
     * 带持久化微信凭证的账号先刷一次 Code 再启动：隔夜后旧 Code 基本已经失效，
     * 直接启动只会白白挨一个 ws_400。刷新失败时退回用现有 Code 启动，
     * 让失效恢复链路接手，不阻断其他账号。
     */
    async function startAllAccounts() {
        const accounts = (store.getAccounts().accounts || []);
        if (accounts.length > 0) {
            log('系统', `发现 ${accounts.length} 个账号，正在启动...`);
            for (const acc of accounts)
                await dataProvider.startAccount(acc.id);
        }
        else {
            log('系统', '未发现账号，请访问管理面板添加账号');
        }
    }
    async function start(options = {}) {
        const shouldStartAdminServer = options.startAdminServer !== false;
        const shouldAutoStartAccounts = options.autoStartAccounts !== false;
        const savedSystemConfig = store.getSystemConfig();
        if (savedSystemConfig) {
            updateRuntimeConfig(savedSystemConfig);
            log('系统', `已加载系统配置: serverUrl=${savedSystemConfig.serverUrl}, clientVersion=${savedSystemConfig.clientVersion}, platform=${savedSystemConfig.platform}`);
        }
        if (shouldStartAdminServer && startAdminServer) {
            startAdminServer(dataProvider);
        }
        startAccountKeepAlive();
        qqBotPush.start();
        if (processRef.env.FARM_SESSION_SOCKET) {
            const sessions = await listHostedSessions();
            for (const account of store.getAccounts().accounts) {
                const session = findAccountSession(sessions, account);
                if (session)
                    startWorker(account, session.sessionId);
                else if (shouldAutoStartAccounts)
                    await dataProvider.startAccount(account.id);
            }
        }
        else if (shouldAutoStartAccounts) {
            await startAllAccounts();
        }
    }
    function stopAllAccounts() {
        cancelAllStoredCodeRetries();
        qqBotPush.stop();
        stopWxKeepAlive();
        for (const accountId of Object.keys(workers)) {
            stopWorker(accountId);
        }
    }
    return {
        store,
        runtimeEvents,
        workers,
        dataProvider,
        start,
        startAllAccounts,
        stopAllAccounts,
        startAccountKeepAlive,
        applyAccountKeepAliveConfig,
        detachAllWorkers: () => {
            stopWxKeepAlive();
            return detachAllWorkers();
        },
        broadcastConfigToWorkers,
        broadcastGameConfigReload,
        startWorker,
        stopWorker,
        restartWorker,
        callWorkerApi,
        log,
        addAccountLog,
    };
}
module.exports = {
    createRuntimeEngine,
};
//# sourceMappingURL=runtime-engine.js.map