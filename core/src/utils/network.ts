export {};
const { Buffer } = require('node:buffer');
const { performance } = require('node:perf_hooks');
const { EventEmitter } = require('node:events');
const WebSocket = require('ws');
const { util: protobufUtil } = require('protobufjs');
const { CONFIG } = require('../config/config');
const { getClientVersion, getLoginDeviceInfo, isWechatPlatform } = require('./client-profile');
const { createScheduler } = require('../services/scheduler');
const { updateStatusFromLogin, updateStatusGold, updateStatusLevel } = require('../services/status');
const { invalidateLandForecast } = require('../services/level-forecast');
const { types } = require('./proto');
const { toLong, toNum, syncServerTime, getServerTimeSec, formatDateKeyInTimeZone, log, logWarn, sleep } = require('./utils');
const cryptoWasm = require('./crypto-wasm');
const { GatewayTokenProvider } = require('./gateway-token');
const { MAX_HEARTBEAT_MISSES, shouldTerminateForHeartbeat } = require('./keepalive-policy');
const { countBlockingQueuedRequests, shouldLogRequestPressure } = require('./request-pressure');
const {
    LOW_PRIORITY_IDLE_POLL_MS,
    LOW_PRIORITY_IDLE_WAIT_MAX_MS,
    LOW_PRIORITY_QUEUE_WAIT_MS,
    isGatewayIdleForLowPriority,
} = require('./low-priority-gate');
const {
    describeRequestClassMarker,
    isClassQueueFull,
    maxQueuedForClass,
    resolveRequestClass,
    selectDispatchIndex,
} = require('./request-priority');
const { getAmbientRequestClass } = require('./request-context');
const { startAceRuntime, stopAceRuntime, getAceDiagnostics } = require('../services/ace');

// ============ WebSocket 协议级保活与死连接检测 ============
/** WebSocket 协议级 ping 帧发送间隔（15s）。远快于应用层 25s 心跳，不占用业务班次。 */
const WS_PING_INTERVAL_MS = 15000;
/** 超过这个时间没有任何入站数据（业务回包、pong、推送通知等一律算）就判定连接死亡。 */
const INBOUND_SILENCE_FATAL_MS = 45000;
/** farm / friend 班次在队列里的等待上限，超过就让路而不是熬满 20s 请求超时刷故障日志。 */
const BUSINESS_QUEUE_WAIT_MS = 12000;

// ============ 事件发射器 (用于推送通知) ============
const networkEvents = new EventEmitter();
let hosted: import('../session/hosted-network').HostedNetwork | undefined;

// ============ 内部状态 ============
type ConnectionPhase = 'connecting' | 'login' | 'online';
type RequestPriority = 'low' | 'normal' | 'high';
/** 请求班次，见 utils/request-priority.ts。 */
type RequestClass = 'critical' | 'foreground' | 'farm' | 'friend' | 'background';
type CriticalLane = 'heartbeat' | 'ace';

interface ConnectionContext {
    id: number;
    socket: WebSocket;
    phase: ConnectionPhase;
    writeTail?: Promise<void>;
    intentionalClose: boolean;
    finalized: boolean;
    loginInitialized: boolean;
    clientVersion: string;
    startedMono?: number;
    onlineMono?: number;
    heartbeat?: { attempts: number; replies: number; failures: number };
}

interface SendMsgOptions {
    prepareSend?: () => Promise<void>;
    beforeSend?: () => Error | null;
    onSent?: () => void;
    timeoutMs?: number;
    expectedErrorCodes?: readonly number[];
    /** 兼容旧调用：high→critical、low→background、normal 视为「未表态」交给环境班次。 */
    priority?: RequestPriority;
    /** 显式指定班次，优先于 priority 与环境班次。 */
    requestClass?: RequestClass;
    criticalLane?: CriticalLane;
    expectReply?: boolean;
}

interface PendingRequest {
    callback: (err: Error | null, body?: Buffer, meta?: any) => void;
    expectedErrorCodes: Set<number>;
    serviceName?: string;
    methodName?: string;
    /** 这个请求是否会改变自家土地（决定回包要不要作废土地快照）。 */
    affectsOwnFarm?: boolean;
    startedMono?: number;
    requestClass: RequestClass;
    criticalLane?: CriticalLane;
}

interface QueuedRequest {
    prepareSend?: () => Promise<void>;
    beforeSend?: () => Error | null;
    onSent?: () => void;
    context: ConnectionContext;
    serviceName: string;
    methodName: string;
    bodyBytes: Buffer;
    expectedErrorCodes: Set<number>;
    resolve: (value: { body: Buffer; meta: any }) => void;
    reject: (reason: Error) => void;
    timeoutKey: string;
    queueWaitKey: string;
    seq: number | null;
    settled: boolean;
    /** 这个请求是否会改变自家土地（决定回包要不要作废土地快照）。 */
    affectsOwnFarm: boolean;
    requestClass: RequestClass;
    criticalLane?: CriticalLane;
    enqueuedAt: number;
    expectReply: boolean;
}

class GatewayError extends Error {
    code: number;
    serviceName: string;
    methodName: string;
    errorMessage: string;
    clientSeq: number;

    constructor(meta: any) {
        const code = toNum(meta && meta.error_code);
        const serviceName = String((meta && meta.service_name) || '');
        const methodName = String((meta && meta.method_name) || '');
        const errorMessage = String((meta && meta.error_message) || '');
        super(`${serviceName}.${methodName} 错误: code=${code} ${errorMessage}`.trim());
        this.name = 'GatewayError';
        this.code = code;
        this.serviceName = serviceName;
        this.methodName = methodName;
        this.errorMessage = errorMessage;
        this.clientSeq = toNum(meta && meta.client_seq);
    }
}

/** background 班次请求让路时抛出的错误：不是业务失败，而是「现在不该占用连接」。 */
class GatewayBusyError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'GatewayBusyError';
    }
}

let ws: WebSocket | null = null;
let currentConnection: ConnectionContext | null = null;
let nextConnectionId = 1;
let clientSeq: number = 1;
let serverSeq: number = 0;
const pendingCallbacks = new Map<number, PendingRequest>();
const requestQueue: QueuedRequest[] = [];
// Gateway 是单连接复用，并发预算与班次优先级全部集中在 utils/request-priority.ts。
// 这里只保留日志里要展示多少条在途请求。
const MAX_DESCRIBED_PENDING_REQUESTS = 6;
let nextRequestId = 1;
let wsErrorState = { code: 0, at: 0, message: '' };
let lastRequestPressureLogAt = 0;
const networkScheduler = createScheduler('network');
const gatewayTokens = new GatewayTokenProvider();
let lastHeartbeatMono = performance.now();
let lastInboundMono = performance.now();
let lastPongMono = 0;
let heartbeatMissCount = 0;

function settleQueuedRequest(request: QueuedRequest, error?: Error, value?: { body: Buffer; meta: any }): void {
    if (request.settled) return;
    request.settled = true;
    networkScheduler.clear(request.timeoutKey);
    networkScheduler.clear(request.queueWaitKey);
    if (error) request.reject(error);
    else request.resolve(value!);
}

function pendingClassCount(requestClass: RequestClass): number {
    let count = 0;
    for (const pending of pendingCallbacks.values()) {
        if (pending.requestClass === requestClass) count += 1;
    }
    return count;
}

function pendingBusinessCount(): number {
    return pendingClassCount('foreground') + pendingClassCount('farm') + pendingClassCount('friend');
}

interface GatewayLoad {
    pending: number;
    queued: number;
    /** 队列里非 background 的请求数：只有这些代表「有人真的在等连接」。 */
    blockingQueued: number;
    criticalPending: number;
    businessPending: number;
    foregroundPending: number;
    backgroundPending: number;
    heartbeatMisses: number;
    oldestPendingAgeMs: number;
}

function oldestPendingAgeMs(): number {
    const now = performance.now();
    let oldest = 0;
    for (const pending of pendingCallbacks.values()) {
        if (pending.startedMono === undefined) continue;
        const age = Math.max(0, now - pending.startedMono);
        if (age > oldest) oldest = age;
    }
    return oldest;
}

/** 后台任务用来判断「现在该不该占用连接」的负载快照。 */
function getGatewayLoad(): GatewayLoad {
    if (hosted?.load) return hosted.load;
    return {
        pending: pendingCallbacks.size,
        queued: requestQueue.length,
        blockingQueued: countBlockingQueuedRequests(requestQueue),
        criticalPending: pendingClassCount('critical'),
        businessPending: pendingBusinessCount(),
        foregroundPending: pendingClassCount('foreground'),
        backgroundPending: pendingClassCount('background'),
        heartbeatMisses: heartbeatMissCount,
        oldestPendingAgeMs: oldestPendingAgeMs(),
    };
}

function isGatewayIdleForBackground(): boolean {
    return isGatewayIdleForLowPriority(getGatewayLoad());
}

/**
 * 等网关空闲到可以插入后台请求；等不到就返回 false，由调用方整轮让路。
 * 只观察不排队，所以等待期间一点压力都不加给网关。
 */
async function waitForGatewayIdle(
    maxWaitMs: number = LOW_PRIORITY_IDLE_WAIT_MAX_MS,
    pollMs: number = LOW_PRIORITY_IDLE_POLL_MS,
): Promise<boolean> {
    const deadline = performance.now() + Math.max(0, Number(maxWaitMs) || 0);
    for (;;) {
        if (isGatewayIdleForBackground()) return true;
        if (performance.now() >= deadline) return false;
        await sleep(Math.max(20, Number(pollMs) || LOW_PRIORITY_IDLE_POLL_MS));
    }
}

/**
 * 挑出下一个可发送的请求。分层与容量规则全部在 utils/request-priority.ts 里，
 * 这里只负责清掉已结算的队列项、把选中项摘出来。
 */
function takeDispatchableRequest(): QueuedRequest | null {
    for (let index = requestQueue.length - 1; index >= 0; index--) {
        if (requestQueue[index].settled) requestQueue.splice(index, 1);
    }
    if (requestQueue.length === 0) return null;
    const index = selectDispatchIndex(requestQueue, Array.from(pendingCallbacks.values()), performance.now());
    if (index < 0) return null;
    return requestQueue.splice(index, 1)[0];
}

function drainRequestQueue(): void {
    while (requestQueue.length > 0) {
        const request = takeDispatchableRequest();
        if (!request) break;

        if (!isCurrentConnection(request.context) || request.context.phase !== 'online') {
            settleQueuedRequest(request, Object.assign(new Error(`连接未打开: ${request.methodName}`), { code: 'GAME_OFFLINE' }));
            continue;
        }

        const seq = clientSeq;
        request.seq = seq;
        const pending: PendingRequest | undefined = request.expectReply ? {
            serviceName: request.serviceName,
            methodName: request.methodName,
            affectsOwnFarm: request.affectsOwnFarm,
            startedMono: performance.now(),
            requestClass: request.requestClass,
            criticalLane: request.criticalLane,
            expectedErrorCodes: request.expectedErrorCodes,
            callback: (err, body, meta) => {
                if (err) settleQueuedRequest(request, err);
                else settleQueuedRequest(request, undefined, { body: body!, meta });
                drainRequestQueue();
            },
        } : undefined;
        sendMsg(request.context, request.serviceName, request.methodName, request.bodyBytes, pending, request).then((sent) => {
            if (sent) {
                if (!request.expectReply) {
                    settleQueuedRequest(request, undefined, { body: Buffer.alloc(0), meta: {} });
                    drainRequestQueue();
                }
                return;
            }
            pendingCallbacks.delete(seq);
            const socketClosed = !isCurrentConnection(request.context) || request.context.socket.readyState !== WebSocket.OPEN;
            const error = socketClosed
                ? Object.assign(new Error(`连接未打开: ${request.methodName}`), { code: 'GAME_OFFLINE' })
                : new Error(`发送失败: ${request.methodName}`);
            settleQueuedRequest(request, error);
            drainRequestQueue();
        }).catch((error: any) => {
            pendingCallbacks.delete(seq);
            settleQueuedRequest(request, error instanceof Error ? error : new Error(String(error)));
            drainRequestQueue();
        });
    }
}

function rejectAllQueuedRequests(error: Error): number {
    const entries = requestQueue.splice(0);
    for (const request of entries) settleQueuedRequest(request, error);
    return entries.length;
}

function rejectAllPendingRequests(error: Error): number {
    const entries = Array.from(pendingCallbacks.entries());
    pendingCallbacks.clear();
    for (const [, pending] of entries) {
        try {
            pending.callback(error);
        } catch {
            // ignore callback failure
        }
    }
    return entries.length;
}

function describePendingRequests(): string {
    if (pendingCallbacks.size === 0) return 'none';
    const now = performance.now();
    return Array.from(pendingCallbacks.entries())
        .slice(0, MAX_DESCRIBED_PENDING_REQUESTS)
        .map(([seq, pending]) => {
            const method = pending.methodName || 'unknown';
            const ageMs = pending.startedMono !== undefined ? Math.max(0, now - pending.startedMono) : 0;
            return `${method}#${seq}:${ageMs}ms`;
        })
        .join(',');
}

function describeQueuedRequests(): string {
    if (requestQueue.length === 0) return 'none';
    return requestQueue
        .slice(0, 8)
        .map(request => `${describeRequestClassMarker(request)}${request.methodName || 'unknown'}`)
        .join(',');
}

function logRequestPressure(): void {
    const now = performance.now();
    if (!shouldLogRequestPressure(requestQueue, now, lastRequestPressureLogAt)) return;
    lastRequestPressureLogAt = now;
    logWarn('系统', `Gateway 请求压力: pending=${pendingCallbacks.size}, queued=${requestQueue.length}, active=${describePendingRequests()}, queuedMethods=${describeQueuedRequests()}`);
}

// ============ 用户状态 (登录后设置) ============
const userState = {
    gid: 0,
    name: '',
    level: 0,
    gold: 0,
    exp: 0,
    coupon: 0,
    goldBean: 0,
    openId: '',
    avatarUrl: '',
    globalSceneId: 1,
    unlockedSceneIds: [] as number[],
};

function getUserState() { return userState; }

// ============ 土地快照影响范围判定 ============
/**
 * 好友农场的操作（浇水/务农/偷菜/放虫放草/放社交道具）和自家操作共用同一批 service，
 * 之前这里对任何回包都作废土地快照，好友任务每轮都会把在途的自家 AllLands 快照打掉，
 * 结果是自家快照长期写不进去、种植经验迟迟不出现。
 * 这里在请求发出前先解析 host_gid，只有作用在自家农场（host_gid 为 0 或等于自己 GID）时才作废。
 */
const PLANT_HOST_GID_REQUEST_TYPES: Record<string, string> = {
    Harvest: 'HarvestRequest',
    WaterLand: 'WaterLandRequest',
    Farming: 'FarmingRequest',
    WeedOut: 'WeedOutRequest',
    Insecticide: 'InsecticideRequest',
    PutInsects: 'PutInsectsRequest',
    PutWeeds: 'PutWeedsRequest',
    PutSocialItem: 'PutSocialItemRequest',
};

function toGidNumber(raw: any): number {
    if (raw === undefined || raw === null) return 0;
    if (typeof raw === 'number') return raw;
    const text = typeof raw.toString === 'function' ? raw.toString() : String(raw);
    const value = Number(text);
    return Number.isFinite(value) ? value : 0;
}

function decodeRequestHostGid(typeName: string, bodyBytes: Buffer): number | null {
    const type = (types as any)[typeName];
    if (!type || !bodyBytes || bodyBytes.length === 0) return null;
    try {
        const decoded = type.decode(bodyBytes);
        const raw = decoded ? decoded.host_gid : null;
        if (raw === undefined || raw === null) return null;
        return toGidNumber(raw);
    } catch {
        return null;
    }
}

/**
 * 这个请求会不会改变自家土地。判断不出来时按「会」处理：
 * 宁可多作废一次快照，也不要把过期的土地数据当成有效数据展示。
 */
function requestAffectsOwnFarm(serviceName: string, methodName: string, bodyBytes: Buffer): boolean {
    if (serviceName === 'gamepb.plantpb.PlantService') {
        // AllLands 是纯读取，绝不能作废快照，否则快照刚写入就会被自己打掉。
        if (methodName === 'AllLands') return false;
        const typeName = PLANT_HOST_GID_REQUEST_TYPES[methodName];
        // 播种/施肥/铲除/升级等自家专属操作没有 host_gid，一定影响自家。
        if (!typeName) return true;
        const gid = decodeRequestHostGid(typeName, bodyBytes);
        if (gid === null) return true;
        return gid === 0 || gid === toGidNumber(userState.gid);
    }
    if (serviceName === 'gamepb.itempb.ItemService' && methodName === 'Use') {
        const type = (types as any).UseRequest;
        if (!type) return true;
        try {
            const decoded = type.decode(bodyBytes);
            const target = decoded ? decoded.target : null;
            // 没有 target = 道具用在自己身上。
            if (!target) return true;
            const gid = toGidNumber(target.host_gid);
            return gid === 0 || gid === toGidNumber(userState.gid);
        } catch {
            return true;
        }
    }
    return false;
}

const shareInfoState = new Map<string, { shareCount: string; claimed: boolean; dateKey: string }>();
function shareDateKey(): string {
    const nowMs = typeof getServerTimeSec === 'function' ? getServerTimeSec() * 1000 : Date.now();
    return typeof formatDateKeyInTimeZone === 'function'
        ? formatDateKeyInTimeZone(nowMs, 'Asia/Shanghai')
        : new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(nowMs);
}
function applyShareInfos(infos: Record<string, any>): void {
    const dateKey = shareDateKey();
    for (const [key, info] of Object.entries(infos || {})) {
        const id = /^\d+$/.test(key) ? key : protobufUtil.longFromHash(key, false).toString();
        shareInfoState.set(id, { shareCount: String(info?.share_count ?? 0), claimed: Boolean(info?.is_claimed), dateKey });
    }
}
function getDailyShareInfo(id: number): any {
    const dateKey = shareDateKey();
    const state = shareInfoState.get(String(id));
    return state?.dateKey === dateKey ? { ...state } : { shareCount: '0', claimed: false, dateKey };
}

async function loginGameScene(globalSceneId: number): Promise<any> {
    const body = types.PlayerSceneLoginRequest.encode({ global_scene_id: globalSceneId }).finish();
    const response = await sendMsgAsync('gamepb.globalscenepb.GlobalSceneService', 'PlayerSceneLogin', body);
    const scene = types.PlayerSceneLoginReply.decode(response.body);
    const data = globalSceneId === 2 ? scene.big_farm_scene_ext_data : scene.farm_scene_ext_data;
    if (scene.global_scene_id !== globalSceneId || !data?.length) throw new Error('游戏场景登录回包不完整');
    userState.globalSceneId = globalSceneId;
    if (toNum(scene.server_time) > 0) syncServerTime(toNum(scene.server_time));
    return scene;
}
function getWsErrorState() { return { ...wsErrorState }; }
function setWsErrorState(code: number, message: string): void {
    wsErrorState = { code: Number(code) || 0, at: Date.now(), message: message || '' };
}
function clearWsErrorState(): void {
    wsErrorState = { code: 0, at: 0, message: '' };
}

function hasOwn(obj: any, key: string): boolean {
    return !!obj && Object.hasOwn(obj, key);
}

// 登录后获取用户设置
async function fetchUserSettings(): Promise<void> {
    try {
        const body = types.GetUserSettingsRequest.encode(types.GetUserSettingsRequest.create({})).finish();
        const { body: replyBody } = await sendMsgAsync('gamepb.userpb.UserService', 'GetUserSettings', body);
        const reply = types.GetUserSettingsReply.decode(replyBody);
        if (reply.settings) {
            log('系统', `用户设置已同步`);
        }
    } catch {
        // 忽略获取失败
    }
}

// ============ 消息编解码 ============
async function encodeMsg(serviceName: string, methodName: string, bodyBytes: Buffer, clientSeqValue: number): Promise<Buffer> {
    let finalBody = bodyBytes || Buffer.alloc(0);
    if (finalBody.length > 0) {
        finalBody = await cryptoWasm.encryptBuffer(finalBody);
    }
    const msg = types.GateMessage.create({
        meta: {
            service_name: serviceName,
            method_name: methodName,
            message_type: 1,
            client_seq: toLong(clientSeqValue),
            server_seq: toLong(serverSeq),
        },
        body: finalBody,
        token: gatewayTokens.next(),
    });
    return types.GateMessage.encode(msg).finish();
}

function isCurrentConnection(context: ConnectionContext): boolean {
    return currentConnection === context && ws === context.socket && !context.finalized;
}

async function sendMsg(context: ConnectionContext, serviceName: string, methodName: string, bodyBytes: Buffer, pending?: PendingRequest, hooks?: Pick<SendMsgOptions, 'prepareSend' | 'beforeSend' | 'onSent'> & { settled?: boolean }): Promise<boolean> {
    if (!isCurrentConnection(context) || context.socket.readyState !== WebSocket.OPEN) {
        log('系统', '[WS] 连接未打开');
        return false;
    }
    const seq = clientSeq;
    clientSeq += 1;
    // 加密前登记在途请求，确保排队器能准确计算并发槽位。
    if (pending) pendingCallbacks.set(seq, pending);
    const write = async () => {
        const encoded = await encodeMsg(serviceName, methodName, bodyBytes, seq);
        if (hooks?.settled || (pending && pendingCallbacks.get(seq) !== pending)) return false;
        if (hooks?.prepareSend) {
            await hooks.prepareSend();
            if (hooks?.settled || (pending && pendingCallbacks.get(seq) !== pending)) return false;
        }
        if (!isCurrentConnection(context) || context.socket.readyState !== WebSocket.OPEN) {
            if (pending) {
                pendingCallbacks.delete(seq);
                pending.callback(Object.assign(new Error(`连接未打开: ${methodName}`), { code: 'GAME_OFFLINE' }));
            }
            return false;
        }
        const blocked = hooks?.beforeSend?.();
        if (blocked) throw blocked;
        try {
            context.socket.send(encoded);
            hooks?.onSent?.();
        } catch (err: any) {
            if (pending) {
                pendingCallbacks.delete(seq);
                pending.callback(err);
            }
            return false;
        }
        return true;
    };
    // 宿主内的业务发送可能等待后端确认，按已经分配的序号写入同一条连接。
    if (process.env.FARM_GATEWAY_WORKER !== '1') return write();
    const result = (context.writeTail || Promise.resolve()).then(write);
    context.writeTail = result.then(() => {}, () => {});
    return result;
}

/** Promise 版发送 */
function sendMsgAsync(serviceName: string, methodName: string, bodyBytes: Buffer, timeoutOrOptions: number | SendMsgOptions = 20000): Promise<{ body: Buffer; meta: any }> {
    const options: SendMsgOptions = typeof timeoutOrOptions === 'number'
        ? { timeoutMs: timeoutOrOptions }
        : (timeoutOrOptions || {});
    const timeoutMs = Math.max(1, Number(options.timeoutMs) || 20000);
    const expectedErrorCodes = new Set((options.expectedErrorCodes || []).map(Number).filter(Number.isFinite));
    const criticalLane: CriticalLane | undefined = options.criticalLane === 'heartbeat' || options.criticalLane === 'ace'
        ? options.criticalLane
        : undefined;
    const expectReply = options.expectReply !== false;
    // 班次由「显式 requestClass > priority 兼容映射 > 调度器注入的环境班次 > 前台」决定。
    const requestClass: RequestClass = resolveRequestClass(
        { priority: options.priority, requestClass: options.requestClass, criticalLane },
        getAmbientRequestClass(),
    );
    if (hosted) {
        return hosted.request(serviceName, methodName, bodyBytes, { timeoutMs, requestClass, criticalLane, expectReply, expectedErrorCodes: [...expectedErrorCodes] }, options)
            .then(result => {
                invalidateForecastForReply(serviceName, methodName);
                return result;
            }, error => {
                if (error.name === 'GatewayError') Object.setPrototypeOf(error, GatewayError.prototype);
                if (error.name === 'GatewayBusyError') Object.setPrototypeOf(error, GatewayBusyError.prototype);
                throw error;
            });
    }
    return new Promise((resolve, reject) => {
        const context = currentConnection;
        if (!context || !isCurrentConnection(context) || context.socket.readyState !== WebSocket.OPEN) {
            reject(Object.assign(new Error(`连接未打开: ${methodName}`), { code: 'GAME_OFFLINE' }));
            return;
        }
        if (context.phase !== 'online') {
            reject(Object.assign(new Error(`账号尚未登录: ${methodName}`), { code: 'GAME_OFFLINE' }));
            return;
        }

        // 每个班次有独立的排队配额：后台任务把自己的配额排满，也不会占掉前台/心跳的名额。
        if (isClassQueueFull(requestQueue, requestClass)) {
            reject(new Error(
                `请求等待队列已满: ${methodName} (class=${requestClass}, limit=${maxQueuedForClass(requestClass)}, `
                + `queued=${requestQueue.length}, pending=${pendingCallbacks.size})`,
            ));
            return;
        }

        const requestId = nextRequestId++;
        const request: QueuedRequest = {
            context,
            serviceName,
            methodName,
            bodyBytes,
            expectedErrorCodes,
            resolve,
            reject,
            timeoutKey: `request_timeout_${requestId}`,
            queueWaitKey: `request_queue_wait_${requestId}`,
            seq: null,
            settled: false,
            affectsOwnFarm: requestAffectsOwnFarm(serviceName, methodName, bodyBytes),
            requestClass,
            criticalLane,
            enqueuedAt: performance.now(),
            expectReply,
            prepareSend: options.prepareSend,
            beforeSend: options.beforeSend,
            onSent: options.onSent,
        };
        requestQueue.push(request);
        networkScheduler.setTimeoutTask(request.timeoutKey, timeoutMs, () => {
            if (request.seq !== null) pendingCallbacks.delete(request.seq);
            const index = requestQueue.indexOf(request);
            if (index >= 0) requestQueue.splice(index, 1);
            const stage = request.seq === null ? 'queued' : 'pending';
            settleQueuedRequest(request, new Error(`请求超时: ${methodName} (stage=${stage}, pending=${pendingCallbacks.size}, queued=${requestQueue.length}, active=${describePendingRequests()})`));
            drainRequestQueue();
        });
        // 后台班次都有队列等待上限：拿到排队资格后等不到槽位就让路，而不是一路熬满 20s 请求超时。
        // background 是补数据，最激进（8s）；farm/friend 是定时任务，给的宽容度大一些（12s）；
        // foreground / critical 是实时流量，不设让路上限，必须等到有槽位或请求超时。
        let queueWaitMs = 0;
        if (requestClass === 'background') queueWaitMs = Math.min(timeoutMs, LOW_PRIORITY_QUEUE_WAIT_MS);
        else if (requestClass === 'farm' || requestClass === 'friend') queueWaitMs = Math.min(timeoutMs, BUSINESS_QUEUE_WAIT_MS);
        if (queueWaitMs > 0) {
            networkScheduler.setTimeoutTask(request.queueWaitKey, queueWaitMs, () => {
                if (request.settled || request.seq !== null) return;
                const index = requestQueue.indexOf(request);
                if (index >= 0) requestQueue.splice(index, 1);
                const classLabel = requestClass === 'background' ? '后台请求'
                    : requestClass === 'farm' ? '农场定时请求'
                    : requestClass === 'friend' ? '好友定时请求'
                    : '请求';
                settleQueuedRequest(request, new GatewayBusyError(
                    `网关繁忙，${classLabel}已让路: ${methodName} (class=${requestClass}, waited=${queueWaitMs}ms, `
                    + `pending=${pendingCallbacks.size}, queued=${requestQueue.length}, active=${describePendingRequests()})`,
                ));
            });
        }
        drainRequestQueue();
        logRequestPressure();
    });
}

async function sendMsgNoReply(serviceName: string, methodName: string, bodyBytes: Buffer, onSent?: () => void): Promise<void> {
    // 即使调用方不需要回包，也必须经过同一调度器，不能绕过心跳/ACE保护和并发上限。
    // 不写死班次，交给环境班次判定：后台任务发的通知不该被当成前台流量。
    await sendMsgAsync(serviceName, methodName, bodyBytes, { expectReply: false, onSent });
}

// ============ 消息处理 ============
function handleMessage(data: Buffer): void {
    try {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
        const msg = types.GateMessage.decode(buf);
        lastInboundMono = performance.now();
        const meta = msg.meta;
        if (!meta) return;

        if (meta.server_seq) {
            const seq = toNum(meta.server_seq);
            if (seq > serverSeq) serverSeq = seq;
        }

        const msgType = meta.message_type;

        // Notify
        if (msgType === 3) {
            handleNotify(msg);
            networkEvents.emit('sessionNotify', buf);
            return;
        }

        // Response
        if (msgType === 2) {
            const errorCode = toNum(meta.error_code);
            const clientSeqVal = toNum(meta.client_seq);

            const pending = pendingCallbacks.get(clientSeqVal);
            const expectedError = !!pending && pending.expectedErrorCodes.has(errorCode);
            if (errorCode !== 0 && !expectedError) {
                logWarn('错误', `${meta.service_name}.${meta.method_name} code=${errorCode} ${meta.error_message || ''}`);
            }

            if (pending) {
                pendingCallbacks.delete(clientSeqVal);
                if (errorCode !== 0) {
                    pending.callback(new GatewayError(meta));
                } else {
                    // 只有影响自家土地的回包才作废土地快照：好友农场的操作动的是别人家的地。
                    if (pending.affectsOwnFarm) invalidateLandForecast();
                    pending.callback(null, msg.body, meta);
                }
                
            }
        }
    } catch (err: any) {
        logWarn('解码', err.message);
    }
}

function invalidateForecastForReply(service: string, method: string) {
    if ((service === 'gamepb.plantpb.PlantService' && method !== 'AllLands')
        || (service === 'gamepb.itempb.ItemService' && method === 'Use')) invalidateLandForecast();
}

function handleNotify(msg: any): void {
    if (!msg.body || msg.body.length === 0) return;
    try {
        const event = types.EventMessage.decode(msg.body);
        const type = event.message_type || '';
        const eventBody = event.body;

        // 被踢下线
        if (type.includes('Kickout')) {
            log('推送', `被踢下线! ${type}`);
            try {
                const notify = types.KickoutNotify.decode(eventBody);
                const reasonCode = toNum(notify.reason);
                const diagnostics = getConnectionDiagnostics(currentConnection);
                log('推送', `原因: ${notify.reason_message || '未知'} (${reasonCode})`, { reasonCode, diagnostics });
                networkEvents.emit('kickout', {
                    type,
                    reason: notify.reason_message || '未知',
                    reasonCode,
                    diagnostics,
                });
            } catch {}
            return;
        }

        // 土地状态变化
        if (type.includes('LandsNotify')) {
            try {
                const notify = types.LandsNotify.decode(eventBody);
                const hostGid = toNum(notify.host_gid);
                const lands = notify.lands || [];
                if (lands.length > 0) {
                    if (hostGid === userState.gid || hostGid === 0) {
                        invalidateLandForecast();
                        networkEvents.emit('landsChanged', lands, hostGid);
                    }
                }
            } catch {}
            return;
        }

        // 青蛙等农场级社交事件变化。与乌云不同，它不附着在 LandInfo 上。
        if (type.includes('FarmSocialEventsNotify')) {
            try {
                const notify = types.FarmSocialEventsNotify.decode(eventBody);
                const hostGid = toNum(notify.host_gid);
                if (hostGid === userState.gid || hostGid === 0) {
                    networkEvents.emit('farmSocialEventsChanged', notify.social_events || []);
                }
            } catch {}
            return;
        }

        // 特殊天气变化。通知携带天气所属农场 GID；空 weather 表示天气结束。
        if (type.includes('WeatherChangeNotify')) {
            try {
                const notify = types.WeatherChangeNotify.decode(eventBody);
                networkEvents.emit('weatherChanged', {
                    hostGid: toNum(notify.host_gid),
                    weather: notify.weather || null,
                });
            } catch {}
            return;
        }

        // 护主犬“同气连枝”主人侧待拾取礼包数量。
        if (type.includes('PendingGiftCountNotify')) {
            try {
                const notify = types.PendingGiftCountNotify.decode(eventBody);
                networkEvents.emit('dogSkillGiftPending', Math.max(0, toNum(notify.count)));
            } catch {}
            return;
        }

        // 守护日志新增通知的真实事件体为空，仅作为失效信号使用。
        if (type.includes('NewProtectLogNotify')) {
            networkEvents.emit('dogProtectLogChanged');
            return;
        }

        if (type === 'gamepb.shoppb.RotationShopNotify') {
            const rotation = types.RanchRotationShopNotify.decode(eventBody).shops.find((shop: any) => toNum(shop.shop_id) === 7);
            if (rotation) networkEvents.emit('ranchMarketVisitChanged', rotation);
            return;
        }

        if (type === 'gamepb.homesteadpb.FacilitiesNotify') {
            const notify = types.RanchFacilitiesNotify.decode(eventBody);
            const hostGid = toNum(notify.host_gid);
            if (hostGid > 0 && hostGid === userState.gid) networkEvents.emit('ranchFacilitiesChanged', notify.facilities);
            return;
        }

        // 物品变化通知
        if (type.includes('ItemNotify')) {
            try {
                const notify = types.ItemNotify.decode(eventBody);
                const items = notify.items || [];
                for (const itemChg of items) {
                    const item = itemChg.item;
                    if (!item) continue;
                    const id = toNum(item.id);
                    const count = toNum(item.count);
                    const delta = toNum(itemChg.delta);

                    if (id === 1101) {
                        if (count > 0) userState.exp = count;
                        else if (delta !== 0) userState.exp = Math.max(0, Number(userState.exp || 0) + delta);
                        updateStatusLevel(userState.level, userState.exp);
                    } else if (id === 1 || id === 1001) {
                        if (count > 0) {
                            userState.gold = count;
                        } else if (delta !== 0) {
                            userState.gold = Math.max(0, Number(userState.gold || 0) + delta);
                        }
                        updateStatusGold(userState.gold);
                    } else if (id === 1002) {
                        if (count > 0) {
                            userState.coupon = count;
                        } else if (delta !== 0) {
                            userState.coupon = Math.max(0, Number(userState.coupon || 0) + delta);
                        }
                    } else if ((id === 7002 || id === 1008) && delta > 0) {
                        // 集市货币到账后唤醒牧场例程，按最新余额和报价兑换。
                        networkEvents.emit('ranchMarketStockReady', { id, count, delta });
                    } else if (id === 1005) {
                        if (count > 0) {
                            userState.goldBean = count;
                        } else if (delta !== 0) {
                            userState.goldBean = Math.max(0, Number(userState.goldBean || 0) + delta);
                        }
                    }
                }
                networkEvents.emit('itemChanges', items);
            } catch {}
            return;
        }

        // 基本信息变化
        if (type.includes('BasicNotify')) {
            try {
                const notify = types.BasicNotify.decode(eventBody);
                if (notify.basic) {
                    if (hasOwn(notify.basic, 'share_infos')) applyShareInfos(notify.basic.share_infos);
                    if (hasOwn(notify.basic, 'level')) {
                        const nextLevel = toNum(notify.basic.level);
                        if (Number.isFinite(nextLevel) && nextLevel > 0) userState.level = nextLevel;
                    }
                    let shouldUpdateGoldView = false;
                    if (hasOwn(notify.basic, 'gold')) {
                        const nextGold = toNum(notify.basic.gold);
                        if (Number.isFinite(nextGold) && nextGold >= 0) {
                            userState.gold = nextGold;
                            shouldUpdateGoldView = true;
                        }
                    }
                    if (hasOwn(notify.basic, 'exp')) {
                        const exp = toNum(notify.basic.exp);
                        if (Number.isFinite(exp) && exp >= 0) {
                            userState.exp = exp;
                            updateStatusLevel(userState.level, exp);
                        }
                    }
                    if (shouldUpdateGoldView) {
                        updateStatusGold(userState.gold);
                    }
                }
            } catch {}
            return;
        }

        // 好友申请通知
        if (type.includes('FriendApplicationReceivedNotify')) {
            try {
                const notify = types.FriendApplicationReceivedNotify.decode(eventBody);
                const applications = notify.applications || [];
                if (applications.length > 0) {
                    networkEvents.emit('friendApplicationReceived', applications);
                }
            } catch {}
            return;
        }

        // 好友添加成功通知
        if (type.includes('FriendAddedNotify')) {
            try {
                const notify = types.FriendAddedNotify.decode(eventBody);
                const friends = notify.friends || [];
                if (friends.length > 0) {
                    const names = friends.map((f: any) => f.name || f.remark || '未命名好友').join(', ');
                    log('好友', `新好友: ${names}`);
                }
            } catch {}
            return;
        }

        if (type.includes('GlobalSceneUnlockNotify')) {
            const notify = types.GlobalSceneUnlockNotify.decode(eventBody);
            userState.unlockedSceneIds = [...new Set([...userState.unlockedSceneIds, ...notify.unlocked_scenes])];
            return;
        }

        // 商品解锁通知
        if (type.includes('GoodsUnlockNotify')) {
            try {
                const notify = types.GoodsUnlockNotify.decode(eventBody);
                const goods = notify.goods_list || [];
                if (goods.length > 0) {
                    networkEvents.emit('goodsUnlockNotify', goods);
                }
            } catch {}
            return;
        }

        // 任务状态变化通知
        if (type.includes('TaskInfoNotify')) {
            try {
                const notify = types.TaskInfoNotify.decode(eventBody);
                if (notify.task_info) {
                    networkEvents.emit('taskInfoNotify', notify.task_info, { globalSceneId: userState.globalSceneId });
                }
            } catch {}
            return;
        }

        // VIP信息更新通知
        if (type.includes('VipInfoUpdatedNTF')) {
            try {
                const notify = types.VipInfoUpdatedNTF.decode(eventBody);
                networkEvents.emit('vipInfoUpdated', notify);
            } catch {}
            return;
        }

        // 商城需求通知
        if (type.includes('NeedNotify')) {
            try {
                const notify = types.NeedNotify.decode(eventBody);
                networkEvents.emit('mallNeedNotify', notify);
            } catch {}
            return;
        }

        // 商品变更通知
        if (type.includes('ProductsHasChangedNotify')) {
            try {
                const notify = types.ProductsHasChangedNotify.decode(eventBody);
                networkEvents.emit('productsChanged', notify);
            } catch {}
            return;
        }

        // 活动变更通知
        if (type.includes('ActiviesChangeNotify')) {
            try {
                const notify = types.ActiviesChangeNotify.decode(eventBody);
                networkEvents.emit('activitiesChanged', notify);
            } catch {}
            return;
        }

        // 头像框红点通知
        if (type.includes('AvatarFrameRedDotNotify')) {
            try {
                networkEvents.emit('avatarFrameRedDot');
            } catch {}
            return;
        }

        // 图鉴奖励红点通知
        if (type.includes('IllustratedRewardRedDotNotifyV2')) {
            try {
                const notify = types.IllustratedRewardRedDotNotifyV2.decode(eventBody);
                networkEvents.emit('illustratedRewardRedDot', notify);
                networkEvents.emit('ranchBookReward', 'normal', notify.ranch_reward_available);
            } catch {}
            return;
        }

        // 充值信息变更通知
        if (type.includes('RechargeInfoNotify')) {
            try {
                const notify = types.RechargeInfoNotify.decode(eventBody);
                networkEvents.emit('rechargeInfoChanged', notify);
            } catch {}
            return;
        }

        // 公告板变更通知
        if (type.includes('BulletinListChangedNTF')) {
            try {
                const notify = types.BulletinListChangedNTF.decode(eventBody);
                networkEvents.emit('bulletinListChanged', notify);
            } catch {}
            return;
        }

        // 皮肤变更通知
        if (type.includes('SkinChangeNotify')) {
            try {
                const notify = types.SkinChangeNotify.decode(eventBody);
                networkEvents.emit('skinChanged', notify);
            } catch {}
            
        }
    } catch (e: any) {
        logWarn('推送', `解码失败: ${e.message}`);
    }
}

// ============ 登录 ============
// QQ and WeChat 1.15 both authenticate the player before entering a farm scene.
// Historical versions retain their single-stage Login wire layout.
function usesPlayerSceneLogin(clientVersion = getClientVersion()): boolean {
    const version = /^(\d+)\.(\d+)/.exec(clientVersion);
    return !!version && (Number(version[1]) > 1 || (Number(version[1]) === 1 && Number(version[2]) >= 15));
}

function buildLoginBody(clientVersion = getClientVersion()): Buffer {
    const modern = usesPlayerSceneLogin(clientVersion);
    const requestType = modern ? types.PlayerLoginRequest : types.LoginRequest;
    return Buffer.from(requestType.encode(requestType.create({
        sharer_id: toLong(0),
        sharer_open_id: '',
        device_info: getLoginDeviceInfo(clientVersion),
        share_cfg_id: toLong(0),
        // A standalone WeChat Code does not supply its entry-dependent launch scene.
        scene_id: isWechatPlatform() ? undefined : '1234567',
        report_data: {
            ...(modern ? {} : { callback: '', cd_extend_info: '', click_id: '', clue_token: '', req_id: '', trackid: '' }),
            minigame_channel: isWechatPlatform() ? 'other' : 'other-qq',
            minigame_platid: 2,
        },
        ...(modern ? { share_key: '', game_scene_id: 1 } : { extra: Buffer.alloc(0) }),
    })).finish());
}

async function sendLogin(context: ConnectionContext, onLoginSuccess?: () => void): Promise<void> {
    const modern = usesPlayerSceneLogin(context.clientVersion);
    const body = buildLoginBody(context.clientVersion);
    await sendMsg(context, 'gamepb.userpb.UserService', modern ? 'PlayerLogin' : 'Login', body, {
        expectedErrorCodes: new Set(),
        // 登录不走排队器（此时还没 online），按保命流量记账。
        requestClass: 'critical',
        callback: async (err, bodyBytes, _meta) => {
        if (!isCurrentConnection(context)) return;
        if (err) {
            log('登录', `失败: ${err.message}`);
            if (err.message.includes('code=')) {
                log('系统', '账号验证失败，即将停止运行...');
                networkScheduler.setTimeoutTask('login_error_exit', 1000, () => process.exit(0));
            }
            return;
        }

        let reply: any;
        try {
            reply = (modern ? types.PlayerLoginReply : types.LoginReply).decode(bodyBytes!);
        } catch (e: any) {
            log('登录', `解码失败: ${e.message}`);
            return;
        }
        if (!reply.basic) {
            log('登录', '失败: 登录响应缺少账号信息');
            return;
        }

        clearWsErrorState();
        userState.gid = toNum(reply.basic.gid);
        userState.name = reply.basic.name || '未知';
        userState.level = toNum(reply.basic.level);
        userState.gold = toNum(reply.basic.gold);
        userState.exp = toNum(reply.basic.exp);
        userState.openId = String(reply.basic.open_id || '').trim();
        userState.avatarUrl = String(reply.basic.avatar_url || '').trim();
        userState.unlockedSceneIds = modern ? (reply.unlocked_scene_ids || []).map(toNum) : [1];
        shareInfoState.clear();
        applyShareInfos(reply.basic.share_infos);

        updateStatusFromLogin({
            name: userState.name,
            level: userState.level,
            gold: userState.gold,
            exp: userState.exp,
            avatarUrl: userState.avatarUrl,
        });

        log('系统', `登录成功: ${userState.name} (Lv${userState.level})`);

        if (context.loginInitialized) return;
        context.loginInitialized = true;

        console.warn('');
        console.warn('========== 登录成功 ==========');
        console.warn(`  GID:    ${userState.gid}`);
        console.warn(`  昵称:   ${userState.name}`);
        console.warn(`  等级:   ${userState.level}`);
        console.warn(`  金币:   ${userState.gold}`);
        if (reply.time_now_millis) {
            syncServerTime(toNum(reply.time_now_millis));
            console.warn(`  时间:   ${new Date(toNum(reply.time_now_millis)).toLocaleString()}`);
        }
        console.warn('===============================');
        console.warn('');

        try {
            if (userState.openId) {
                await cryptoWasm.bindUser(userState.openId);
                const initTokenLength = gatewayTokens.stageInitToken(cryptoWasm.getEncryptedInitInfo());
                if (initTokenLength > 0) {
                    log('ACE', `TSDK 初始化凭据已就绪: ${initTokenLength} 字符，将随下一条请求发送`);
                }
            }
            if (!isCurrentConnection(context)) return;
            networkScheduler.clear('login_timeout');
            context.phase = 'online';
            context.onlineMono = performance.now();
            startAceRuntime((service: string, method: string, body: Buffer, timeoutMs?: number) => (
                sendMsgAsync(service, method, body, { timeoutMs, priority: 'high', criticalLane: 'ace' })
            ));
            startHeartbeat(context);
            startWebSocketPing(context);
            // 登录引导阶段串行完成普通请求，避免和后续活动、背包初始化同时挤入 Gateway。
            await fetchUserSettings();
            if (!isCurrentConnection(context)) return;
            if (modern) {
                await loginGameScene(1);
                if (!isCurrentConnection(context)) return;
            }
            if (onLoginSuccess) await onLoginSuccess();
        } catch (e: any) {
            logWarn('登录', `登录初始化失败: ${e.message}`);
            finalizeConnection(context, {
                source: 'login_init_failed',
                reason: e.message,
            });
            try { (context.socket as any).terminate(); } catch {}
        }
        },
    });
}

// ============ 心跳 ============
const HEARTBEAT_REQUEST_TIMEOUT = 20000;

function buildHeartbeatBody(gid: number, clientVersion = getClientVersion()): Buffer {
    return Buffer.from(types.HeartbeatRequest.encode(types.HeartbeatRequest.create({
        gid: toLong(gid),
        client_version: clientVersion,
        field_3: toLong(0),
    })).finish());
}

function startHeartbeat(context: ConnectionContext): void {
    networkScheduler.clear('heartbeat_interval');
    const heartbeat = { attempts: 0, replies: 0, failures: 0 };
    context.heartbeat = heartbeat;
    lastHeartbeatMono = performance.now();
    lastInboundMono = performance.now();
    heartbeatMissCount = 0;

    networkScheduler.setIntervalTask('heartbeat_interval', CONFIG.heartbeatInterval, async () => {
        if (!isCurrentConnection(context) || context.phase !== 'online' || !userState.gid) return;

        const body = buildHeartbeatBody(userState.gid, context.clientVersion);
        heartbeat.attempts += 1;
        try {
            const { body: replyBody } = await sendMsgAsync(
                'gamepb.userpb.UserService',
                'Heartbeat',
                body,
                { timeoutMs: HEARTBEAT_REQUEST_TIMEOUT, priority: 'high', criticalLane: 'heartbeat' },
            );
            if (!isCurrentConnection(context)) return;
            heartbeat.replies += 1;
            networkEvents.emit('sessionTelemetry');
            lastHeartbeatMono = performance.now();
            heartbeatMissCount = 0;
            try {
                const reply = types.HeartbeatReply.decode(replyBody);
                if (reply.server_time) syncServerTime(toNum(reply.server_time));
            } catch {}
        } catch {
            if (!isCurrentConnection(context)) return;
            heartbeat.failures += 1;
            heartbeatMissCount += 1;
            const now = performance.now();
            const inboundSilenceMs = Math.max(0, now - lastInboundMono);
            const heartbeatSilenceMs = Math.max(0, now - lastHeartbeatMono);
            logWarn(
                '心跳',
                `心跳未响应 (miss=${heartbeatMissCount}/${MAX_HEARTBEAT_MISSES}, `
                + `heartbeat=${Math.round(heartbeatSilenceMs / 1000)}s, inbound=${Math.round(inboundSilenceMs / 1000)}s, `
                + `pending=${pendingCallbacks.size}, queued=${requestQueue.length}, active=${describePendingRequests()})`,
            );
            if (!shouldTerminateForHeartbeat(heartbeatMissCount, inboundSilenceMs)) return;

            log('心跳', '连续心跳超时且连接无入站数据，账号将停止运行...');
            finalizeConnection(context, {
                source: 'heartbeat_timeout',
                reason: `${Math.round(inboundSilenceMs / 1000)}s 无入站数据，连续 ${heartbeatMissCount} 次心跳失败`,
            });
            try { (context.socket as any).terminate(); } catch {}
        }
    }, { preventOverlap: true });
}

/**
 * WebSocket 协议级保活 + 入站静默快速检测。
 *
 * 应用层心跳（25s × 3 次 + 30s 静默 ≈ 105s）才判死太慢了。这个函数加两道保险：
 * 1. 每 15s 发一个 WebSocket ping 控制帧——不占业务班次、不产生请求超时，服务器必须在 10s 内回 pong；
 * 2. 每 15s 检查一次入站静默：超过 45s 没有任何入站数据（业务回包、pong、推送通知一律算）就主动 terminate。
 *
 * 判定逻辑非常保守：只有"完全没有任何入站"才触发，避免误伤。pong 帧到达
 * 时和业务回包一样会把 lastInboundMono 推到最新。
 */
function startWebSocketPing(context: ConnectionContext): void {
    if (typeof networkScheduler.setIntervalTask !== 'function') return;
    networkScheduler.clear('ws_ping_interval');
    // 记录本次连接是否见过至少一个 pong，用来区分「服务器不支持 ws ping」和「服务器静默」。
    let everSawPong = false;

    networkScheduler.setIntervalTask('ws_ping_interval', WS_PING_INTERVAL_MS, () => {
        if (!isCurrentConnection(context) || context.phase !== 'online') return;
        if (context.intentionalClose || context.finalized) return;
        const socket = context.socket as any;
        if (!socket || socket.readyState !== WebSocket.OPEN) return;

        // 1) 发 WebSocket ping。try/catch 防御 socket 正在关闭时抛错。
        try {
            socket.ping();
        } catch {}

        // 2) 服务器曾回过 pong，说明 ping/pong 通道工作正常。
        if (lastPongMono > 0) everSawPong = true;

        // 3) 入站静默检查：所有入站（业务回包、推送、pong）都算。
        const now = performance.now();
        const inboundSilenceMs = Math.max(0, now - lastInboundMono);
        if (inboundSilenceMs >= INBOUND_SILENCE_FATAL_MS) {
            const pongSilenceMs = lastPongMono > 0 ? Math.round(inboundSilenceMs) : -1;
            const kind = everSawPong
                ? `pong 和业务回包均中断 ${Math.round(inboundSilenceMs / 1000)}s`
                : everSawPong === false
                    ? `从未收到过 pong，业务回包也中断 ${Math.round(inboundSilenceMs / 1000)}s`
                    : `无任何入站 ${Math.round(inboundSilenceMs / 1000)}s`;
            logWarn('系统', `[WS] 连接静默判定死亡: ${kind}，将主动关闭重连`);
            finalizeConnection(context, {
                source: 'ws_silent',
                reason: `${Math.round(inboundSilenceMs / 1000)}s 无入站数据 (pongSilenceMs=${pongSilenceMs})`,
            });
            try { socket.terminate(); } catch {}
        }
    }, { preventOverlap: true });
}

interface DisconnectDetails {
    source: string;
    code?: number;
    reason?: string;
}

function clearNetworkRuntime(reason: string): void {
    const error = Object.assign(new Error(`请求已中断: ${reason}`), { code: 'GAME_OFFLINE' });
    rejectAllQueuedRequests(error);
    rejectAllPendingRequests(error);
    networkScheduler.clearAll();
    stopAceRuntime(true);
    gatewayTokens.clear();
    invalidateLandForecast();
    userState.gid = 0;
    userState.openId = '';
}

function getConnectionDiagnostics(context: ConnectionContext | null) {
    return {
        platform: CONFIG.platform,
        clientVersion: context?.clientVersion || getClientVersion(),
        connectionAgeMs: context?.startedMono !== undefined ? Math.max(0, performance.now() - context.startedMono) : 0,
        onlineAgeMs: context?.onlineMono !== undefined ? Math.max(0, performance.now() - context.onlineMono) : 0,
        heartbeat: context?.heartbeat ? { ...context.heartbeat } : null,
        ...getGatewayLoad(),
        lastInboundAgeMs: Math.max(0, performance.now() - lastInboundMono),
        lastHeartbeatAgeMs: Math.max(0, performance.now() - lastHeartbeatMono),
        heartbeatMissCount,
        pendingRequests: describePendingRequests(),
        queuedRequests: describeQueuedRequests(),
        ace: context?.phase === 'online' ? getAceDiagnostics() : null,
        tsdk: cryptoWasm.getDiagnostics(),
    };
}

function finalizeConnection(context: ConnectionContext, details: DisconnectDetails): void {
    if (context.finalized) return;
    context.finalized = true;
    const wasCurrent = currentConnection === context;
    const wasLoginReady = context.phase === 'online';
    // Snapshot before cleanup destroys TSDK state and clears request queues.
    const diagnostics = getConnectionDiagnostics(context);
    if (wasCurrent) {
        log('连接', '会话结束', {
            event: 'connection_summary',
            connectionId: context.id,
            source: details.source,
            disconnectCode: Number(details.code) || 0,
            phase: context.phase,
            intentionalClose: context.intentionalClose,
            diagnostics,
        });
        currentConnection = null;
        ws = null;
        clearNetworkRuntime(details.reason || details.source);
    }
    if (!wasCurrent || context.intentionalClose) return;
    networkEvents.emit('disconnected', {
        connectionId: context.id,
        source: details.source,
        code: Number(details.code) || 0,
        reason: details.reason || '',
        phase: context.phase,
        wasLoginReady,
        diagnostics,
        at: Date.now(),
    });
}

// ============ WebSocket 连接 ============
function connect(code: string | null, onLoginSuccess?: () => void): void {
    if (hosted) {
        void hosted.connect(code, onLoginSuccess);
        return;
    }
    const authCode = String(code || '').trim();
    if (!authCode) throw new Error('连接缺少一次性 Code');
    if (currentConnection && !currentConnection.finalized) throw new Error('WebSocket 连接已存在');

    clientSeq = 1;
    serverSeq = 0;
    lastInboundMono = performance.now();
    lastHeartbeatMono = performance.now();
    heartbeatMissCount = 0;
    const clientVersion = getClientVersion();
    const url = new URL(CONFIG.serverUrl);
    url.search = new URLSearchParams({
        platform: isWechatPlatform() ? 'wx' : CONFIG.platform,
        os: CONFIG.os,
        ver: clientVersion,
        code: authCode,
    }).toString();
    const di = CONFIG.deviceInfo || {};
    const socket = new WebSocket(url.toString(), {
        handshakeTimeout: 20000,
        headers: {
            'User-Agent': di.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 MicroMessenger/7.0.20.1781(0x6700143B) NetType/WIFI MiniProgramEnv/Windows WindowsWechat/WMPF WindowsWechat(0x63090a13)',
            'Origin': 'https://gate-obt.nqf.qq.com',
        },
    });
    // TCP 层 keepalive：空闲 30s 后开始发探测包，能让操作系统在 NAT 清表后尽快发现连接死亡。
    // 这层是 ws ping/pong 的补充——TCP 探测不依赖 WebSocket 协议。
    try { (socket as any).setKeepAlive(true, 30000); } catch {}
    // 每次新连接重置 pong 追踪，避免旧连接的脏数据污染新连接。
    lastPongMono = 0;
    const context: ConnectionContext = {
        id: nextConnectionId++,
        socket,
        phase: 'connecting',
        intentionalClose: false,
        finalized: false,
        loginInitialized: false,
        clientVersion,
        startedMono: performance.now(),
    };
    currentConnection = context;
    ws = socket;
    socket.binaryType = 'arraybuffer';

    (socket as any).on('open', () => {
        if (!isCurrentConnection(context)) return;
        context.phase = 'login';
        networkScheduler.setTimeoutTask('login_timeout', 20000, () => {
            if (!isCurrentConnection(context) || context.phase !== 'login') return;
            logWarn('登录', '登录响应超时，账号将停止运行...');
            finalizeConnection(context, { source: 'login_timeout', reason: '登录响应超时' });
            try { (socket as any).terminate(); } catch {}
        });
        sendLogin(context, onLoginSuccess).catch((e: any) => {
            if (!isCurrentConnection(context)) return;
            finalizeConnection(context, { source: 'login_send_failed', reason: e.message });
            try { (socket as any).terminate(); } catch {}
        });
    });

    (socket as any).on('message', (data: any, _isBinary: any) => {
        if (!isCurrentConnection(context)) return;
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as any);
        handleMessage(buf);
    });

    (socket as any).on('close', (closeCode: any, closeReason: any) => {
        const reason = Buffer.isBuffer(closeReason) ? closeReason.toString('utf8') : String(closeReason || '');
        console.warn(`[WS] 连接关闭 (code=${closeCode})`);
        finalizeConnection(context, { source: 'ws_close', code: Number(closeCode) || 0, reason });
    });

    (socket as any).on('error', (err: any) => {
        if (!isCurrentConnection(context)) return;
        const message = err && err.message ? String(err.message) : '';
        logWarn('系统', `[WS] 错误: ${message}`);
        const match = message.match(/Unexpected server response:\s*(\d+)/i);
        if (match) {
            const errorCode = Number.parseInt(match[1], 10) || 0;
            if (errorCode) {
                setWsErrorState(errorCode, message);
                networkEvents.emit('ws_error', { code: errorCode, message });
            }
        }
    });

    // WebSocket 协议级 pong：服务器必须在收到 ping 后 10s 内回 pong。
    // pong 和业务回包一样算入站数据，都能把 lastInboundMono 推到最新。
    (socket as any).on('pong', () => {
        lastPongMono = performance.now();
        lastInboundMono = lastPongMono;
    });
}

function cleanup(reason = '网络清理'): void | Promise<void> {
    if (hosted) return hosted.release('close');
    const context = currentConnection;
    if (!context) {
        clearNetworkRuntime(reason);
        return;
    }
    context.intentionalClose = true;
    finalizeConnection(context, { source: 'intentional_close', reason });
    try { context.socket.close(); } catch {}
}

function getWs() { return hosted ? hosted.socket : ws; }

function getSessionSnapshot() {
    return { userState: { ...userState }, shares: [...shareInfoState], serverTime: getServerTimeSec(), ...getSessionTelemetry() };
}

function getSessionTelemetry() {
    return { load: getGatewayLoad(), heartbeatReplies: currentConnection?.heartbeat?.replies || 0 };
}

function configureHostedSession(config: any) {
    if (!process.env.FARM_SESSION_SOCKET) return;
    const { HostedNetwork } = require('../session/hosted-network');
    networkEvents.on('ws_error', (data: any) => setWsErrorState(data.code, data.message));
    hosted = new HostedNetwork(config, networkEvents, (snapshot: any) => {
        clearWsErrorState();
        Object.assign(userState, snapshot.userState);
        shareInfoState.clear();
        for (const [key, value] of snapshot.shares) shareInfoState.set(key, value);
        syncServerTime(snapshot.serverTime * 1000);
        updateStatusFromLogin(userState);
    }, (body: Buffer) => handleNotify(types.GateMessage.decode(body)));
}

function invalidateGameScene(reason = '游戏场景状态未知，需要重新登录'): void {
    if (hosted) {
        hosted.invalidate(reason);
        return;
    }
    const context = currentConnection;
    if (!context) return;
    finalizeConnection(context, { source: 'game_scene_unknown', reason });
    (context.socket as any).terminate();
}

module.exports = {
    connect, cleanup, getWs, configureHostedSession,
    getSessionSnapshot, getSessionTelemetry,
    activateHostedSession: () => hosted?.activate(),
    detachHostedSession: () => hosted ? hosted.release('detach') : cleanup(),
    buildLoginBody, buildHeartbeatBody,
    sendMsgAsync, sendMsgNoReply,
    getGatewayLoad, isGatewayIdleForBackground, waitForGatewayIdle,
    GatewayError, GatewayBusyError,
    getUserState, loginGameScene, invalidateGameScene, applyShareInfos, getDailyShareInfo,
    getWsErrorState,
    networkEvents,
};
