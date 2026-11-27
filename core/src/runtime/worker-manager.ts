export {};
const { createScheduler } = require('../services/scheduler');
const { getAccountRuntimeState, setAccountRuntimeState } = require('../services/account-runtime-state');

const { BackendChildTracker } = require('@qq-farm-bot/session-contract');
const { accountSessionKey, findAccountSession, listHostedSessions, stopHostedAccount } = require('../session/ipc');
const { getRuntimePaths } = require('../config/runtime-paths');
const path = require('node:path');

const DEFAULT_API_CALL_TIMEOUT_MS = 10000;
const STORED_CODE_RETRY_DELAY_MS = 3000;
const STORED_CODE_RETRY_WINDOW_MS = 10 * 60_000;
// 好友现场天气需要逐个 Enter/Leave，单批最多 5 位好友；
// 好友列表只读缓存或拉一次名单，给的余量少一些。
const API_CALL_TIMEOUTS_MS: Record<string, number> = {
    getPetDiary: 90000,
    operatePetDiary: 180000,
    getPetDiaryRecords: 30000,
    getPetDiaryFriend: 30000,
    scanWeatherFriends: 60000,
    getWeatherFriends: 30000,
    clearRanchIllustratedNew: 40000,
};

interface WorkerManagerOptions {
    fork: any;
    WorkerThread: any;
    runtimeMode?: string;
    processRef: any;
    mainEntryPath: string;
    workerScriptPath: string;
    workers: Record<string, any>;
    globalLogs: any[];
    log: (tag: string, msg: string, extra?: any) => void;
    addAccountLog: (action: string, msg: string, accountId?: string, accountName?: string, extra?: any) => void;
    normalizeStatusForPanel: (data: any, accountId: string, accountName: string) => any;
    buildConfigSnapshotForAccount: (accountId: string) => any;
    triggerOfflineReminder: (payload: any) => void;
    sendConfiguredPush?: (payload: any) => Promise<void> | void;
    addOrUpdateAccount: (acc: any) => any;
    deleteAccount: (id: string) => void;
    getAccount?: (id: string) => any;
    onStatusSync?: (accountId: string, status: any, accountName?: string) => void;
    onWorkerLog?: (entry: any, accountId: string, accountName?: string) => void;
    /** 账号掉线（断开 / 被踢下线）时回调，供账号保活安排自动重登。 */
    onAccountOffline?: (accountId: string, accountName: string, reason: string) => void;
}

function createWorkerManager(options: WorkerManagerOptions) {
    const {
        fork,
        WorkerThread,
        runtimeMode = 'thread',
        processRef,
        mainEntryPath,
        workerScriptPath,
        workers,
        globalLogs,
        log,
        addAccountLog,
        normalizeStatusForPanel,
        buildConfigSnapshotForAccount,
        triggerOfflineReminder,
        sendConfiguredPush,
        addOrUpdateAccount,
        getAccount,
        onStatusSync,
        onWorkerLog,
        onAccountOffline,
    } = options;

    function notifyOffline(accountId: string, accountName: string, reason: string): void {
        if (typeof onAccountOffline !== 'function') return;
        try {
            onAccountOffline(accountId, accountName, reason);
        } catch {
            // 保活回调失败不能影响账号停止流程
        }
    }
    const managerScheduler = createScheduler('worker_manager');
    const pendingStoredCodeRetries = new Set<string>();
    const storedCodeAttempts = new Map<string, Map<string, number>>();
    const useThreadRuntime = runtimeMode === 'thread' && !(processRef as any).pkg && typeof WorkerThread === 'function';
    const managed = Boolean(processRef.env.FARM_SESSION_SOCKET);
    const tracker = managed && !useThreadRuntime ? new BackendChildTracker(path.join(getRuntimePaths().runtimeDir, 'backend-children.json')) : null;
    let shuttingDown = false;

    function createThreadWorker(account: any): any {
        const workerOptions: any = {
            workerData: {
                accountId: String(account.id || ''),
                channel: 'thread',
            },
        };
        // When running from source with tsx, configure worker to use tsx
        if (workerScriptPath.endsWith('.ts')) {
            workerOptions.execArgv = ['--require', 'tsx/cjs'];
        }
        const worker = new WorkerThread(workerScriptPath, workerOptions);
        worker.send = (payload: any) => worker.postMessage(payload);
        worker.kill = () => worker.terminate();
        return worker;
    }

    function createForkWorker(account: any): any {
        if ((processRef as any).pkg) {
            return fork(mainEntryPath, [], {
                execPath: processRef.execPath,
                stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
                env: { ...processRef.env, FARM_WORKER: '1', FARM_ACCOUNT_ID: String(account.id || '') },
            });
        }
        const forkOptions: any = {
            stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
            env: { ...processRef.env, FARM_ACCOUNT_ID: String(account.id || '') },
        };
        if (workerScriptPath.endsWith('.ts')) {
            forkOptions.execArgv = ['--require', 'tsx/cjs'];
        }
        return fork(workerScriptPath, [], forkOptions);
    }

    function createWorkerProcess(account: any): any {
        if (useThreadRuntime) return createThreadWorker(account);
        return createForkWorker(account);
    }

    function startWorker(account: any, sessionId?: string, retryingStoredCode = false): boolean {
        if (shuttingDown) return false;
        if (!account || !account.id) return false;
        if (workers[account.id]) return false;
        cancelStoredCodeRetry(String(account.id));

        log('系统', `正在启动账号: ${account.name}`, { accountId: String(account.id), accountName: account.name });

        let child: any = null;
        try {
            child = createWorkerProcess(account);
            tracker?.register(child.pid, 'account', String(account.id));
        } catch (err: any) {
            const reason = err && err.message ? err.message : String(err || 'unknown error');
            log('错误', `账号 ${account.name} 启动失败: ${reason}`, { accountId: String(account.id), accountName: account.name });
            addAccountLog('start_failed', `账号 ${account.name} 启动失败`, account.id, account.name, { reason });
            setAccountRuntimeState(account.id, 'offline');
            return false;
        }

        workers[account.id] = {
            process: child,
            accountKey: accountSessionKey(account),
            status: null,
            logs: [],
            requests: new Map(),
            reqId: 1,
            name: account.name,
            nick: account.nick || '',
            avatar: account.avatar || '',
            stopping: false,
            disconnectedSince: 0,
            terminalHandled: false,
            loginCode: account.code,
            wsError: null,
        };
        setAccountRuntimeState(account.id, 'logging_in');

        const initialConfigSnapshot = buildConfigSnapshotForAccount(account.id);
        child.send({
            type: 'start',
            config: {
                code: sessionId ? undefined : account.code,
                accountId: String(account.id), accountKey: accountSessionKey(account), sessionId,
                platform: account.platform,
                systemTimeZone: initialConfigSnapshot.systemTimeZone,
                systemServerUrl: initialConfigSnapshot.systemServerUrl,
                systemClientVersion: initialConfigSnapshot.systemClientVersion,
                systemWxClientVersion: initialConfigSnapshot.systemWxClientVersion,
                systemDeviceInfo: initialConfigSnapshot.systemDeviceInfo,
            },
        });
        child.send({ type: 'config_sync', config: initialConfigSnapshot });

        child.on('message', (msg: any) => {
            handleWorkerMessage(account.id, child, msg);
        });

        child.on('error', (err: any) => {
            log('系统', `账号 ${account.name} 子进程启动失败: ${err && err.message ? err.message : err}`, { accountId: String(account.id), accountName: account.name });
        });

        child.on('exit', (code: number, signal: string) => {
            tracker?.unregister(child.pid);
            const current = workers[account.id];
            if (!current || current.process !== child) return;
            const displayName = current.name || account.name;
            log('系统', `账号 ${displayName} 进程退出 (code=${code}, signal=${signal || 'none'})`, {
                accountId: String(account.id),
                accountName: displayName,
                runtimeMode: useThreadRuntime ? 'thread' : 'fork',
            });

            managerScheduler.clear(`force_kill_${account.id}`);
            managerScheduler.clear(`restart_fallback_${account.id}`);

            rejectWorkerRequests(account.id, current, Object.assign(new Error('Worker exited'), { code: 'ACCOUNT_OFFLINE' }));

            if (current && current.process === child) {
                delete workers[account.id];
                syncYishuShopAccounts();
                if (current.stopping) {
                    setAccountRuntimeState(account.id, 'stopped', { onlyFrom: ['stopping'] });
                } else if (!current.terminalHandled) {
                    setAccountRuntimeState(account.id, 'offline', { onlyFrom: ['logging_in', 'running'] });
                    if (retryingStoredCode) notifyOffline(account.id, displayName, 'stored_code_retry_failed');
                }
            }
        });
        return true;
    }

    function rejectWorkerRequests(accountId: string, worker: any, error: Error): void {
        for (const [reqId, req] of worker.requests.entries()) {
            managerScheduler.clear(`api_timeout_${accountId}_${reqId}`);
            req.reject(error);
        }
        worker.requests.clear();
    }

    function stopWorker(accountId: string): void {
        cancelStoredCodeRetry(accountId);
        const worker = workers[accountId];
        if (!worker) return;

        const proc = worker.process;
        worker.stopping = true;
        if (!worker.terminalHandled) setAccountRuntimeState(accountId, 'stopping');
        rejectWorkerRequests(accountId, worker, Object.assign(new Error('账号已离线'), { code: 'ACCOUNT_OFFLINE' }));
        worker.process.send({ type: 'stop' });
        managerScheduler.setTimeoutTask(`force_kill_${accountId}`, 1000, () => {
            const current = workers[accountId];
            if (current && current.process === proc) {
                current.process.kill();
                delete workers[accountId];
                setAccountRuntimeState(accountId, 'stopped', { onlyFrom: ['stopping'] });
            }
        });
    }

    // 先停止本实例的业务工作进程。只有面板显式停止账号才关闭游戏连接。
    function endWorker(worker: any, type: 'stop' | 'detach'): Promise<void> {
        worker.stopping = true;
        const child = worker.process;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => { child.kill(); }, 2500);
            const onExit = () => { clearTimeout(timer); resolve(); };
            child.once('exit', onExit);
            if (child.exitCode != null || child.signalCode) { onExit(); return; }
            try { child.send({ type }); }
            catch (err) { if (child.connected !== false) { clearTimeout(timer); child.off('exit', onExit); reject(err); } }
        });
    }

    async function startAccountWorker(account: any) {
        if (!managed || workers[account.id]) return startWorker(account);
        const session = findAccountSession(await listHostedSessions(), account);
        return startWorker(account, session?.sessionId);
    }

    async function stopAccountWorker(account: any) {
        cancelStoredCodeRetry(String(account.id));
        if (!managed) { stopWorker(account.id); return; }
        const worker = workers[account.id];
        const key = worker?.accountKey || accountSessionKey(account);
        if (worker) await endWorker(worker, 'stop');
        await stopHostedAccount(String(account.id), key);
    }

    async function detachAllWorkers() {
        shuttingDown = true;
        cancelAllStoredCodeRetries();
        await Promise.all(Object.values(workers).map(worker => endWorker(worker, 'detach')));
    }

    function cancelStoredCodeRetry(accountId: string): void {
        pendingStoredCodeRetries.delete(accountId);
        managerScheduler.clear(`stored_code_retry_${accountId}`);
    }

    function cancelAllStoredCodeRetries(): void {
        for (const accountId of pendingStoredCodeRetries) cancelStoredCodeRetry(accountId);
        storedCodeAttempts.clear();
    }

    function scheduleStoredCodeRetry(accountId: string, accountName: string, loginCode: unknown, reason: string): boolean {
        if (!getAccount || typeof loginCode !== 'string' || !loginCode || getAccount(accountId)?.code !== loginCode) return false;
        const now = Date.now();
        const attempts = storedCodeAttempts.get(accountId) ?? new Map<string, number>();
        for (const [code, at] of attempts) if (now - at >= STORED_CODE_RETRY_WINDOW_MS) attempts.delete(code);
        if (attempts.has(loginCode)) return false;
        pendingStoredCodeRetries.add(accountId);
        setAccountRuntimeState(accountId, 'relogin_waiting', { reloginAt: now + STORED_CODE_RETRY_DELAY_MS });
        managerScheduler.setTimeoutTask(`stored_code_retry_${accountId}`, STORED_CODE_RETRY_DELAY_MS, () => {
            pendingStoredCodeRetries.delete(accountId);
            if (shuttingDown) return;
            const latest = getAccount(accountId);
            if (!latest || latest.code !== loginCode) return;
            attempts.set(loginCode, Date.now());
            storedCodeAttempts.set(accountId, attempts);
            if (!startWorker(latest, undefined, true)) {
                notifyOffline(accountId, accountName, reason);
            }
        });
        return true;
    }

    function restartWorker(account: any): void | Promise<void> {
        if (managed && account) return stopAccountWorker(account).then(() => { startWorker(account); });
        if (!account) return;
        const accountId = account.id;
        const worker = workers[accountId];
        if (!worker) { startWorker(account); return; }
        const proc = worker.process;
        let started = false;
        const startOnce = () => {
            if (started) return;
            started = true;
            managerScheduler.clear(`restart_fallback_${accountId}`);
            const current = workers[accountId];
            if (!current) { startWorker(account); return; }
            if (current.process !== proc) return;
            delete workers[accountId];
            startWorker(account);
        };
        const killIfStale = () => {
            const current = workers[accountId];
            if (!current || current.process !== proc) return false;
            try {
                current.process.kill();
            } catch {}
            delete workers[accountId];
            return true;
        };
        if (typeof proc.exitCode === 'number' || proc.signalCode) {
            startOnce();
            return;
        }
        proc.once('exit', startOnce);
        stopWorker(accountId);
        managerScheduler.setTimeoutTask(`restart_fallback_${accountId}`, 1500, () => {
            if (started) return;
            killIfStale();
            startOnce();
        });
    }

    function errorFromWorkerPayload(payload: any): Error & { code?: string | number; errorMessage?: string } {
        if (!payload || typeof payload !== 'object') return new Error(String(payload || 'Worker API error'));
        const error: Error & { code?: string | number; errorMessage?: string } = new Error(String(payload.message || 'Worker API error'));
        if (payload.name) error.name = String(payload.name);
        if (payload.code !== undefined && payload.code !== null && payload.code !== '') error.code = payload.code;
        const protocolMessage = payload.errorMessage ?? payload.error_message;
        if (protocolMessage !== undefined && protocolMessage !== null) error.errorMessage = String(protocolMessage);
        return error;
    }

    function syncYishuShopAccounts(): void {
        const online = Object.values(workers).flatMap((worker: any) => {
            const profile = worker.status?.status;
            const gid = String(profile?.gid || '');
            if (worker.stopping || worker.terminalHandled || !worker.status?.connection?.connected || !/^[1-9]\d*$/.test(gid)) return [];
            const platform = profile.platform === 'wechat' ? 'wx' : profile.platform;
            return [{ worker, platform, shop: { gid, name: String(worker.name || profile.name || gid), avatar: String(profile.avatarUrl || ''), level: String(profile.level || '0') } }];
        });
        for (const entry of online) {
            const accounts = online.filter(peer => peer.platform === entry.platform && peer.shop.gid !== entry.shop.gid).map(peer => peer.shop);
            const key = JSON.stringify(accounts);
            if (entry.worker.yishuShopAccountsKey === key) continue;
            try {
                entry.worker.process.send({ type: 'yishu_shop_accounts', accounts });
                entry.worker.yishuShopAccountsKey = key;
            } catch { /* Worker may have stopped since the status snapshot. */ }
        }
    }

    function handleWorkerMessage(accountId: string, sourceProcess: any, msg: any): void {
        const worker = workers[accountId];
        if (!worker || worker.process !== sourceProcess) return;

        if (msg.type === 'status_sync') {
            worker.status = normalizeStatusForPanel(msg.data, accountId, worker.name);
            const connected = msg.data?.connection?.connected === true;
            if (!worker.stopping && !worker.terminalHandled) {
                const previous = getAccountRuntimeState(accountId)?.state;
                if (connected && previous !== 'running') setAccountRuntimeState(accountId, 'running');
                if (!connected && previous === 'running') setAccountRuntimeState(accountId, 'offline');
            }
            syncYishuShopAccounts();
            if (typeof onStatusSync === 'function') {
                onStatusSync(accountId, worker.status, worker.name);
            }

            const profile = msg.data && msg.data.status && typeof msg.data.status === 'object'
                ? msg.data.status
                : {};
            const accountUpdate: any = { id: accountId };
            let profileChanged = false;

            if (profile.name) {
                const newNick = String(profile.name).trim();
                if (newNick && newNick !== '未知' && newNick !== '未登录') {
                    if (worker.nick !== newNick) {
                        const oldNick = worker.nick;
                        worker.nick = newNick;
                        accountUpdate.nick = newNick;
                        profileChanged = true;
                        if (oldNick !== newNick) {
                            log('系统', `已同步账号昵称: ${oldNick || 'None'} -> ${newNick}`, { accountId, accountName: worker.name });
                        }
                    }
                }
            }

            const newAvatar = String(profile.avatarUrl || profile.avatar_url || '').trim();
            if (newAvatar && worker.avatar !== newAvatar) {
                worker.avatar = newAvatar;
                accountUpdate.avatar = newAvatar;
                profileChanged = true;
            }

            if (profileChanged) {
                addOrUpdateAccount(accountUpdate);
            }

            if (connected) {
                worker.disconnectedSince = 0;
                worker.wsError = null;
            }
        } else if (msg.type === 'log') {
            const logEntry = {
                ...msg.data,
                accountId,
                accountName: worker.name,
                ts: Date.now(),
                meta: msg.data && msg.data.meta ? msg.data.meta : {},
            };
            logEntry._searchText = `${logEntry.msg || ''} ${logEntry.tag || ''} ${JSON.stringify(logEntry.meta || {})}`.toLowerCase();
            worker.logs.push(logEntry);
            if (worker.logs.length > 1000) worker.logs.shift();
            globalLogs.push(logEntry);
            if (globalLogs.length > 1000) globalLogs.shift();
            if (typeof onWorkerLog === 'function') {
                onWorkerLog(logEntry, accountId, worker.name);
            }
        } else if (msg.type === 'error') {
            const workerError = errorFromWorkerPayload(msg.error);
            log('错误', `账号[${accountId}]进程报错: ${workerError.message}`, {
                accountId: String(accountId),
                accountName: worker.name,
                errorCode: workerError.code,
                errorName: workerError.name,
            });
        } else if (msg.type === 'ws_error') {
            const code = Number(msg.code) || 0;
            const message = msg.message || '';
            worker.wsError = { code, message, at: Date.now() };
            if (code === 400) {
                addAccountLog(
                    'ws_400',
                    `账号 ${worker.name} 登录失效，请更新 Code`,
                    accountId,
                    worker.name,
                );
                if (!worker.stopping) {
                    if (worker.status?.connection) worker.status.connection.connected = false;
                    setAccountRuntimeState(accountId, 'offline', { onlyFrom: ['logging_in', 'running'] });
                    notifyOffline(accountId, worker.name, 'ws_400');
                }
            }
        } else if (msg.type === 'account_kicked') {
            if (worker.terminalHandled || worker.stopping) return;
            worker.terminalHandled = true;
            if (worker.status?.connection) worker.status.connection.connected = false;
            setAccountRuntimeState(accountId, 'offline', { onlyFrom: ['logging_in', 'running'] });
            const reason = msg.reason || '未知';
            const reasonCode = Number(msg.reasonCode) || 0;
            const diagnostics = msg.diagnostics || null;
            rejectWorkerRequests(accountId, worker, Object.assign(new Error('账号被踢下线'), { code: 'GAME_OFFLINE' }));
            log('系统', `账号 ${worker.name} 被踢下线，已自动停止账号`, { accountId: String(accountId), accountName: worker.name, reasonCode, diagnostics });
            triggerOfflineReminder({
                accountId,
                accountName: worker.name,
                reason: `kickout:${reason}`,
                offlineMs: 0,
            });
            addAccountLog('kickout_stop', `账号 ${worker.name} 被踢下线，已自动停止`, accountId, worker.name, { reason, reasonCode, diagnostics });
            stopWorker(accountId);
            notifyOffline(accountId, worker.name, `kickout:${reason}`);
        } else if (msg.type === 'account_disconnected') {
            if (worker.terminalHandled || worker.stopping) return;
            worker.terminalHandled = true;
            const source = String(msg.source || 'ws_close');
            const code = Number(msg.code) || 0;
            const reason = String(msg.reason || '连接已断开');
            const phase = String(msg.phase || 'unknown');
            if (worker.status?.connection) worker.status.connection.connected = false;
            setAccountRuntimeState(accountId, 'offline', { onlyFrom: ['logging_in', 'running'] });
            rejectWorkerRequests(accountId, worker, Object.assign(new Error('账号连接已断开'), { code: 'GAME_OFFLINE' }));
            log('系统', `账号 ${worker.name} 连接已断开，已停止运行并等待 Helper 刷新 Code 或重新扫码`, {
                accountId: String(accountId),
                accountName: worker.name,
                source,
                disconnectCode: code,
                phase,
                reason,
                diagnostics: msg.diagnostics || null,
            });
            triggerOfflineReminder({
                accountId,
                accountName: worker.name,
                reason: `disconnect:${source}:${phase}:${code}`,
                offlineMs: 0,
            });
            addAccountLog(
                'disconnect_stop',
                `账号 ${worker.name} 连接已断开，已停止运行并等待 Helper 刷新 Code 或重新扫码`,
                accountId,
                worker.name,
                { source, disconnectCode: code, reason, phase, connectionId: Number(msg.connectionId) || 0, diagnostics: msg.diagnostics || null },
            );
            stopWorker(accountId);
            const recoveryReason = `disconnect:${source}:${phase}:${code}`;
            if (phase === 'online' && code !== 400 && worker.wsError?.code !== 400 && ['ws_close', 'ws_error'].includes(source)
                && scheduleStoredCodeRetry(accountId, worker.name, worker.loginCode, recoveryReason)) return;
            notifyOffline(accountId, worker.name, recoveryReason);
        } else if (msg.type === 'api_response') {
            const { id, result, error } = msg;
            managerScheduler.clear(`api_timeout_${accountId}_${id}`);
            const req = worker.requests.get(id);
            if (req) {
                if (error) req.reject(errorFromWorkerPayload(error));
                else req.resolve(result);
                worker.requests.delete(id);
            }
        } else if (msg.type === 'ranch_friend_blacklist_add') {
            const gid = Number(msg.gid);
            if (!Number.isSafeInteger(gid) || gid <= 0) return;
            try {
                const { addRanchFriendToBlacklist } = require('../models/store');
                if (!addRanchFriendToBlacklist(accountId, gid)) return;
                worker.process.send({ type: 'config_sync', config: buildConfigSnapshotForAccount(accountId) });
                log('牧场', `${msg.friendName || '未命名好友'} 不是好友，已加入牧场黑名单`, {
                    accountId: String(accountId), accountName: worker.name, module: 'ranch', event: 'ranch_friend_blacklist', result: 'ok',
                });
            } catch (error: any) {
                log('牧场', `同步牧场黑名单失败：${error.message}`, {
                    accountId: String(accountId), accountName: worker.name, module: 'ranch', event: 'ranch_friend_blacklist', result: 'error',
                });
            }
        } else if (msg.type === 'friend_blacklist_add') {
            const gid = Number(msg.gid) || 0;
            if (gid > 0) {
                const { addFriendToBlacklist: addToBlacklist } = require('../models/store');
                addToBlacklist(accountId, gid);
                log('好友', `已将好友 ${msg.friendName || '未命名好友'} 加入黑名单`, {
                    accountId: String(accountId),
                    accountName: worker.name,
                    friendGid: gid,
                    friendName: msg.friendName,
                    reason: msg.reason,
                });
                const targetWorker = workers[accountId];
                if (targetWorker && targetWorker.process) {
                    targetWorker.process.send({ type: 'config_sync', config: buildConfigSnapshotForAccount(accountId) });
                }
            }
        } else if (msg.type === 'known_friend_gids_sync') {
            const { setKnownFriendGids } = require('../models/store');
            const gids: number[] = Array.isArray(msg.gids)
                ? msg.gids.map(Number).filter((gid: number) => Number.isFinite(gid) && gid > 0)
                : [];
            const saved: number[] = setKnownFriendGids(accountId, gids);
            worker.process.send({
                type: 'config_sync',
                config: buildConfigSnapshotForAccount(accountId),
            });
            log('好友', `已同步并持久化 ${saved.length} 个好友 GID`, {
                accountId: String(accountId),
                accountName: worker.name,
                friendCount: saved.length,
            });
        } else if (msg.type === 'push_notify') {
            if (!Array.isArray(msg.candidates) || typeof sendConfiguredPush !== 'function') return;
            Promise.resolve(sendConfiguredPush({
                candidates: msg.candidates,
                accountId,
                accountName: worker.name,
            })).catch((e: any) => {
                log('错误', `事件提醒发送异常: ${e && e.message ? e.message : e}`);
            });
        } else if (msg.type === 'known_friend_gid_remove') {
            const { getKnownFriendGids, setKnownFriendGids } = require('../models/store');
            const gid: number = Number(msg.gid) || 0;
            if (gid > 0) {
                const current: number[] = getKnownFriendGids(accountId);
                setKnownFriendGids(accountId, current.filter((item: number) => Number(item) !== gid));
                worker.process.send({
                    type: 'config_sync',
                    config: buildConfigSnapshotForAccount(accountId),
                });
            }
        }
    }

    function callWorkerApi(accountId: string, method: string, ...args: any[]): Promise<any> {
        const worker = workers[accountId];
        if (!worker) return Promise.reject(Object.assign(new Error('账号未运行'), { code: 'ACCOUNT_OFFLINE' }));
        if (worker.terminalHandled) return Promise.reject(Object.assign(new Error('账号连接已断开'), { code: 'GAME_OFFLINE' }));
        if (worker.stopping) return Promise.reject(Object.assign(new Error('账号已离线'), { code: 'ACCOUNT_OFFLINE' }));

        return new Promise((resolve, reject) => {
            const id = worker.reqId++;
            worker.requests.set(id, { resolve, reject });

            const timeoutMs = API_CALL_TIMEOUTS_MS[method] || DEFAULT_API_CALL_TIMEOUT_MS;
            managerScheduler.setTimeoutTask(`api_timeout_${accountId}_${id}`, timeoutMs, () => {
                if (worker.requests.has(id)) {
                    worker.requests.delete(id);
                    reject(new Error('API Timeout'));
                }
            });

            worker.process.send({ type: 'api_call', id, method, args });
        });
    }

    return {
        startWorker,
        stopWorker,
        restartWorker,
        cancelStoredCodeRetry, cancelAllStoredCodeRetries,
        callWorkerApi, startAccountWorker, stopAccountWorker, detachAllWorkers,
    };
}

module.exports = {
    createWorkerManager,
};
