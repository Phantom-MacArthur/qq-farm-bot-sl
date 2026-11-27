const assert = require('node:assert/strict');
const test = require('node:test');

const {
    runExclusiveAutomationTask,
} = require('../dist/services/automation-lock');
const { getAmbientRequestClass, runWithRequestClass } = require('../dist/utils/request-context');

test('automation lock serializes top-level tasks', async () => {
    let active = 0;
    let maxActive = 0;

    const task = async (delay) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise(resolve => setTimeout(resolve, delay));
        active -= 1;
    };

    await Promise.all([
        runExclusiveAutomationTask('task-a', () => task(15)),
        runExclusiveAutomationTask('task-b', () => task(5)),
        runExclusiveAutomationTask('task-c', () => task(10)),
    ]);

    assert.equal(maxActive, 1);
});

test('automation lock allows nested calls in the same task', async () => {
    let active = 0;
    let maxActive = 0;

    await runExclusiveAutomationTask('outer', async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await runExclusiveAutomationTask('inner', async () => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            await new Promise(resolve => setTimeout(resolve, 5));
            active -= 1;
        });
        active -= 1;
    });

    assert.equal(maxActive, 2);
});

test('排队任务释放锁后直接接续执行', async () => {
    const calls = [];
    const completed = Promise.all([
        runExclusiveAutomationTask('task-a', () => calls.push('a')),
        runExclusiveAutomationTask('task-b', () => calls.push('b')),
    ]);
    const finishedInThisTurn = await Promise.race([
        completed.then(() => true),
        new Promise(resolve => setImmediate(resolve, false)),
    ]);

    assert.equal(finishedInThisTurn, true);
    assert.deepEqual(calls, ['a', 'b']);
});

test('前台读取在当前任务结束后优先执行，并保留各任务的请求班次', async () => {
    const calls = [];
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const active = runExclusiveAutomationTask('active', async () => {
        calls.push('active');
        await gate;
    });
    const background = runWithRequestClass('farm', () =>
        runExclusiveAutomationTask('background', () => calls.push(getAmbientRequestClass())));
    const read = runWithRequestClass('foreground', () =>
        runExclusiveAutomationTask('read', () => calls.push(getAmbientRequestClass()), { interactiveRead: true }));
    await Promise.resolve();
    const callsWhileLocked = [...calls];
    release();
    await Promise.all([active, read, background]);
    assert.deepEqual(callsWhileLocked, ['active']);
    assert.deepEqual(calls, ['active', 'foreground', 'farm']);
});
