const test = require('node:test');
const assert = require('node:assert/strict');

const { createAutoCodeRefreshService } = require('../dist/runtime/auto-code-refresh');
const { createDataProvider } = require('../dist/runtime/data-provider');
const { getSchedulerRegistrySnapshot } = require('../dist/services/scheduler');
const wxLoginAdapter = require('../dist/services/wx-login/adapter');

function taskNames() {
    const snapshot = getSchedulerRegistrySnapshot('auto_code_refresh');
    const scheduler = (snapshot.schedulers || [])[0];
    return ((scheduler && scheduler.tasks) || []).map(task => task.name);
}

function createService({ accounts, config = {}, controls = {}, saved = [], accountLogs = [], logs = [] }) {
    const service = createAutoCodeRefreshService({
        store: { getAutoCodeRefresh: () => config },
        getAccounts: () => ({ accounts }),
        addOrUpdateAccount: account => { saved.push(account); return { accounts }; },
        resolveWorkerControls: () => controls,
        log: (tag, message, extra) => logs.push({ tag, message, extra }),
        addAccountLog: (action, message, accountId, accountName, extra) => accountLogs.push({ action, message, accountId, extra }),
    });
    return { service, accounts, saved, accountLogs, logs };
}

test('QQ 账号在调度定时刷新时保持完全静默', () => {
    const { service, logs } = createService({
        accounts: [{ id: 'qq-1', name: 'QQ account', platform: 'qq' }],
    });

    service.scheduleAccount('qq-1');
    assert.deepEqual(logs, []);

    service.stopAccount('qq-1');
});

test('微信账号缺少 wxid 时记录可观测日志并且不调度', () => {
    const { service, logs } = createService({
        accounts: [{ id: 'wx-1', name: 'WeChat account', platform: 'wx' }],
        config: { enabled: true, intervalMinutes: 2, maxRetries: 8 },
    });

    service.scheduleAccount('wx-1');

    assert.equal(logs.length, 1);
    assert.equal(logs[0].message, '自动刷新 Code 未启动: 账号缺少 wxid');

    service.stopAccount('wx-1');
});

test('所有微信账号共用同一个全局刷新间隔', () => {
    const accounts = [
        { id: 'wx-1', name: 'WeChat one', platform: 'wx', wxid: 'wxid-1', loginBuffer: 'buffer-1', refreshtoken: 'refresh-1' },
        { id: 'wx-2', name: 'WeChat two', platform: 'wx', wxid: 'wxid-2', loginBuffer: 'buffer-2', refreshtoken: 'refresh-2' },
    ];
    const { service, logs } = createService({
        accounts,
        config: { enabled: true, intervalMinutes: 2, maxRetries: 100 },
    });

    service.rescheduleAll();
    service.stopAccount('wx-1');
    service.stopAccount('wx-2');

    const scheduled = logs.filter(entry => /自动刷新 Code 已启用/.test(entry.message));
    assert.equal(scheduled.length, 2);
    assert.match(scheduled[0].message, /间隔 2 分钟/);
    assert.match(scheduled[1].message, /间隔 2 分钟/);
});

test('刷新成功会写回新 Code 并重启 worker', async () => {
    const originalGetFarmCode = wxLoginAdapter.getFarmCode;
    const originalKeepAlive = wxLoginAdapter.keepWxCredentialAlive;
    wxLoginAdapter.getFarmCode = async () => ({ Success: true, Data: { code: 'fresh-code' } });
    wxLoginAdapter.keepWxCredentialAlive = async () => ({ Success: true });

    const account = { id: 'wx-1', name: 'WeChat one', platform: 'wx', wxid: 'wxid-1', loginBuffer: 'buffer', refreshtoken: 'refresh', code: 'stale-code' };
    const restarted = [];
    try {
        const { service, saved, accountLogs, logs } = createService({
            accounts: [account],
            config: { enabled: true, intervalMinutes: 2, maxRetries: 8 },
            controls: { restartWorker: () => { restarted.push(account.id); } },
        });

        assert.equal(await service.refreshAccountCode('wx-1', 'manual'), true);
        assert.equal(saved.length, 1);
        assert.equal(saved[0].code, 'fresh-code');
        assert.deepEqual(restarted, ['wx-1']);
        assert.equal(accountLogs[0].action, 'auto_code_refresh');
        assert.match(logs[0].message, /自动刷新 Code 成功/);
    }
    finally {
        wxLoginAdapter.getFarmCode = originalGetFarmCode;
        wxLoginAdapter.keepWxCredentialAlive = originalKeepAlive;
    }
});

test('取码失败不会阻塞其它原因，但登录态失败会占用当天重试额度', async () => {
    const originalGetFarmCode = wxLoginAdapter.getFarmCode;
    const originalKeepAlive = wxLoginAdapter.keepWxCredentialAlive;
    wxLoginAdapter.keepWxCredentialAlive = async () => ({ Success: true });
    wxLoginAdapter.getFarmCode = async () => ({ Success: false, Message: 'code 已失效' });

    const account = { id: 'wx-1', name: 'WeChat one', platform: 'wx', wxid: 'wxid-1', loginBuffer: 'buffer', refreshtoken: 'refresh' };
    try {
        const { service, accountLogs } = createService({
            accounts: [account],
            config: { enabled: true, intervalMinutes: 2, maxRetries: 2 },
        });

        assert.equal(await service.refreshAccountCode('wx-1', 'manual'), false);
        assert.equal(accountLogs[0].action, 'auto_code_refresh_failed');
        // 手动/定时原因不计入当天恢复额度
        assert.equal(await service.refreshAccountCode('wx-1', 'manual'), false);

        assert.equal(await service.refreshAccountCode('wx-1', 'kickout:account_kicked'), false);
        assert.equal(await service.refreshAccountCode('wx-1', 'ws_400'), false);

        assert.equal(await service.refreshAccountCode('wx-1', 'disconnect:ws'), false);
        assert.equal(accountLogs.at(-1).action, 'auto_relogin_blocked');
    }
    finally {
        wxLoginAdapter.getFarmCode = originalGetFarmCode;
        wxLoginAdapter.keepWxCredentialAlive = originalKeepAlive;
    }
});

test('缺少内置登录凭据的账号不会被延迟重登调度', () => {
    const withoutCredential = { id: 'wx-1', name: 'WeChat one', platform: 'wx', wxid: 'wxid-1' };
    const { service } = createService({
        accounts: [withoutCredential],
        config: { enabled: true, intervalMinutes: 2, maxRetries: 8 },
    });
    assert.equal(service.scheduleRelogin('wx-1', 'kickout:x'), false);

    const disabled = createService({
        accounts: [{ ...withoutCredential, loginBuffer: 'buffer' }],
        config: { enabled: false, intervalMinutes: 2, maxRetries: 8 },
    });
    assert.equal(disabled.service.scheduleRelogin('wx-1', 'kickout:x'), false);
    disabled.service.stopAccount('wx-1');
    service.stopAccount('wx-1');
});

test('手动停止的账号退出取码轮询，但保留不会启动账号的凭证保活', () => {
    const account = {
        id: 'wx-pause', name: 'Paused one', platform: 'wx',
        wxid: 'wxid-pause', loginBuffer: 'buffer', refreshtoken: 'refresh',
    };
    const { service } = createService({
        accounts: [account],
        config: { enabled: true, intervalMinutes: 2, maxRetries: 8 },
    });

    service.scheduleAccount('wx-pause');
    assert.ok(taskNames().includes('refresh_wx-pause'), '运行中的微信账号应挂上取码定时器');
    assert.ok(taskNames().includes('wx_keepalive_wx-pause'));

    service.pausePolling('wx-pause');
    assert.ok(!taskNames().includes('refresh_wx-pause'), '手动停止后必须撤掉取码定时器');
    assert.ok(taskNames().includes('wx_keepalive_wx-pause'), '凭证保活不得因手动停止而中断');

    // 保存刷新设置后的全量重排不能把用户停掉的账号重新拉回轮询
    service.scheduleAccount('wx-pause');
    assert.ok(!taskNames().includes('refresh_wx-pause'));
    assert.equal(service.scheduleRelogin('wx-pause', 'kickout:account_kicked'), false);

    service.resumePolling('wx-pause');
    service.scheduleAccount('wx-pause');
    assert.ok(taskNames().includes('refresh_wx-pause'), '重新启动后应恢复轮询');

    // 删除账号是彻底拆任务，连保活也要清掉
    service.stopAccount('wx-pause');
    assert.deepEqual(taskNames(), []);
});

test('手动停止后定时与掉线恢复不再取码，显式刷新仍可执行', async () => {
    const originalGetFarmCode = wxLoginAdapter.getFarmCode;
    const originalKeepAlive = wxLoginAdapter.keepWxCredentialAlive;
    const requested = [];
    wxLoginAdapter.keepWxCredentialAlive = async () => ({ Success: true });
    wxLoginAdapter.getFarmCode = async () => {
        requested.push(1);
        return { Success: true, Data: { code: 'fresh-code' } };
    };

    const account = {
        id: 'wx-block', name: 'Blocked one', platform: 'wx',
        wxid: 'wxid-block', loginBuffer: 'buffer', refreshtoken: 'refresh',
    };
    try {
        const { service, accountLogs, logs } = createService({
            accounts: [account],
            config: { enabled: true, intervalMinutes: 2, maxRetries: 8 },
            controls: { restartWorker: () => {} },
        });

        service.pausePolling('wx-block');
        assert.equal(await service.refreshAccountCode('wx-block', 'timer'), false);
        assert.equal(await service.refreshAccountCode('wx-block', 'ws_400'), false);
        assert.deepEqual(requested, [], '被拦下的恢复不应请求取码接口');
        assert.equal(accountLogs.length, 0, '拦下不应占用当天重试额度');
        assert.match(logs[0].message, /已手动停止/);

        // 启动账号会先 resume，显式取码路径始终放行
        assert.equal(await service.refreshAccountCode('wx-block', 'manual_start'), true);
        assert.equal(requested.length, 1);

        service.resumePolling('wx-block');
        service.stopAccount('wx-block');
    }
    finally {
        wxLoginAdapter.getFarmCode = originalGetFarmCode;
        wxLoginAdapter.keepWxCredentialAlive = originalKeepAlive;
    }
});

test('data provider 把手动停止转为退出轮询，把启动/重启转为恢复轮询', async () => {
    const calls = [];
    const accounts = [{
        id: '7', name: 'wx account', platform: 'wx',
        wxid: 'wxid-7', loginBuffer: 'buffer', refreshtoken: 'refresh',
    }];
    const provider = createDataProvider({
        workers: {},
        store: { maskWxCredentialsForClient: data => data },
        getAccounts: () => ({ accounts }),
        startWorker: () => { calls.push('startWorker'); return true; },
        stopWorker: accountId => { calls.push(`stopWorker:${accountId}`); },
        restartWorker: () => { calls.push('restartWorker'); },
        scheduleAutoCodeRefresh: accountId => calls.push(`schedule:${accountId}`),
        pauseAutoCodeRefreshPolling: accountId => calls.push(`pause:${accountId}`),
        resumeAutoCodeRefreshPolling: accountId => calls.push(`resume:${accountId}`),
        refreshAccountCode: async () => { calls.push('refresh'); return true; },
    });

    assert.equal(await provider.startAccount('7'), true);
    assert.deepEqual(calls, ['resume:7', 'schedule:7', 'refresh']);

    calls.length = 0;
    assert.equal(provider.stopAccount('7'), true);
    assert.deepEqual(calls, ['stopWorker:7', 'pause:7']);

    calls.length = 0;
    assert.equal(provider.restartAccount('7'), true);
    assert.deepEqual(calls, ['resume:7', 'schedule:7', 'restartWorker']);

    // “立即刷新”也是显式意图：先恢复轮询，成功后重新排期
    calls.length = 0;
    assert.deepEqual(await provider.refreshAccountCode('7'), { ok: true });
    assert.deepEqual(calls, ['resume:7', 'refresh', 'schedule:7']);
});

test('刷新配置的非法值会被夹紧到可用区间', async () => {
    const originalGetFarmCode = wxLoginAdapter.getFarmCode;
    const originalKeepAlive = wxLoginAdapter.keepWxCredentialAlive;
    const requested = [];
    wxLoginAdapter.keepWxCredentialAlive = async () => ({ Success: true });
    wxLoginAdapter.getFarmCode = async () => { requested.push(1); return ({ Success: false, Message: 'boom' }); };

    const account = { id: 'wx-1', name: 'WeChat one', platform: 'wx', wxid: 'wxid-1', loginBuffer: 'buffer', refreshtoken: 'refresh' };
    try {
        // maxRetries 非法（0）时回落到默认 8，而不是变成“一次都不重试”
        const { service, accountLogs } = createService({
            accounts: [account],
            config: { enabled: true, intervalMinutes: -5, maxRetries: 0 },
        });
        for (let i = 0; i < 8; i += 1) {
            assert.equal(await service.refreshAccountCode('wx-1', 'ws_400'), false);
        }
        assert.equal(accountLogs.filter(entry => entry.action === 'auto_code_refresh_failed').length, 8);
        assert.equal(requested.length, 8, '夹紧后的额度内应真实发起 8 次取码');
        assert.equal(await service.refreshAccountCode('wx-1', 'ws_400'), false);
        assert.equal(accountLogs.at(-1).action, 'auto_relogin_blocked');
        assert.equal(requested.length, 8, '达到上限后不再请求取码接口');
        service.stopAccount('wx-1');
    }
    finally {
        wxLoginAdapter.getFarmCode = originalGetFarmCode;
        wxLoginAdapter.keepWxCredentialAlive = originalKeepAlive;
    }
});
