const test = require('node:test');
const assert = require('node:assert/strict');

const {
    stripProtectedWxCredentials,
    maskWxCredentialsForClient,
} = require('../dist/models/store/accounts');
const wxLoginAdapter = require('../dist/services/wx-login/adapter');

test('账号请求体不能直接注入微信滚动凭据', () => {
    const sanitized = stripProtectedWxCredentials({
        id: '1', wxid: 'wx-new', code: 'farm-code',
        loginBuffer: 'forged-buffer', refreshtoken: 'forged-refresh',
        accesstoken: 'forged-access',
    });
    assert.deepEqual(sanitized, { id: '1', wxid: 'wx-new', code: 'farm-code' });
});

test('凭据过滤不会修改原始请求对象', () => {
    const source = { id: '1', loginBuffer: 'secret' };
    stripProtectedWxCredentials(source);
    assert.equal(source.loginBuffer, 'secret');
});

test('账号列表下发只保留 hasWxCredential 标记', () => {
    const masked = maskWxCredentialsForClient({
        nextId: 3,
        accounts: [
            { id: '1', platform: 'wx', loginBuffer: 'buffer', refreshtoken: 'r', accesstoken: 'a' },
            { id: '2', platform: 'qq' },
        ],
    });
    assert.equal(masked.nextId, 3);
    assert.equal(masked.accounts[0].hasWxCredential, true);
    assert.equal(masked.accounts[1].hasWxCredential, false);
    for (const field of ['loginBuffer', 'refreshtoken', 'accesstoken']) {
        assert.equal(masked.accounts[0][field], undefined, `${field} 不得下发给前端`);
    }
});

test('缺少 wxid 或 loginBuffer 的扫码会话不会登记凭证', () => {
    wxLoginAdapter.registerPendingWxInfo('session-missing-wxid', {
        wxid: '', loginBuffer: 'buffer', refreshtoken: 'r', accesstoken: 'a', nickname: 'n',
    });
    assert.equal(wxLoginAdapter.peekPendingWxInfo('session-missing-wxid', ''), null);

    wxLoginAdapter.registerPendingWxInfo('session-missing-buffer', {
        wxid: 'wxid-1', loginBuffer: '', refreshtoken: 'r', accesstoken: 'a', nickname: 'n',
    });
    assert.equal(wxLoginAdapter.peekPendingWxInfo('session-missing-buffer', 'wxid-1'), null);
});

test('待绑定凭证必须按 sessionId + wxid 双向匹配后才能读取', () => {
    wxLoginAdapter.registerPendingWxInfo('session-match', {
        wxid: 'wxid-owner', loginBuffer: 'buffer', refreshtoken: 'r', accesstoken: 'a', nickname: 'nick',
    });

    assert.equal(wxLoginAdapter.peekPendingWxInfo('session-match', 'wxid-other'), null);
    assert.equal(wxLoginAdapter.peekPendingWxInfo('session-other', 'wxid-owner'), null);

    const info = wxLoginAdapter.peekPendingWxInfo('session-match', 'wxid-owner');
    assert.equal(info.loginBuffer, 'buffer');
    // peek 不消费，账号保存失败时可在有效期内重试绑定
    assert.ok(wxLoginAdapter.peekPendingWxInfo('session-match', 'wxid-owner'));

    assert.equal(wxLoginAdapter.consumePendingWxInfo('session-match', 'wxid-other'), false);
    assert.equal(wxLoginAdapter.consumePendingWxInfo('session-match', 'wxid-owner'), true);
    assert.equal(wxLoginAdapter.peekPendingWxInfo('session-match', 'wxid-owner'), null);
});

test('释放扫码会话会同时丢弃尚未消费的凭证快照', () => {
    wxLoginAdapter.registerPendingWxInfo('session-release', {
        wxid: 'wxid-2', loginBuffer: 'buffer-2', refreshtoken: 'r', accesstoken: 'a', nickname: '',
    });
    wxLoginAdapter.releasePendingWxInfo('session-release');
    assert.equal(wxLoginAdapter.peekPendingWxInfo('session-release', 'wxid-2'), null);
});
