const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

const {
    buildDingTalkWebhook,
    createDingTalkSign,
} = require('../dist/services/push');
const { createReloginReminderService } = require('../dist/runtime/relogin-reminder');
const { createRuntimeState } = require('../dist/runtime/runtime-state');

test('buildDingTalkWebhook converts a legacy access token to an official webhook', () => {
    const url = new URL(buildDingTalkWebhook('', 'legacy-token'));

    assert.equal(url.origin, 'https://oapi.dingtalk.com');
    assert.equal(url.pathname, '/robot/send');
    assert.equal(url.searchParams.get('access_token'), 'legacy-token');
});

test('buildDingTalkWebhook keeps a complete webhook address', () => {
    const endpoint = 'https://oapi.dingtalk.com/robot/send?access_token=complete-token';

    assert.equal(buildDingTalkWebhook(endpoint, ''), endpoint);
});

test('buildDingTalkWebhook appends the documented timestamp and signature', () => {
    const endpoint = 'https://oapi.dingtalk.com/robot/send?access_token=signed-token';
    const secret = 'SEC-test-secret';
    const timestamp = 1_700_000_000_000;
    const expectedSign = crypto
        .createHmac('sha256', secret)
        .update(`${timestamp}\n${secret}`, 'utf8')
        .digest('base64');
    const url = new URL(buildDingTalkWebhook(endpoint, '', secret, timestamp));

    assert.equal(createDingTalkSign(secret, timestamp), expectedSign);
    assert.equal(url.searchParams.get('timestamp'), String(timestamp));
    assert.equal(url.searchParams.get('sign'), expectedSign);
});

test('buildDingTalkWebhook rejects non-DingTalk endpoints', () => {
    assert.throws(
        () => buildDingTalkWebhook('https://example.com/robot/send?access_token=test', ''),
        /钉钉 Webhook 地址格式无效/,
    );
});

test('pushes use the triggering account channel and worker scheduling uses its notification settings', async () => {
    const accounts = {
        a: {
            channel: 'qmsg',
            channelCredentials: { qmsg: { token: 'mock-a' } },
            notificationTypes: { offline: false, mysteryArrival: true, mysteryPurchase: false },
            mysteryMessages: { mysteryArrival: 'A 到访内容' },
        },
        b: {
            channel: 'bark',
            channelCredentials: { bark: { token: 'mock-b' } },
            notificationTypes: { offline: true, mysteryArrival: false, mysteryPurchase: true },
            msg: 'B 下线内容',
        },
    };
    const store = {
        getOfflineReminder: id => accounts[id],
        getPushNotifications: () => ({
            channels: [{ channel: 'qmsg', enabled: true, token: 'mock' }],
            notificationTypes: { offline: false, mysteryArrival: false, mysteryPurchase: false },
            msg: '旧全局下线内容',
        }),
        getConfigSnapshot: () => ({ automation: { mystery_shop_auto_buy: true } }),
    };
    const sent = [];
    const reminder = createReloginReminderService({
        store,
        sendNotification: async ({ channel, token, title, content }) => {
            sent.push({ channel, token, title, content });
            return { ok: true };
        },
        log: () => {},
    });
    const candidates = [
        { type: 'mysteryPurchase', title: '购买', content: '默认购买详情' },
        { type: 'mysteryArrival', title: '到访', content: '默认到访详情' },
    ];
    await reminder.triggerOfflineReminder({ accountId: 'a' });
    await reminder.sendConfiguredPush({ accountId: 'a', candidates });
    await reminder.sendConfiguredPush({ accountId: 'b', candidates });
    await reminder.triggerOfflineReminder({ accountId: 'b' });
    await reminder.sendConfiguredPush({ accountId: 'unconfigured', candidates });
    assert.deepEqual(sent, [
        { channel: 'qmsg', token: 'mock-a', title: '到访 A 到访内容', content: '默认到访详情' },
        { channel: 'bark', token: 'mock-b', title: '购买', content: '默认购买详情' },
        { channel: 'bark', token: 'mock-b', title: '农场下线 B 下线内容', content: '农场下线' },
    ]);

    const state = createRuntimeState({ store });
    assert.deepEqual(state.buildConfigSnapshotForAccount('a').automation, {
        mystery_shop_auto_buy: true,
        mystery_shop_arrival_notify: true,
        mystery_shop_purchase_notify: false,
    });
    assert.deepEqual(state.buildConfigSnapshotForAccount('b').automation, {
        mystery_shop_auto_buy: true,
        mystery_shop_arrival_notify: false,
        mystery_shop_purchase_notify: true,
    });
});

test('farm activity is opt-in and only sends the selected events over the account channel', async () => {
    const accounts = {
        legacy: { channel: 'qmsg', token: 'mock-legacy' },
        empty: { channel: 'qmsg', token: 'mock-empty', notificationTypes: { farmActivity: true }, farmActivityEvents: [] },
        a: { channel: 'qmsg', token: 'mock-a', notificationTypes: { farmActivity: true }, farmActivityEvents: ['cropHarvest', 'reward'], farmActivityMessage: '提醒' },
        b: { channel: 'bark', token: 'mock-b', notificationTypes: { farmActivity: true }, farmActivityEvents: ['animalHarvest', 'sale'] },
    };
    const sent = [];
    const reminder = createReloginReminderService({
        store: {
            getOfflineReminder: id => accounts[id],
            getAccounts: () => ({ accounts: [{ id: 'a', nick: '账号昵称', name: '账号备注' }, { id: 'b', name: '备用备注' }] }),
        },
        sendNotification: async ({ channel, token, title, content }) => {
            sent.push({ channel, token, title, content });
            return { ok: true };
        },
        log: () => {},
    });
    const events = [['cropHarvest', '收获作物'], ['animalHarvest', '收获动物'], ['sale', '出售成功'], ['reward', '领取奖励']];
    for (const [activity, title] of events) {
        for (const accountId of Object.keys(accounts)) {
            await reminder.sendConfiguredPush({ accountId, accountName: accountId, candidates: [{ type: 'farmActivity', activity, title, content: '详情' }] });
        }
    }
    assert.deepEqual(sent, [
        { channel: 'qmsg', token: 'mock-a', title: '账号昵称', content: '详情' },
        { channel: 'bark', token: 'mock-b', title: '备用备注', content: '详情' },
        { channel: 'bark', token: 'mock-b', title: '备用备注', content: '详情' },
        { channel: 'qmsg', token: 'mock-a', title: '账号昵称', content: '详情' },
    ]);
});

test('concurrent sends share one-second slots across channels and continue after a failure', async () => {
    const filename = require.resolve('../dist/services/push');
    const module = { exports: {} };
    const calls = [];
    let now = 0;
    const deps = {
        'node:timers/promises': { setTimeout: async ms => { now += ms; } },
        'axios': { default: { post: async (_url, body) => {
            calls.push({ title: body.summary, at: now });
            return { data: { code: 1000 } };
        } } },
        'pushoo': { default: async (_channel, { title }) => {
            calls.push({ title, at: now });
            if (title === 'failed') throw new Error('transport failed');
            return { code: 'ok' };
        } },
    };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
        module, exports: module.exports, performance: { now: () => now },
        require: name => deps[name] ?? require(name),
    }, { filename });
    const { sendNotification } = module.exports;
    const results = await Promise.allSettled([
        sendNotification({ channel: 'qmsg', token: 'mock', title: 'failed', content: 'test' }),
        sendNotification({ channel: 'wxpusher', token: 'SPT_mock', title: 'live', content: 'event' }),
        sendNotification({ channel: 'bark', token: 'mock', title: 'test', content: 'test' }),
    ]);
    assert.deepEqual(results.map(item => item.status), ['rejected', 'fulfilled', 'fulfilled']);
    assert.deepEqual(calls, [{ title: 'failed', at: 0 }, { title: 'live', at: 1000 }, { title: 'test', at: 2000 }]);
});
