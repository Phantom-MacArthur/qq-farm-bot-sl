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

test('worker 尚未上报状态时保持离线', () => {
    const byId = presenceOf({ 1: { status: null } }, [{ id: '1', name: 'no status' }]);

    assert.equal(byId['1'].running, true);
    assert.equal(byId['1'].online, false);
});
