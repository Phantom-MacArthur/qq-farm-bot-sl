"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BackendChildTracker = void 0;
exports.isProcessAlive = isProcessAlive;
exports.readLockMetadata = readLockMetadata;
exports.readChildRegistry = readChildRegistry;
exports.writeChildRegistryAtomic = writeChildRegistryAtomic;
exports.listAliveBackendChildren = listAliveBackendChildren;
exports.removeStaleLock = removeStaleLock;
exports.acquireExclusiveLock = acquireExclusiveLock;
const node_crypto_1 = require("node:crypto");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const SLEEP_BUFFER = new Int32Array(new SharedArrayBuffer(4));
function sleepSyncMs(ms) {
    Atomics.wait(SLEEP_BUFFER, 0, 0, Math.max(1, Math.min(ms, 5000)));
}
function processStartToken(pid) {
    if (process.platform !== 'linux')
        return undefined;
    try {
        const stat = node_fs_1.default.readFileSync(`/proc/${pid}/stat`, 'utf8');
        const startTicks = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
        return `${node_fs_1.default.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim()}:${startTicks}`;
    }
    catch {
        return undefined;
    }
}
function isProcessAlive(pid, processStart) {
    if (!Number.isSafeInteger(pid) || pid <= 0)
        return false;
    try {
        process.kill(pid, 0);
        const actual = processStart && processStartToken(pid);
        return !actual || actual === processStart;
    }
    catch (error) {
        return error?.code === 'EPERM';
    }
}
function readLockMetadata(lockPath) {
    try {
        if (!node_fs_1.default.existsSync(lockPath))
            return null;
        const raw = node_fs_1.default.readFileSync(lockPath, 'utf8').trim();
        if (!raw)
            return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || !Number.isSafeInteger(Number(parsed.pid))) {
            return null;
        }
        return {
            pid: Number(parsed.pid),
            processStart: parsed.processStart,
            role: String(parsed.role || 'unknown'),
            instanceId: String(parsed.instanceId || ''),
            nonce: String(parsed.nonce || ''),
            releaseId: parsed.releaseId ? String(parsed.releaseId) : undefined,
            startedAt: Number(parsed.startedAt) || 0,
        };
    }
    catch {
        return null;
    }
}
function readChildRegistry(registryPath) {
    let parsed;
    try {
        parsed = JSON.parse(node_fs_1.default.readFileSync(registryPath, 'utf8'));
    }
    catch (error) {
        if (error?.code === 'ENOENT')
            return [];
        throw lockError('CHILD_REGISTRY_UNREADABLE', `Cannot read backend child registry: ${registryPath}`, { cause: error });
    }
    if (!Array.isArray(parsed?.children) || !parsed.children.every((entry) => Number.isSafeInteger(Number(entry?.pid)) && Number(entry.pid) > 0)) {
        throw lockError('CHILD_REGISTRY_UNREADABLE', `Invalid backend child registry: ${registryPath}`);
    }
    return parsed.children.map((entry) => ({
        pid: Number(entry.pid),
        processStart: entry.processStart,
        kind: String(entry.kind || 'child'),
        id: entry.id ? String(entry.id) : undefined,
        startedAt: Number(entry.startedAt) || 0,
    }));
}
function writeChildRegistryAtomic(registryPath, children) {
    node_fs_1.default.mkdirSync(node_path_1.default.dirname(registryPath), { recursive: true });
    const tmpPath = `${registryPath}.${process.pid}.${Date.now()}.tmp`;
    try {
        node_fs_1.default.writeFileSync(tmpPath, JSON.stringify({ children }, null, 2), 'utf8');
        node_fs_1.default.renameSync(tmpPath, registryPath);
    }
    finally {
        try {
            if (node_fs_1.default.existsSync(tmpPath))
                node_fs_1.default.unlinkSync(tmpPath);
        }
        catch {
            // ignore temp cleanup failure
        }
    }
}
function listAliveBackendChildren(registryPath) {
    return readChildRegistry(registryPath).filter(entry => isProcessAlive(entry.pid, entry.processStart));
}
class BackendChildTracker {
    registryPath;
    children = new Map();
    constructor(registryPath) {
        this.registryPath = node_path_1.default.resolve(registryPath);
    }
    register(pid, kind, id) {
        if (!Number.isSafeInteger(pid) || pid <= 0)
            return;
        const existing = listAliveBackendChildren(this.registryPath);
        for (const entry of existing) {
            if (!this.children.has(entry.pid))
                this.children.set(entry.pid, entry);
        }
        this.children.set(pid, { pid, processStart: processStartToken(pid), kind, id, startedAt: Date.now() });
        this.flush();
    }
    unregister(pid) {
        if (!Number.isSafeInteger(pid) || pid <= 0)
            return;
        this.children.delete(pid);
        const disk = listAliveBackendChildren(this.registryPath).filter(entry => entry.pid !== pid);
        for (const entry of disk) {
            if (!this.children.has(entry.pid))
                this.children.set(entry.pid, entry);
        }
        this.flush();
    }
    clear() {
        this.children.clear();
        try {
            if (node_fs_1.default.existsSync(this.registryPath))
                node_fs_1.default.unlinkSync(this.registryPath);
        }
        catch {
            // ignore
        }
    }
    flush() {
        const alive = [...this.children.values()].filter(entry => isProcessAlive(entry.pid, entry.processStart));
        this.children.clear();
        for (const entry of alive)
            this.children.set(entry.pid, entry);
        writeChildRegistryAtomic(this.registryPath, alive);
    }
}
exports.BackendChildTracker = BackendChildTracker;
function lockError(code, message, extra = {}) {
    return Object.assign(new Error(message), { code, ...extra });
}
function removeStaleLock(lockPath, graceMs = 500) {
    if (!node_fs_1.default.existsSync(lockPath))
        return false;
    const holder = readLockMetadata(lockPath);
    if (holder && isProcessAlive(holder.pid, holder.processStart))
        return false;
    // Only one contender may check and remove an abandoned lock. Otherwise a
    // second contender could unlink the new owner's lock after the first wins.
    const guard = acquireExclusiveLock(`${lockPath}.recovery`, {
        role: 'recovery', instanceId: String(process.pid), nonce: (0, node_crypto_1.randomUUID)(),
    }, { staleWriteGraceMs: graceMs });
    try {
        const current = readLockMetadata(lockPath);
        if (current ? isProcessAlive(current.pid, current.processStart) : Date.now() - node_fs_1.default.statSync(lockPath).mtimeMs < graceMs) {
            return false;
        }
        node_fs_1.default.unlinkSync(lockPath);
        return true;
    }
    catch (error) {
        if (error?.code === 'ENOENT')
            return false;
        throw error;
    }
    finally {
        guard.release();
    }
}
function acquireExclusiveLock(lockPath, metadata, options = {}) {
    const resolvedPath = node_path_1.default.resolve(lockPath);
    node_fs_1.default.mkdirSync(node_path_1.default.dirname(resolvedPath), { recursive: true });
    const fullMeta = {
        pid: metadata.pid ?? process.pid,
        processStart: processStartToken(metadata.pid ?? process.pid),
        role: metadata.role,
        instanceId: metadata.instanceId,
        nonce: metadata.nonce,
        releaseId: metadata.releaseId,
        startedAt: metadata.startedAt ?? Date.now(),
    };
    const staleWriteGraceMs = options.staleWriteGraceMs ?? 500;
    for (let attempt = 0; attempt < 8; attempt++) {
        try {
            const fd = node_fs_1.default.openSync(resolvedPath, 'wx', 0o600);
            try {
                node_fs_1.default.writeFileSync(fd, JSON.stringify(fullMeta, null, 2), 'utf8');
                try {
                    node_fs_1.default.fsyncSync(fd);
                }
                catch { /* ignore fsync unsupported */ }
            }
            finally {
                node_fs_1.default.closeSync(fd);
            }
            if (options.childRegistryPath) {
                try {
                    const children = listAliveBackendChildren(options.childRegistryPath);
                    if (children.length)
                        throw lockError('BACKEND_CHILDREN_STILL_ALIVE', 'Previous backend workers are still alive', { aliveChildren: children });
                }
                catch (error) {
                    node_fs_1.default.unlinkSync(resolvedPath);
                    throw error;
                }
            }
            let released = false;
            return {
                lockPath: resolvedPath,
                metadata: fullMeta,
                release: () => {
                    if (released)
                        return false;
                    released = true;
                    const current = readLockMetadata(resolvedPath);
                    if (!current || current.instanceId !== fullMeta.instanceId || current.nonce !== fullMeta.nonce) {
                        return false;
                    }
                    try {
                        node_fs_1.default.unlinkSync(resolvedPath);
                        return true;
                    }
                    catch (err) {
                        if (err?.code === 'ENOENT')
                            return false;
                        throw err;
                    }
                },
            };
        }
        catch (error) {
            if (error?.code !== 'EEXIST')
                throw error;
            const holder = readLockMetadata(resolvedPath);
            if (!holder) {
                try {
                    const stat = node_fs_1.default.statSync(resolvedPath);
                    if (Date.now() - stat.mtimeMs < staleWriteGraceMs) {
                        sleepSyncMs(staleWriteGraceMs - (Date.now() - stat.mtimeMs));
                        continue;
                    }
                }
                catch {
                    continue;
                }
            }
            if (holder && isProcessAlive(holder.pid, holder.processStart)) {
                throw lockError('LOCK_ALREADY_HELD', `Lock ${node_path_1.default.basename(resolvedPath)} is already held by pid=${holder.pid} (${holder.role}:${holder.instanceId})`, { lockPath: resolvedPath, holder });
            }
            if (options.childRegistryPath) {
                const aliveChildren = listAliveBackendChildren(options.childRegistryPath);
                if (aliveChildren.length > 0) {
                    throw lockError('BACKEND_CHILDREN_STILL_ALIVE', `Previous backend child processes are still alive: ${aliveChildren.map(c => `${c.kind}:${c.pid}`).join(', ')}`, { lockPath: resolvedPath, holder, aliveChildren });
                }
            }
            removeStaleLock(resolvedPath, staleWriteGraceMs);
        }
    }
    throw lockError('LOCK_CONTENTION', `Failed to acquire lock ${node_path_1.default.basename(resolvedPath)} after retries`, {
        lockPath: resolvedPath,
    });
}
//# sourceMappingURL=locks.js.map