const test = require('node:test');
const assert = require('node:assert/strict');

const { createDataProvider } = require('../dist/runtime/data-provider');

function presenceOf(workers, accounts) {
    const provider = createDataProvider({
        workers,
        store: { maskWxCredentialsForClient: data => data },
        getAccounts: () => ({ accounts }),
    });
    const byId = {};
    provider.getAccounts().accounts.forEach(account => {
        byId[String(account.id)] = account;
    });
    return byId;
}

test('账号列表把进程状态和上线状态分开下发', () => {
    const accounts = [
        { id: '1', name: 'online one' },
        { id: '2', name: 'starting one' },
        { id: '3', name: 'stopped one' },
    ];
    const workers = {
        1: { status: { connection: { connected: true }, status: { name: '昵称', avatarUrl: 'http://avatar' } } },
        2: { status: { connection: { connected: false }, status: {} } },
    };

    const byId = presenceOf(workers, accounts);

    assert.equal(byId['1'].running, true);
    assert.equal(byId['1'].online, true);
    assert.equal(byId['1'].nick, '昵称');
    assert.equal(byId['1'].avatar, 'http://avatar');

    // 进程已起来但还没登录成功：不能算在线
    assert.equal(byId['2'].running, true);
    assert.equal(byId['2'].online, false);

    assert.equal(byId['3'].running, false);
    assert.equal(byId['3'].online, false);
});

test('后台通用、活动和商城只按码识别离线，保留原有超时与数字业务响应', async () => {
    const { handleApiError } = require('../dist/controllers/admin/middleware');
    const { handleActivityApiError } = require('../dist/controllers/admin/activity-center/error-handler');
    const { mountCommerceRoutes } = require('../dist/controllers/admin/commerce-routes');
    const routes = new Map();
    let failure;
    mountCommerceRoutes({ get: (path, handler) => routes.set(path, handler), post() {} }, { provider: {
        getAccounts: () => ({ accounts: [{ id: '1' }] }),
        getMallCatalog: async () => { throw failure; },
    } });
    const mall = (res, error) => {
        failure = error;
        return routes.get('/api/game-mall')({ headers: { 'x-account-id': '1' }, query: {} }, res);
    };
    const response = async (handler, err) => {
        const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
        await handler(res, err);
        return { status: res.statusCode, body: res.body };
    };
    const gateway = Object.assign(new Error('gamepb.Activity.Claim code=1034014 已领取'), {
        name: 'GatewayError', code: 1034014, errorMessage: '已领取',
    });
    for (const [handler, timeoutCode, businessCode] of [
        [handleApiError, undefined, 1034014],
        [handleActivityApiError, 'ACTIVITY_TIMEOUT', '1034014'],
        [mall, 'COMMERCE_TIMEOUT', '1034014'],
    ]) {
        for (const code of ['ACCOUNT_OFFLINE', 'GAME_OFFLINE']) {
            const error = Object.assign(new Error('内部断连诊断'), { code });
            assert.deepEqual(await response(handler, error), { status: 200, body: { ok: false, error: code, errorCode: code } });
        }
        const timed = await response(handler, new Error('API Timeout'));
        assert.equal(timed.status, 200);
        assert.equal(timed.body.errorCode, timeoutCode);
        const business = await response(handler, gateway);
        assert.equal(business.status, 200);
        assert.equal(business.body.errorCode, businessCode);
        const legacy = await response(handler, new Error('连接未打开: Enter'));
        assert.ok(!['ACCOUNT_OFFLINE', 'GAME_OFFLINE'].includes(legacy.body.errorCode));
    }
    assert.equal((await response(handleApiError, new Error('请求超时: Enter'))).status, 500);
    assert.equal((await response(handleApiError, gateway)).body.errorMessage, '已领取');
    assert.equal((await response(mall, gateway)).body.errorMessage, '已领取');
});

test('worker 尚未上报状态时保持离线', () => {
    const byId = presenceOf({ 1: { status: null } }, [{ id: '1', name: 'no status' }]);

    assert.equal(byId['1'].running, true);
    assert.equal(byId['1'].online, false);
});
