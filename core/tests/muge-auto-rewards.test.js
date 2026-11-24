const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');
const { effectiveAutomation, MUGE_REWARD_KEYS } = require('../dist/config/automation-modules');
const { normalizeAccountConfig } = require('../dist/models/store/shared-state');
const config = require('../src/activity-data/muge-20261117.json');

function createActivity() {
    const tier = status => ({ tier_id: 1, threshold: 1, status, reward: [] });
    const celebration = { head: { id: '2026111702' }, global_count: { total: 1, tiers: [tier(2)] } };
    const friends = { head: { id: '2026111703' }, invite_friend: { counted_friends: [], tiers: [tier(2)] } };
    const handbook = { head: { id: '2026111704' }, task: {
        tier_points: 0,
        tiers: [tier(1)],
        tasks: [{ task_id: 1, status: 2, progress: 1, target: 1, unlock_day: 1, reward: [] }],
    } };
    const firstQuestion = config.questions[0];
    const savedAnswer = firstQuestion.options[1].value;
    const personality = { head: { id: '2026111705' }, survey: {
        answers: { [firstQuestion.id]: savedAnswer }, personality_id: 0, settle_count: 0, share_reward_claimed: false,
    } };
    const head = { id: '2026111700', status: 1, start_time: 100, end_time: 200 };
    const group = { head, children: [celebration, friends, handbook, personality] };
    const operations = [];
    const reports = [];
    const enabled = Object.fromEntries(MUGE_REWARD_KEYS.map(key => [key, false]));
    const server = { now: 150, requests: 0, beforeOperate: () => {} };
    const encode = value => ({ finish: () => value });
    const decode = body => body;

    const handlers = {
        global_count_claim_tier: () => { celebration.global_count.tiers[0].status = 3; },
        invite_friend_tier_claim: () => { friends.invite_friend.tiers[0].status = 3; },
        task_claim: () => {
            handbook.task.tasks[0].status = 3;
            handbook.task.tier_points = 1;
            handbook.task.tiers[0].status = 2;
        },
        task_tier_claim: () => {
            assert.equal(handbook.task.tiers[0].status, 2);
            handbook.task.tiers[0].status = 3;
        },
        survey_save_progress: ({ answers, clear }) => {
            assert.equal(clear, false);
            assert.equal(Object.hasOwn(answers, firstQuestion.id), false);
            Object.assign(personality.survey.answers, answers);
        },
        survey_settle: () => {
            assert.equal(Object.keys(personality.survey.answers).length, config.questions.length);
            personality.survey.personality_id = config.results[0].id;
            personality.survey.settle_count += 1;
        },
        survey_claim_share_reward: () => { personality.survey.share_reward_claimed = true; },
    };
    const dependencies = {
        '../activity-data/muge-20261117.json': config,
        '../config/automation-modules': { MUGE_REWARD_KEYS },
        '../config/gameConfig': { getItemById: () => ({ name: '奖励' }), getItemImageById: () => '' },
        '../utils/utils': { getServerTimeSec: () => server.now, toNum: value => Number(value) || 0 },
        '../utils/proto': { types: {
            ActivityListRequest: { encode }, MugeListReply: { decode },
            MugeOperateRequest: { encode }, MugeOperateReply: { decode },
        } },
        '../utils/network': {
            sendMsgAsync: async (_service, method, body, options) => {
                server.requests += 1;
                if (method === 'List') return { body: { groups: [group] } };
                assert.equal(method, 'Operate');
                const { id, cmd, ...params } = body;
                const [field] = Object.keys(params);
                server.beforeOperate(cmd);
                const blocked = options?.beforeSend?.();
                if (blocked) throw blocked;
                operations.push(cmd);
                handlers[field](params[field]);
                const activity = group.children.find(entry => entry.head.id === id);
                const awards = cmd === 86 || cmd === 87 ? [] : [{ id: 1, count: 1 }];
                return { body: { id, cmd, activity, [field]: { claimed_ids: [1], awards } } };
            },
        },
        protobufjs: {},
    };
    const filename = require.resolve('../dist/services/muge-activity');
    const module = { exports: {} };
    const { runMugeAutoRewards } = vm.runInNewContext(readFileSync(filename, 'utf8') + '\nmodule.exports', {
        exports: module.exports,
        module,
        require: name => dependencies[name],
    }, { filename });
    return {
        enabled, operations, reports, server, survey: personality.survey,
        run: () => runMugeAutoRewards(key => effectiveAutomation(enabled)[key] === true, key => reports.push(key)),
    };
}

test('claims the enabled rewards, unlocks handbook tiers, and preserves existing personality answers', async () => {
    const activity = createActivity();
    for (const key of MUGE_REWARD_KEYS) activity.enabled[key] = true;
    const previousAnswers = { ...activity.survey.answers };

    await activity.run();
    assert.deepEqual(activity.operations, [85, 84, 82, 83, 86, 87, 89]);
    assert.deepEqual(activity.reports, [
        'muge_claim_celebration', 'muge_claim_friends', 'muge_claim_handbook', 'muge_claim_handbook', 'muge_claim_personality',
    ]);
    for (const { id, options } of config.questions) {
        assert.equal(activity.survey.answers[id], previousAnswers[id] ?? options[0].value);
    }
    await activity.run();
    assert.deepEqual(activity.operations, [85, 84, 82, 83, 86, 87, 89]);
    assert.equal(activity.survey.settle_count, 1);
});

test('resumes an existing personality result and only performs the enabled reward action', async () => {
    const activity = createActivity();
    activity.enabled.muge_claim_personality = true;
    activity.survey.personality_id = config.results[0].id;
    await activity.run();
    assert.deepEqual(activity.operations, [89]);
});

test('honors the activity gate and blocks queued writes when a switch is disabled or the event ends', async () => {
    const activity = createActivity();
    activity.enabled.muge_claim_celebration = true;
    activity.enabled.muge_claim_friends = true;
    activity.enabled.activity_enabled = false;
    await activity.run();
    assert.equal(activity.server.requests, 0);

    activity.enabled.activity_enabled = true;
    activity.server.beforeOperate = cmd => {
        if (cmd === 85) activity.enabled.muge_claim_celebration = false;
        if (cmd === 84) activity.server.now = 200;
    };
    await activity.run();
    assert.deepEqual(activity.operations, []);
    await activity.run();
    assert.deepEqual(activity.operations, []);
});

test('persists individual reward settings and defaults to disabled for existing accounts', () => {
    const previous = normalizeAccountConfig({ automation: { activity_enabled: false } });
    for (const key of MUGE_REWARD_KEYS) assert.equal(previous.automation[key], false);
    const saved = normalizeAccountConfig({ automation: { muge_claim_friends: true } }, previous).automation;
    assert.equal(saved.muge_claim_friends, true);
    assert.equal(effectiveAutomation(saved).muge_claim_friends, false);
    assert.equal(effectiveAutomation({ ...saved, activity_enabled: true }).muge_claim_friends, true);
});
