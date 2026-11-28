export interface LockHolderMetadata {
    pid: number;
    processStart?: string;
    role: 'session-host' | 'backend' | 'deploy' | string;
    instanceId: string;
    nonce: string;
    releaseId?: string;
    startedAt: number;
}
export interface AcquireLockOptions {
    childRegistryPath?: string;
    staleWriteGraceMs?: number;
}
export interface ExclusiveLockHandle {
    lockPath: string;
    metadata: LockHolderMetadata;
    release: () => boolean;
}
export interface BackendChildEntry {
    pid: number;
    processStart?: string;
    kind: string;
    id?: string;
    startedAt: number;
}
export declare function isProcessAlive(pid: number, processStart?: string): boolean;
export declare function readLockMetadata(lockPath: string): LockHolderMetadata | null;
export declare function readChildRegistry(registryPath: string): BackendChildEntry[];
export declare function writeChildRegistryAtomic(registryPath: string, children: BackendChildEntry[]): void;
export declare function listAliveBackendChildren(registryPath: string): BackendChildEntry[];
export declare class BackendChildTracker {
    private readonly registryPath;
    private readonly children;
    constructor(registryPath: string);
    register(pid: number, kind: string, id?: string): void;
    unregister(pid: number): void;
    clear(): void;
    private flush;
}
export declare function removeStaleLock(lockPath: string, graceMs?: number): boolean;
export declare function acquireExclusiveLock(lockPath: string, metadata: Omit<LockHolderMetadata, 'pid' | 'startedAt'> & {
    pid?: number;
    startedAt?: number;
}, options?: AcquireLockOptions): ExclusiveLockHandle;
//# sourceMappingURL=locks.d.ts.map