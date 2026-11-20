const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const protobuf = require('protobufjs');
const root = new protobuf.Root().loadSync(path.join(__dirname, '../src/proto/taskpb.proto'), { keepCase: true });
const types = Object.fromEntries(['TaskInfoRequest', 'TaskInfoReply'].map(name => [name, root.lookupType(`gamepb.taskpb.${name}`)]));

function loadTaskService(taskInfo) {
    const mock = (name, exports) => { const id = require.resolve(`../dist/${name}`); require.cache[id] = { id, filename: id, loaded: true, exports }; };
    const names = { 1001: '金币', 1101: '经验', 1002: '点券', 80001: '化肥' };
    mock('utils/proto', { types });
    mock('utils/utils', { toLong: v => v, toNum: v => Number(v) || 0, log() {}, logWarn() {}, sleep: async () => {}, getSystemDateKey: () => '2026-11-19' });
    mock('models/store', { isAutomationOn: () => true });
    mock('services/scheduler', { createScheduler: () => ({ setTimeoutTask() {}, clearAll() {} }) });
    mock('config/gameConfig', {
        getItemById: id => (names[id] ? { name: names[id] } : undefined),
        getItemImageById: id => (id === 80001 ? '' : `/game-config/seed_images_named/seed_images/${id}.png`),
    });
    mock('utils/network', {
        networkEvents: { on() {}, off() {} },
        sendMsgAsync: async () => ({ body: Buffer.from(types.TaskInfoReply.encode(types.TaskInfoReply.fromObject({ task_info: taskInfo })).finish()) }),
    });
    delete require.cache[require.resolve('../dist/utils/reward-items')];
    const id = require.resolve('../dist/services/task');
    delete require.cache[id];
    return require(id);
}

test('成长任务下发奖励的名称、图标与数量，金币/经验旧 ID 归一到配置表 ID', async () => {
    const service = loadTaskService({
        growth_tasks: [{
            id: 101, desc: '收获 10 次', progress: 3, total_progress: 10, is_unlocked: true, task_type: 1,
            rewards: [{ id: 1, count: 500 }, { id: 2, count: 30 }, { id: 1002, count: 0 }],
            extra_rewards: [{ id: 80001, count: 2 }],
        }],
    });
    const state = await service.getGrowthTaskStateLikeApp(true);
    assert.deepEqual(state.tasks[0].rewards, [
        { id: 1001, count: 500, extra: false, name: '金币', image: '/game-config/seed_images_named/seed_images/1001.png' },
        { id: 1101, count: 30, extra: false, name: '经验', image: '/game-config/seed_images_named/seed_images/1101.png' },
        { id: 80001, count: 2, extra: true, name: '化肥', image: '' },
    ]);
    assert.deepEqual(state.currentTask.rewards, state.tasks[0].rewards);
});

test('成长任务没有奖励字段时返回空列表', async () => {
    const service = loadTaskService({ growth_tasks: [{ id: 102, desc: '升级', progress: 0, total_progress: 1, is_unlocked: true }] });
    const state = await service.getGrowthTaskStateLikeApp(true);
    assert.deepEqual(state.tasks[0].rewards, []);
});

test('每日任务按物品合计奖励，并统计已领取数量', async () => {
    const service = loadTaskService({
        tasks: [
            { id: 201, desc: '浇水', progress: 5, total_progress: 5, is_unlocked: true, is_claimed: true, task_type: 2, rewards: [{ id: 1, count: 100 }] },
            { id: 202, desc: '除草', progress: 1, total_progress: 5, is_unlocked: true, task_type: 2, rewards: [{ id: 1001, count: 200 }, { id: 2, count: 10 }] },
        ],
    });
    const state = await service.getTaskDailyStateLikeApp(true);
    assert.equal(state.claimedCount, 1);
    assert.deepEqual(state.rewards.map(r => [r.id, r.count]), [[1001, 300], [1101, 10]]);
});
