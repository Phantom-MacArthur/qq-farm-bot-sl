const assert = require('node:assert/strict');
const crypto = require('node:crypto');
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
        sendPushooMessage: async ({ channel, token, title, content }) => {
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
