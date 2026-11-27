const assert = require('node:assert/strict');
const test = require('node:test');
const EventEmitter = require('node:events');

const { createWorkerManager } = require('../dist/runtime/worker-manager');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 用假子进程验证掉线通知、旧进程释放与后续恢复入口。
 */
function setup(getAccount) {
    const workers = {};
    const children = [];
    const reminders = [];
    const offlineEvents = [];
    const accountLogs = [];
    const lines = [];

    function makeChild(label) {
        const child = new EventEmitter();
        child.sent = [];
        child.kills = 0;
        child.exitCode = null;
        child.signalCode = null;
        child.label = label;
        child.send = (msg) => child.sent.push(msg);
        child.kill = () => {
            child.kills += 1;
            child.exitCode = 0;
            child.emit('exit', 0, null);
            return true;
        };
        return child;
    }

    const manager = createWorkerManager({
        fork: (script, args, forkOptions) => {
            const child = makeChild(children.length);
            child.startMessage = forkOptions.env.FARM_ACCOUNT_ID;
            children.push(child);
            return child;
        },
        WorkerThread: function FakeThread() {},
        runtimeMode: 'fork',
        processRef: { env: {}, execPath: process.execPath },
        mainEntryPath: 'main.js',
        workerScriptPath: 'dist/core/worker.js',
        workers,
        globalLogs: [],
        log: (tag, message) => lines.push(message),
        addAccountLog: (action, message, accountId) => accountLogs.push({ action, message, accountId }),
        normalizeStatusForPanel: (data) => data || {},
        buildConfigSnapshotForAccount: () => ({
            systemTimeZone: 'Asia/Shanghai',
            systemServerUrl: 'wss://example',
            systemClientVersion: '1.14.1.10_20260916',
        }),
        getOfflineAutoDeleteMs: () => 3600000,
        triggerOfflineReminder: (payload) => reminders.push(payload),
        onAccountOffline: (...args) => offlineEvents.push(args),
        addOrUpdateAccount: () => ({}),
        deleteAccount: () => ({}),
        getAccount,
    });

    function lastConfigCode() {
        const child = children[children.length - 1];
        const start = child.sent.find((m) => m.type === 'start');
        return start ? start.config.code : '';
    }

    function disconnect(child, payload) {
        child.emit('message', { type: 'account_disconnected', reason: 'x', ...payload });
        child.emit('exit', 0, null);
    }

    return { manager, workers, children, reminders, offlineEvents, accountLogs, lines, lastConfigCode, disconnect };
}

const ONLINE_DROP = { source: 'ws_close', code: 1006, phase: 'online' };

test('only connected same-platform peer shops are announced to each worker', () => {
    const ctx = setup();
    for (const [id, platform] of [['A', 'wx'], ['B', 'wx'], ['C', 'qq']]) {
        ctx.manager.startWorker({ id, name: `Account ${id}`, code: `CODE-${id}`, platform });
    }
    function status(index, gid, platform, connected = true) {
        ctx.children[index].emit('message', { type: 'status_sync', data: { status: { gid, platform }, connection: { connected } } });
    }
    const announced = index => ctx.children[index].sent.filter(msg => msg.type === 'yishu_shop_accounts').at(-1).accounts.map(shop => shop.gid);
    status(0, '101', 'wx');
    status(1, '102', 'wx');
    status(2, '103', 'qq');
    assert.deepEqual(announced(0), ['102']);
    assert.deepEqual(announced(1), ['101']);
    assert.deepEqual(announced(2), []);
    status(1, '102', 'wx', false);
    assert.deepEqual(announced(0), []);
});

test('在线连接断开后停止旧进程并报告掉线，等待新的登录凭据', async () => {
    const ctx = setup();
    ctx.manager.startWorker({ id: 'A', name: '沐月-QQ', code: 'CODE-1', platform: 'qq' });
    assert.equal(ctx.children.length, 1);

    ctx.disconnect(ctx.children[0], ONLINE_DROP);
    assert.ok(ctx.children[0].sent.some((m) => m.type === 'stop'), '旧进程要被停掉');
    assert.equal(ctx.reminders.length, 1);
    assert.equal(ctx.reminders[0].reason, 'disconnect:ws_close:online:1006');
    assert.deepEqual(ctx.offlineEvents, [['A', '沐月-QQ', 'disconnect:ws_close:online:1006']]);
    assert.match(ctx.lines.join('\n'), /等待 Helper 刷新 Code 或重新扫码/);
    await sleep(60);
    assert.equal(ctx.children.length, 1);
});

test('普通断开只试一次原 Code，第二次断开交给换码流程', async () => {
    const account = { id: 'A', name: 'Account A', code: 'CODE-1', platform: 'qq' };
    const ctx = setup(() => account);
    ctx.manager.startWorker(account);
    ctx.disconnect(ctx.children[0], ONLINE_DROP);
    assert.equal(ctx.offlineEvents.length, 0);
    await sleep(3100);
    assert.equal(ctx.children.length, 2);
    assert.equal(ctx.lastConfigCode(), 'CODE-1');
    ctx.disconnect(ctx.children[1], ONLINE_DROP);
    assert.equal(ctx.offlineEvents.length, 1);
    assert.equal(ctx.offlineEvents[0][2], 'disconnect:ws_close:online:1006');
});

test('握手被拒（400 / phase=connecting）不重试：Code 本身已经无效', async () => {
    const ctx = setup();
    ctx.manager.startWorker({ id: 'A', name: '沐月-QQ', code: 'CODE-1', platform: 'qq' });
    ctx.disconnect(ctx.children[0], { source: 'ws_error', code: 400, phase: 'connecting' });
    await sleep(60);
    assert.equal(ctx.children.length, 1, '重发只会再吃一个 400');
    assert.equal(ctx.reminders.length, 1);
});

test('心跳判死（heartbeat_timeout / phase=online）不重试：实测三次都是拿原 Code 撞 400', async () => {
    const ctx = setup();
    ctx.manager.startWorker({ id: 'A', name: '沐月-QQ', code: 'CODE-1', platform: 'qq' });
    ctx.disconnect(ctx.children[0], { source: 'heartbeat_timeout', code: 0, phase: 'online' });
    await sleep(60);
    assert.equal(ctx.children.length, 1, '心跳判死之后服务端已经把会话作废，重发只是空转');
    assert.equal(ctx.reminders.length, 1, '直接按老路径交人工');
    assert.match(ctx.lines.join('\n'), /等待 Helper 刷新 Code 或重新扫码/);
});

test('登录阶段就断（phase=connecting, code=0）同样不重试', async () => {
    const ctx = setup();
    ctx.manager.startWorker({ id: 'A', name: '沐月-QQ', code: 'CODE-1', platform: 'qq' });
    ctx.disconnect(ctx.children[0], { source: 'login_timeout', code: 0, phase: 'connecting' });
    await sleep(60);
    assert.equal(ctx.children.length, 1);
    assert.equal(ctx.reminders.length, 1);
});

test('手动停止过程中收到断线事件时忽略自动恢复与下线提醒', async () => {
    const ctx = setup();
    ctx.manager.startWorker({ id: 'A', name: '沐月-QQ', code: 'CODE-1', platform: 'qq' });
    ctx.manager.stopWorker('A');
    ctx.disconnect(ctx.children[0], ONLINE_DROP);
    await sleep(60);
    assert.equal(ctx.children.length, 1, '用户刚停掉的账号不能被自动重启');
    assert.equal(ctx.reminders.length, 0);
    assert.equal(ctx.offlineEvents.length, 0);
});

test('手动换码后可用新 Code 启动账号', async () => {
    const ctx = setup();
    ctx.manager.startWorker({ id: 'A', name: '沐月-QQ', code: 'CODE-1', platform: 'qq' });
    ctx.disconnect(ctx.children[0], ONLINE_DROP);
    ctx.manager.restartWorker({ id: 'A', name: '沐月-QQ', code: 'CODE-2', platform: 'qq' });
    await sleep(20);
    assert.equal(ctx.children.length, 2);
    assert.equal(ctx.lastConfigCode(), 'CODE-2');
    assert.equal(ctx.reminders.length, 1);
});

test('被其他终端踢下线走 account_kicked，不参与原 Code 重试', async () => {
    const ctx = setup();
    ctx.manager.startWorker({ id: 'A', name: '沐月-QQ', code: 'CODE-1', platform: 'qq' });
    ctx.children[0].emit('message', { type: 'account_kicked', reason: '已在其他终端登录' });
    await sleep(60);
    assert.equal(ctx.children.length, 1, '和真人抢登录没有意义');
    assert.equal(ctx.reminders.length, 1);
    assert.match(ctx.reminders[0].reason, /^kickout:/);
});
