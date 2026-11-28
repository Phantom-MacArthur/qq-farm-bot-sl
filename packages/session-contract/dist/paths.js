"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveSessionSocketEndpoint = resolveSessionSocketEndpoint;
exports.resolveWebRootInfo = resolveWebRootInfo;
exports.resolveRuntimePaths = resolveRuntimePaths;
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
function nonEmpty(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function resolveSessionSocketEndpoint(rawSocketPath, platform = process.platform) {
    const trimmed = nonEmpty(rawSocketPath);
    if (platform === 'win32') {
        if (/^\\\\\.\\pipe\\/i.test(trimmed)) {
            return { configured: trimmed, endpoint: trimmed };
        }
        const resolved = node_path_1.default.resolve(trimmed || 'session-host.sock');
        const hash = node_crypto_1.default.createHash('sha256').update(resolved.toLowerCase()).digest('hex').slice(0, 20);
        return {
            configured: resolved,
            endpoint: `\\\\.\\pipe\\qq-farm-session-${hash}`,
        };
    }
    const resolved = node_path_1.default.resolve(trimmed || 'session-host.sock');
    if (Buffer.byteLength(resolved, 'utf8') <= 96) {
        return { configured: resolved, endpoint: resolved };
    }
    const hash = node_crypto_1.default.createHash('sha256').update(resolved).digest('hex').slice(0, 12);
    return {
        configured: resolved,
        endpoint: node_path_1.default.join(node_os_1.default.tmpdir(), `qq-farm-${process.getuid?.() ?? 'user'}`, `sh-${hash}.sock`),
    };
}
function resolveWebRootInfo(runtimeDir, defaultWebRoot, env = process.env) {
    const pointerEnv = nonEmpty(env.FARM_WEB_ROOT_POINTER);
    const pointerFile = pointerEnv ? node_path_1.default.resolve(pointerEnv) : node_path_1.default.join(runtimeDir, 'active-web.json');
    const envFallbacks = nonEmpty(env.FARM_WEB_FALLBACK_ROOTS)
        .split(node_path_1.default.delimiter)
        .map(item => item.trim())
        .filter(Boolean)
        .map(item => node_path_1.default.resolve(item));
    if (node_fs_1.default.existsSync(pointerFile)) {
        try {
            const parsed = JSON.parse(node_fs_1.default.readFileSync(pointerFile, 'utf8'));
            const candidate = nonEmpty(parsed?.webRoot);
            if (candidate) {
                const resolvedRoot = node_path_1.default.resolve(candidate);
                const pointerFallbacks = Array.isArray(parsed?.fallbackRoots)
                    ? parsed.fallbackRoots.map((entry) => nonEmpty(entry)).filter(Boolean).map((entry) => node_path_1.default.resolve(entry))
                    : [];
                const mergedFallbacks = Array.from(new Set([...pointerFallbacks, ...envFallbacks, node_path_1.default.resolve(defaultWebRoot)]))
                    .filter(item => item !== resolvedRoot);
                return {
                    webRoot: resolvedRoot,
                    fallbackRoots: mergedFallbacks,
                    source: 'pointer',
                    pointerFile,
                    releaseId: nonEmpty(parsed?.releaseId) || undefined,
                };
            }
        }
        catch {
            // Fall through to env/default if pointer file is unreadable.
        }
    }
    const envRoot = nonEmpty(env.FARM_WEB_ROOT);
    if (envRoot) {
        const resolvedRoot = node_path_1.default.resolve(envRoot);
        const mergedFallbacks = Array.from(new Set([...envFallbacks, node_path_1.default.resolve(defaultWebRoot)]))
            .filter(item => item !== resolvedRoot);
        return {
            webRoot: resolvedRoot,
            fallbackRoots: mergedFallbacks,
            source: 'env',
            pointerFile,
        };
    }
    const resolvedDefault = node_path_1.default.resolve(defaultWebRoot);
    return {
        webRoot: resolvedDefault,
        fallbackRoots: envFallbacks.filter(item => item !== resolvedDefault),
        source: 'default',
        pointerFile,
    };
}
function resolveRuntimePaths(options = {}) {
    const env = options.env || process.env;
    const isPackaged = options.isPackaged ?? Boolean(process.pkg);
    const execPath = options.execPath || process.execPath;
    const platform = options.platform || process.platform;
    const appRoot = options.appRoot
        ? node_path_1.default.resolve(options.appRoot)
        : (isPackaged ? node_path_1.default.dirname(execPath) : node_path_1.default.resolve(process.cwd()));
    const envDataDir = nonEmpty(env.FARM_DATA_DIR);
    const dataDir = envDataDir
        ? node_path_1.default.resolve(envDataDir)
        : (options.defaultDataDir
            ? node_path_1.default.resolve(options.defaultDataDir)
            : (isPackaged ? node_path_1.default.join(node_path_1.default.dirname(execPath), 'data') : node_path_1.default.join(appRoot, 'data')));
    const envRuntimeDir = nonEmpty(env.FARM_RUNTIME_DIR);
    const runtimeDir = envRuntimeDir
        ? node_path_1.default.resolve(envRuntimeDir)
        : (options.defaultRuntimeDir
            ? node_path_1.default.resolve(options.defaultRuntimeDir)
            : node_path_1.default.join(appRoot, 'runtime'));
    const envResourceRoot = nonEmpty(env.FARM_RESOURCE_ROOT);
    const resourceRoot = envResourceRoot
        ? node_path_1.default.resolve(envResourceRoot)
        : node_path_1.default.resolve(options.defaultResourceRoot || node_path_1.default.join(appRoot, 'src'));
    const defaultWebRoot = options.defaultWebRoot
        ? node_path_1.default.resolve(options.defaultWebRoot)
        : node_path_1.default.resolve(appRoot, '..', 'web', 'dist');
    const webInfo = resolveWebRootInfo(runtimeDir, defaultWebRoot, env);
    const rawSocket = nonEmpty(env.FARM_SESSION_SOCKET) || node_path_1.default.join(runtimeDir, 'session-host.sock');
    const socketEndpoint = resolveSessionSocketEndpoint(rawSocket, platform);
    const envHostDataDir = nonEmpty(env.FARM_HOST_DATA_DIR);
    const hostDataDir = envHostDataDir
        ? node_path_1.default.resolve(envHostDataDir)
        : node_path_1.default.join(dataDir, 'session-host');
    const envHostLogDir = nonEmpty(env.FARM_HOST_LOG_DIR);
    const hostLogDir = envHostLogDir
        ? node_path_1.default.resolve(envHostLogDir)
        : node_path_1.default.join(hostDataDir, 'logs');
    const envBackendLogDir = nonEmpty(env.FARM_BACKEND_LOG_DIR);
    const backendLogDir = envBackendLogDir
        ? node_path_1.default.resolve(envBackendLogDir)
        : node_path_1.default.join(dataDir, 'logs');
    const envShareFile = nonEmpty(env.FARM_SHARE_FILE);
    const dataShareFile = node_path_1.default.join(dataDir, 'share.txt');
    const fallbackShareFile = options.defaultShareFilePath
        ? node_path_1.default.resolve(options.defaultShareFilePath)
        : node_path_1.default.join(appRoot, 'share.txt');
    const shareFilePath = envShareFile
        ? node_path_1.default.resolve(envShareFile)
        : (node_fs_1.default.existsSync(dataShareFile) ? dataShareFile : fallbackShareFile);
    return {
        isPackaged,
        appRoot,
        dataDir,
        runtimeDir,
        resourceRoot,
        webRoot: webInfo.webRoot,
        fallbackWebRoots: webInfo.fallbackRoots,
        webRootPointerFile: webInfo.pointerFile,
        sessionSocketConfigured: socketEndpoint.configured,
        sessionSocketEndpoint: socketEndpoint.endpoint,
        hostDataDir,
        hostLogDir,
        backendLogDir,
        shareFilePath,
    };
}
//# sourceMappingURL=paths.js.map