const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const vm = require('node:vm');
const test = require('node:test');

function emailHarness(t) {
    const dataRoot = path.resolve(__dirname, '../data');
    fs.mkdirSync(dataRoot, { recursive: true });
    const dir = fs.mkdtempSync(path.join(dataRoot, 'test-email-'));
    t.after(() => {
        assert.equal(path.dirname(dir), dataRoot);
        fs.rmSync(dir, { recursive: true, force: true });
    });
    const clock = { now: Date.parse('2026-11-09T01:59:59Z'), failLists: false, failWrite: false, emails: { 1: [], 2: [] }, interruptClaim: false };
    const methods = [];
    const utils = {
        log() {}, toNum: Number,
        getSystemDateKey: () => new Date(clock.now + 8 * 3600000).toISOString().slice(0, 10),
    };
    const db = require('../dist/services/json-db');
    const types = {
        GetEmailListRequest: { create: value => value, encode: value => ({ finish: () => value }) },
        GetEmailListReply: { decode: body => ({ emails: clock.emails[body.box_type] }) },
        BatchClaimEmailRequest: { create: value => value, encode: value => ({ finish: () => value }) },
        BatchClaimEmailReply: { decode: () => ({}) },
    };
    class ClockDate extends Date {
        static now() { return clock.now; }
    }
    function load() {
        const filename = path.resolve(__dirname, '../dist/services/email.js');
        const module = { exports: {} };
        vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
            module, exports: module.exports, Date: ClockDate,
            require(name) {
                if (name === '../utils/utils') return utils;
                if (name === '../config/runtime-paths') return { getDataFile: name => path.join(dir, name) };
                if (name === '../utils/proto') return { types };
                if (name === './json-db') return {
                    ...db,
                    writeJsonFileAtomic(...args) {
                        if (clock.failWrite) throw new Error('disk full');
                        db.writeJsonFileAtomic(...args);
                    },
                };
                if (name === '../utils/network') return { sendMsgAsync: async (_service, method, body) => {
                    methods.push([method, body.box_type]);
                    if (clock.failLists) throw new Error('list unavailable');
                    if (method === 'BatchClaimEmail') {
                        for (const email of clock.emails[body.box_type]) {
                            if (body.email_ids.includes(email.id)) email.claimed = true;
                        }
                        if (clock.interruptClaim) return new Promise(() => {});
                    }
                    return { body };
                } };
                return createRequire(filename)(name);
            },
        }, { filename });
        return module.exports;
    }
    return { load, clock, methods, dir, utils, ClockDate };
}

test('登录后立即检查邮箱，完成后进入冷却，冷却过期再次检查', async (t) => {
    const h = emailHarness(t);
    const email = h.load();
    email.configureEmailClaim({ accountId: 'first' });
    // 首次调用不再等待配置的整点，直接请求邮箱
    await email.checkAndClaimEmails(true);
    assert.deepEqual(h.methods, [['GetEmailList', 1], ['GetEmailList', 2]]);
    assert.equal(email.getEmailDailyState().result, 'none');
    // 冷却未到：不重复请求
    h.clock.now += 1000;
    assert.equal((await email.checkAndClaimEmails()).skipped, 'cooldown');
    assert.equal(email.getEmailDailyState().doneToday, true);
    // force（登录/刷新 code）无视冷却
    await email.checkAndClaimEmails(true);
    assert.equal(h.methods.length, 4);
    // 冷却 30 分钟后自动再次检查
    h.clock.now += 30 * 60 * 1000;
    await email.checkAndClaimEmails();
    assert.equal(h.methods.length, 6);
    assert.equal(email.getEmailDailyState().doneToday, true);
});

test('检查失败用更短的重试间隔，不再当天放弃，跨日午夜后很快重试', async (t) => {
    const h = emailHarness(t);
    h.clock.failLists = true;
    h.clock.now = Date.parse('2026-11-09T15:55:00Z');
    const email = h.load();
    email.configureEmailClaim({ accountId: 'first' });
    assert.equal((await email.checkAndClaimEmails()).error, 'list unavailable');
    assert.equal((await email.checkAndClaimEmails()).skipped, 'cooldown');
    assert.equal(h.methods.length, 2);
    // 跨日：失败结果不当天放弃，冷却收紧为 5 分钟重试间隔
    h.clock.now = Date.parse('2026-11-09T15:59:00Z');
    assert.equal((await email.checkAndClaimEmails()).skipped, 'cooldown');
    h.clock.now += 2 * 60 * 1000;
    await email.checkAndClaimEmails();
    assert.equal(h.methods.length, 4);
});

test('状态跨进程重启持久化；新账号立即检查，损坏状态不被绕过', async (t) => {
    const h = emailHarness(t);
    const email = h.load();
    email.configureEmailClaim({ accountId: 'first' });
    await email.checkAndClaimEmails();
    assert.equal(h.methods.length, 2);
    const restarted = h.load();
    restarted.configureEmailClaim({ accountId: 'first' });
    assert.equal((await restarted.checkAndClaimEmails()).skipped, 'cooldown');
    await restarted.checkAndClaimEmails(true);
    assert.equal(h.methods.length, 4);
    // 损坏的状态文件必须暴露读取错误，不能退化成无记录重查
    const corrupted = h.load();
    fs.writeFileSync(path.join(h.dir, fs.readdirSync(h.dir)[0]), '{broken');
    assert.throws(() => corrupted.configureEmailClaim({ accountId: 'first' }), { code: 'STORAGE_READ_FAILED' });
    await assert.rejects(corrupted.checkAndClaimEmails(), { code: 'STORAGE_READ_FAILED' });
    assert.equal(h.methods.length, 4);
    // 切换账号没有历史记录，立即检查
    restarted.configureEmailClaim({ accountId: 'second' });
    await restarted.checkAndClaimEmails();
    assert.equal(h.methods.length, 6);
});

test('进程中断遗留 running 时同进程和重启都不能重入，恢复后继续检查', async (t) => {
    const h = emailHarness(t);
    h.clock.interruptClaim = true;
    h.clock.emails[1] = [{ id: 'claimed-before-exit', has_reward: true, claimed: false }];
    const email = h.load();
    email.configureEmailClaim({ accountId: 'first' });
    void email.checkAndClaimEmails();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(email.getEmailDailyState().doneToday, false);
    assert.equal(email.getEmailDailyState().result, 'running');
    assert.equal((await email.checkAndClaimEmails(true)).skipped, 'running');
    assert.equal(h.methods.length, 3);

    // 重启（同一天）：running 记录不算已完成，恢复为待检查
    h.clock.interruptClaim = false;
    const restarted = h.load();
    restarted.configureEmailClaim({ accountId: 'first' });
    assert.equal(restarted.getEmailDailyState().result, '');
    assert.equal((await restarted.checkAndClaimEmails()).skipped, undefined);
    assert.equal(restarted.getEmailDailyState().result, 'none');
    assert.deepEqual(h.methods, [
        ['GetEmailList', 1], ['GetEmailList', 2], ['BatchClaimEmail', 1],
        ['GetEmailList', 1], ['GetEmailList', 2],
    ]);
});

test('中断后重新读取邮箱，只领取上次尚未完成的邮件', async (t) => {
    const h = emailHarness(t);
    h.clock.interruptClaim = true;
    h.clock.emails[1] = [{ id: 'already-claimed', has_reward: true, claimed: false }];
    h.clock.emails[2] = [{ id: 'still-pending', has_reward: true, claimed: false }];
    const email = h.load();
    email.configureEmailClaim({ accountId: 'first' });
    void email.checkAndClaimEmails();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.clock.emails[2][0].claimed, false);

    h.clock.interruptClaim = false;
    const restarted = h.load();
    restarted.configureEmailClaim({ accountId: 'first' });
    assert.equal((await restarted.checkAndClaimEmails()).claimed, 1);
    assert.equal(h.clock.emails[2][0].claimed, true);
    assert.equal(restarted.getEmailDailyState().result, 'ok');
    assert.deepEqual(h.methods.filter(([method]) => method === 'BatchClaimEmail'), [
        ['BatchClaimEmail', 1], ['BatchClaimEmail', 2],
    ]);
});

test('状态写入失败时不发送邮箱请求', async (t) => {
    const h = emailHarness(t);
    h.clock.failWrite = true;
    const email = h.load();
    email.configureEmailClaim({ accountId: 'first' });
    assert.equal((await email.checkAndClaimEmails()).skipped, 'storage');
    assert.equal(h.methods.length, 0);
});

test('Worker 登录立即检查邮箱，同日不再轮询，仅跨日重跑日常任务', async (t) => {
    const h = emailHarness(t);
    const email = h.load();
    const filename = path.resolve(__dirname, '../dist/core/worker.js');
    let tick;
    let otherRoutines = 0;
    let shareRuns = 0;
    const automation = {};
    const noop = () => {};
    const modules = {
        'node:worker_threads': {},
        '../config/config': { CONFIG: { timeZone: 'Asia/Shanghai' } },
        '../models/store': { getAutomation: () => automation, applyConfigSnapshot: value => value },
        '../services/email': email,
        '../services/status': { setRecordGoldExpHook: noop },
        '../services/farm-activity-events': { farmActivityEvents: { on: noop } },
        '../services/automation-lock': { runExclusiveAutomationTask: (_name, run) => Promise.resolve().then(run) },
        '../services/scheduler': { createScheduler: () => ({ clear: noop, setIntervalTask: (_name, ms, fn) => {
            assert.equal(ms, 30000);
            tick = fn;
        } }) },
        '../services/warehouse': { openCharitySettlementGiftPacksSilently: async () => { otherRoutines += 1; } },
        '../services/share': { checkDailyShareStatus: () => { shareRuns += 1; } },
        '../services/monthcard': { performDailyMonthCardGift: noop },
        '../services/mall': { buyFreeGifts: noop },
        '../services/qqvip': { performDailyVipGift: noop },
        '../utils/network': { networkEvents: { on: noop } },
        '../utils/utils': { ...h.utils, setLogHook: noop },
    };
    const worker = vm.runInNewContext(`${fs.readFileSync(filename, 'utf8')}\n;({
        configure: applyRuntimeConfig,
        start() { loginReady = true; startDailyRoutineTimer(); },
    })`, {
        exports: {}, Date: h.ClockDate,
        process: { env: { FARM_ACCOUNT_ID: 'worker' }, send: noop, on: noop, once: noop },
        require: name => modules[name] || {},
    }, { filename });
    const flush = () => new Promise(resolve => setImmediate(resolve));
    worker.configure({});
    worker.start();
    await flush();
    assert.equal(h.methods.length, 2, '登录上线立即检查邮箱');
    assert.equal(otherRoutines, 1);
    // 同日多次 30 秒轮询（即使冷却已过）也不再单独检查邮箱
    h.clock.now += 30 * 1000;
    tick();
    await flush();
    h.clock.now += 30 * 60 * 1000;
    tick();
    await flush();
    assert.equal(h.methods.length, 2, '同日轮询不会重复检查邮箱');
    assert.equal(otherRoutines, 1, '同日轮询不重跑日常任务');
    // 跨日（+08 进到 Nov10）：日常任务重跑；邮箱距上次检查已久，随日常任务重新检查
    h.clock.now = Date.parse('2026-11-09T16:00:00Z');
    tick();
    await flush();
    assert.equal(h.methods.length, 4, '跨日会随日常任务重新检查邮箱');
    assert.equal(otherRoutines, 2);
    // 跨日后的同日轮询依旧不再单独检查邮箱
    h.clock.now += 30 * 1000;
    tick();
    await flush();
    assert.equal(h.methods.length, 4, '跨日检查后的同日轮询不会重请');

    automation.farm_email_rewards = false;
    h.clock.now = Date.parse('2026-11-10T16:00:00Z');
    tick();
    await flush();
    assert.equal(h.methods.length, 4, '关闭邮箱后跨日也不会检查邮箱');
    assert.equal(otherRoutines, 2, '邮箱附带的礼包检查也暂停');
    assert.equal(shareRuns, 3, '分享礼包仍独立运行');
});
