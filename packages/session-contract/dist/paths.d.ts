export interface ResolveRuntimePathsOptions {
    env?: NodeJS.ProcessEnv;
    isPackaged?: boolean;
    execPath?: string;
    appRoot?: string;
    defaultDataDir?: string;
    defaultRuntimeDir?: string;
    defaultResourceRoot?: string;
    defaultWebRoot?: string;
    defaultShareFilePath?: string;
    platform?: NodeJS.Platform;
}
export interface WebRootInfo {
    webRoot: string;
    fallbackRoots: string[];
    source: 'pointer' | 'env' | 'default';
    pointerFile: string;
    releaseId?: string;
}
export interface RuntimePaths {
    isPackaged: boolean;
    appRoot: string;
    dataDir: string;
    runtimeDir: string;
    resourceRoot: string;
    webRoot: string;
    fallbackWebRoots: string[];
    webRootPointerFile: string;
    sessionSocketConfigured: string;
    sessionSocketEndpoint: string;
    hostDataDir: string;
    hostLogDir: string;
    backendLogDir: string;
    shareFilePath: string;
}
export declare function resolveSessionSocketEndpoint(rawSocketPath: string, platform?: NodeJS.Platform): {
    configured: string;
    endpoint: string;
};
export declare function resolveWebRootInfo(runtimeDir: string, defaultWebRoot: string, env?: NodeJS.ProcessEnv): WebRootInfo;
export declare function resolveRuntimePaths(options?: ResolveRuntimePathsOptions): RuntimePaths;
//# sourceMappingURL=paths.d.ts.map