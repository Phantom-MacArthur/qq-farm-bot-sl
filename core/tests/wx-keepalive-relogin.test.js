const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const sourcePath = path.join(__dirname, '../src/services/wx-keepalive.ts');
const { outputText } = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});

function fixture(t) {
    const interval = 5 * 60_000;
    let now = 1_000_000;
    const timers = new Set();
    const states = new Map();
    const calls = [];
    const account = { id: '1', name: 'Test', platform: 'wx', loginBuffer: 'buffer', refreshtoken: 'refresh' };
    const config = { offlineEnabled: true, offlineDelaySeconds: 60 };
    const result = { next: () => Promise.resolve({ ok: false, error: 'temporary failure' }) };
    let online = false;
    let startWorks = true;
    class Clock extends Date {
        static now() { return now; }
    }
    const dependencies = {
        '../models/store': { getAccounts: () => ({ accounts: [account] }), getSystemConfig: () => ({ autoCodeRefresh: config }) },
        '../config/config': {
            normalizeAutoCodeRefresh: input => input,
            DEFAULT_AUTO_CODE_REFRESH: config,
            OFFLINE_RECONNECT_INTERVAL_SECONDS: interval / 1000,
        },
        './wx-credential': {
            hasWxCredential: entry => !!entry?.refreshtoken,
            renewOAuthToken: async () => { calls.push(['oauth', now]); return { ok: true }; },
            ensureFreshGameCode: () => { calls.push(['code', now]); return result.next(); },
        },
        './qq-credential': {
            isQqCodeRefreshConfigured: () => true,
            tryRefreshQqGameCode: () => { calls.push(['qq-code', now]); return result.next(); },
        },
        './code-watch': { inspectAccountCodeHealth: () => ({ remainingMs: 0 }) },
        './wx-login/recovery-policy': {},
        './account-runtime-state': { setAccountRuntimeState: (id, state, extra) => states.set(id, { state, ...extra }) },
    };
    const module = { exports: {} };
    vm.runInNewContext(outputText, {
        module, exports: module.exports, Date: Clock,
        require: name => dependencies[name],
        setTimeout(callback, delay) {
            const handle = { callback, dueAt: now + delay };
            timers.add(handle);
            return handle;
        },
        clearTimeout: handle => timers.delete(handle),
        setInterval: () => ({}),
        clearInterval: () => {},
    });
    const service = module.exports;
    service.startWxKeepAlive({
        isAccountRunning: () => online,
        restartWorker: () => { calls.push(['start', now]); return startWorks; },
    });
    t.after(() => service.stopWxKeepAlive());
    return {
        service, account, config, calls, result, interval, timers,
        setOnline: value => { online = value; },
        setStartWorks: value => { startWorks = value; },
        state: () => states.get('1')?.state,
        advance: (ms) => {
            now += ms;
            const handle = [...timers].find(entry => entry.dueAt <= now);
            if (!handle) return undefined;
            timers.delete(handle);
            return handle.callback();
        },
    };
}

test('微信掉线每五分钟换码，重复掉线去重，持续失败不停止重登', async (t) => {
    const f = fixture(t);
    f.service.notifyAccountOffline('1', 'disconnect');
    f.service.notifyAccountOffline('1', 'ws_400');
    assert.equal(f.timers.size, 1);
    assert.equal(f.state(), 'relogin_waiting');
    assert.equal(f.advance(f.interval - 1), undefined);
    await f.advance(1);
    for (let attempts = 1; attempts < 14; attempts++) await f.advance(f.interval);
    assert.equal(f.calls.length, 14);
    assert.equal(f.calls[0][0], 'code');
    assert.equal(f.calls[13][1] - f.calls[0][1], 13 * f.interval);
    f.result.next = async () => ({ ok: true });
    f.setStartWorks(false);
    await f.advance(f.interval);
    assert.equal(f.timers.size, 1);
    f.setStartWorks(true);
    await f.advance(f.interval);
    assert.deepEqual(f.calls.slice(-2).map(([kind]) => kind), ['code', 'start']);
    assert.equal(f.timers.size, 0);
});

test('手动停止撤销等待中和已经开始换码的自动重登', async (t) => {
    const f = fixture(t);
    f.service.notifyAccountOffline('1');
    assert.equal(f.service.cancelPendingRelogin('1'), true);
    assert.equal(f.advance(f.interval), undefined);
    let finish;
    f.result.next = () => new Promise(resolve => { finish = resolve; });
    f.service.notifyAccountOffline('1');
    const active = f.advance(f.interval);
    assert.equal(f.service.cancelPendingRelogin('1'), true);
    finish({ ok: true });
    await active;
    assert.deepEqual(f.calls.map(([kind]) => kind), ['code']);
    assert.equal(f.timers.size, 0);
});

test('已在线只续 OAuth，明确要重扫的账号停止自动重登', async (t) => {
    const f = fixture(t);
    f.setOnline(true);
    await f.service.runCodePreflight();
    assert.deepEqual(f.calls.map(([kind]) => kind), ['oauth']);

    f.setOnline(false);
    f.result.next = async () => ({ ok: false, needsRescan: true, error: 'revoked' });
    f.service.notifyAccountOffline('1');
    await f.advance(f.interval);
    assert.equal(f.state(), 'offline');
    assert.equal(f.timers.size, 0);
    assert.deepEqual(f.calls.map(([kind]) => kind), ['oauth', 'code']);
});

test('QQ 用新 Code 重登，NapCat 会话失效则结束自动重登', async (t) => {
    const f = fixture(t);
    f.account.platform = 'qq';
    f.result.next = async () => ({ ok: true });
    f.service.notifyAccountOffline('1');
    await f.advance(f.interval);
    assert.deepEqual(f.calls.map(([kind]) => kind), ['qq-code', 'start']);
    f.result.next = async () => ({ ok: false, needsRescan: true });
    f.service.notifyAccountOffline('1');
    await f.advance(f.interval);
    assert.deepEqual(f.calls.map(([kind]) => kind), ['qq-code', 'start', 'qq-code']);
    assert.equal(f.state(), 'offline');
    assert.equal(f.timers.size, 0);
});
