"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_async_hooks_1 = require("node:async_hooks");
const storage = new node_async_hooks_1.AsyncLocalStorage();
const queuedTasks = [];
const interactiveTasks = [];
let running = false;
function runNextTask() {
    if (running)
        return;
    const task = interactiveTasks.shift() ?? queuedTasks.shift();
    if (!task)
        return;
    running = true;
    void Promise.resolve().then(task);
}
function runExclusiveAutomationTask(taskName, taskFn, options = {}) {
    const store = storage.getStore();
    if (!options.detached && store && store.exclusive && store.active)
        return Promise.resolve(taskFn());
    return new Promise((resolve, reject) => {
        // 任务执行顺序变化时，仍继承各自的网关请求班次等上下文。
        const task = node_async_hooks_1.AsyncResource.bind(async () => {
            const taskStore = { exclusive: true, active: true };
            try {
                resolve(await storage.run(taskStore, taskFn));
            }
            catch (error) {
                reject(error);
            }
            finally {
                taskStore.active = false;
                running = false;
                runNextTask();
            }
        });
        (options.interactive || options.interactiveRead ? interactiveTasks : queuedTasks).push(task);
        runNextTask();
    });
}
function isAutomationTaskRunning() {
    return running;
}
module.exports = {
    runExclusiveAutomationTask,
    isAutomationTaskRunning,
};
//# sourceMappingURL=automation-lock.js.map