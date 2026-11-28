export {};

import { AsyncLocalStorage, AsyncResource } from 'node:async_hooks';

interface AutomationLockStore {
    exclusive: true;
    active: boolean;
}

const storage = new AsyncLocalStorage<AutomationLockStore>();
const queuedTasks: Array<() => Promise<void>> = [];
const interactiveTasks: Array<() => Promise<void>> = [];
let running = false;

function runNextTask(): void {
    if (running) return;
    const task = interactiveTasks.shift() ?? queuedTasks.shift();
    if (!task) return;
    running = true;
    void Promise.resolve().then(task);
}

function runExclusiveAutomationTask<T>(
    taskName: string,
    taskFn: () => T | PromiseLike<T>,
    options: { detached?: boolean; interactiveRead?: boolean; interactive?: boolean } = {},
): Promise<T> {
    const store: AutomationLockStore | undefined = storage.getStore();
    if (!options.detached && store && store.exclusive && store.active) return Promise.resolve(taskFn());

    return new Promise<T>((resolve, reject) => {
        // 任务执行顺序变化时，仍继承各自的网关请求班次等上下文。
        const task = AsyncResource.bind(async () => {
            const taskStore: AutomationLockStore = { exclusive: true, active: true };
            try {
                resolve(await storage.run(taskStore, taskFn));
            } catch (error) {
                reject(error);
            } finally {
                taskStore.active = false;
                running = false;
                runNextTask();
            }
        });
        (options.interactive || options.interactiveRead ? interactiveTasks : queuedTasks).push(task);
        runNextTask();
    });
}

function isAutomationTaskRunning(): boolean {
    return running;
}

module.exports = {
    runExclusiveAutomationTask,
    isAutomationTaskRunning,
};
