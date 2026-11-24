export {};
const path = require('node:path');
const fs = require('node:fs');
const { getSystemDateKey } = require('../utils/utils');
function getStatsFilePath(accountId: string): string {
    const dataDir: string = process.env.FARM_DATA_DIR || path.join(__dirname, '../../data');
    return path.join(dataDir, 'stats', `${accountId}.json`);
}

function getTodayKey(): string {
    return getSystemDateKey();
}

function loadPersistedStats(accountId: string): any {
    try {
        const filePath: string = getStatsFilePath(accountId);
        if (!fs.existsSync(filePath)) return null;
        const raw: string = fs.readFileSync(filePath, 'utf8');
        if (!raw || !raw.trim()) return null;
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function savePersistedStats(accountId: string, data: any): void {
    try {
        const filePath: string = getStatsFilePath(accountId);
        const dir: string = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        const tmpPath: string = `${filePath}.${process.pid}.${Date.now()}.tmp`;
        fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
        fs.renameSync(tmpPath, filePath);
    } catch {
        // ignore
    }
}

interface OperationsMap {
    [key: string]: number;
    harvest: number;
    fertilize: number;
    plant: number;
    steal: number;
}

const operations: OperationsMap = {
    harvest: 0,
    fertilize: 0,
    plant: 0,
    steal: 0,
};

const ranchOperations: Record<string, number> = {
    harvest: 0,
    produce: 0,
    helpFarming: 0,
    steal: 0,
};

function restoreOperationCounts(target: Record<string, number>, saved: Record<string, number> = {}): void {
    for (const key of Object.keys(target)) target[key] = Number(saved?.[key]) || 0;
}

let currentDateKey: string | null = null;

const assetKeys = ['ranchCoupon', 'pinecone', 'grass', 'dung', 'diamond', 'fertilizerNormal', 'fertilizerOrganic', 'canNormal', 'canOrganic'] as const;
type AssetKey = typeof assetKeys[number];
const assetBaseline: Partial<Record<AssetKey, number>> = {};
const assetBalances: Partial<Record<AssetKey, number>> = {};

function readAssetBalances(values: any): void {
    for (const key of assetKeys) {
        const value = values?.[key];
        if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value))) continue;
        const amount = Number(value);
        if (!Number.isSafeInteger(amount) || amount < 0) continue;
        if (assetBaseline[key] === undefined) {
            assetBaseline[key] = amount;
            scheduleSave();
        }
        assetBalances[key] = amount;
    }
}

function recordAssetBalances(values: Partial<Record<AssetKey, number | string | null>>): Record<AssetKey, number | null> {
    checkAndResetDailyStats();
    if (currentAccountId) readAssetBalances(values);
    return getAssetTodayGains();
}

function getAssetTodayGains(): Record<AssetKey, number | null> {
    checkAndResetDailyStats();
    return Object.fromEntries(assetKeys.map(key => [key, assetBalances[key] === undefined || assetBaseline[key] === undefined
        ? null : assetBalances[key] - assetBaseline[key]])) as Record<AssetKey, number | null>;
}

interface LastState {
    gold: number;
    exp: number;
    coupon: number;
    goldBean: number;
}

const lastState: LastState = {
    gold: -1,
    exp: -1,
    coupon: -1,
    goldBean: -1,
};

/**
 * 当日 0 点余额基线：今日统计的统一起点。
 * - 账号在 0 点前后持续运行时，取跨天瞬间观测到的余额；
 * - 账号 0 点时未运行，则取当天首次观测到的余额作为近似值（0 点余额无法取得）。
 * 该基线只在新的一天建立一次，账号重启不会改写。
 */
interface DailyBaseline {
    gold: number;
    exp: number;
    coupon: number;
    goldBean: number | null;
}

const todayBaseline: DailyBaseline = {
    gold: 0,
    exp: 0,
    coupon: 0,
    goldBean: null,
};

/**
 * 基线可信标记：只有观测到可信余额时才允许建立 0 点基线。
 *
 * 余额为 0 时无法区分“账号真的没有钱”和“余额还没同步过来”（登录回包可能不带金币，
 * 真实余额要等背包/推送才到）。若把未同步的 0 当成基线，今日累计就会变成
 * “当前余额 − 0”，也就是把全部余额算成今日收入（金币会显示成几亿）。
 */
interface BaselineReady {
    gold: boolean;
    exp: boolean;
    coupon: boolean;
    goldBean: boolean;
}

const baselineReady: BaselineReady = {
    gold: false,
    exp: false,
    coupon: false,
    goldBean: false,
};

/**
 * 余额项的“已确认”标记：登录时从背包快照里读到过该余额项。
 *
 * 背包快照是权威余额来源：条目出现过就说明该余额是可读的真实值，
 * 即使 count 为 0 也是“余额确实为 0”，而不是“还没同步”。
 * 未确认的余额项仍按“大于 0 才可信”处理，避免把未同步的 0 当成 0 点基线。
 */
interface BalanceConfirmed {
    gold: boolean;
    exp: boolean;
    coupon: boolean;
    goldBean: boolean;
}

const balanceConfirmed: BalanceConfirmed = {
    gold: false,
    exp: false,
    coupon: false,
    goldBean: false,
};

type BalanceKey = keyof BalanceConfirmed;

/**
 * 判断一次余额观测是否可信：必须是有限数，且（大于 0 或该余额项已被权威快照确认）。
 */
function isTrustedBalance(key: BalanceKey, value: number): boolean {
    if (!Number.isFinite(value)) return false;
    return value > 0 || balanceConfirmed[key];
}

/**
 * 判断持久化的基线值本身是否可信：只有大于 0 的基线才算可信。
 * “已确认”只作用于新观测到的余额，不能把旧文件里尚未同步的 0 提升为可信基线。
 */
function isPositiveBalance(value: number): boolean {
    return Number.isFinite(value) && value > 0;
}

interface SessionData {
    goldGained: number;
    expGained: number;
    couponGained: number;
    goldBeanGained: number;
    lastExpGain: number;
    lastGoldGain: number;
    lastExpTime?: number;
}

const session: SessionData = {
    goldGained: 0,
    expGained: 0,
    couponGained: 0,
    goldBeanGained: 0,
    lastExpGain: 0,
    lastGoldGain: 0,
};

let currentAccountId: string | null = null;
let sessionStartedAt = Date.now();
let saveTimer: ReturnType<typeof setTimeout> | null = null;

interface CurrentValues {
    gold: number;
    exp: number;
    coupon: number;
    goldBean: number;
}

function recordOperation(type: string, count: number = 1, scene: 'farm' | 'ranch' = 'farm'): void {
    checkAndResetDailyStats();
    const target = scene === 'ranch' ? ranchOperations : operations;
    if (target[type] !== undefined) {
        target[type] += count;
        scheduleSave();
    }
}

/**
 * 跨天处理：清零当日动作统计，并以跨天瞬间的余额建立新一天的 0 点基线。
 */
function checkAndResetDailyStats(current?: CurrentValues): void {
    if (!currentAccountId) return;
    const todayKey: string = getTodayKey();
    if (currentDateKey && currentDateKey !== todayKey) {
        console.warn(`[统计] 检测到跨天，重置每日统计 (${currentDateKey} -> ${todayKey})`);
        restoreOperationCounts(operations);
        restoreOperationCounts(ranchOperations);
        for (const key of assetKeys) {
            delete assetBaseline[key];
            delete assetBalances[key];
        }
        const base: CurrentValues = current || {
            gold: lastState.gold,
            exp: lastState.exp,
            coupon: lastState.coupon,
            goldBean: lastState.goldBean,
        };
        establishTodayBaseline(base);
        currentDateKey = todayKey;
        scheduleSave();
    }
    currentDateKey = todayKey;
}

/**
 * 建立新一天的 0 点基线，并清空今日累计值。
 * 不可信的余额（0 或非法值）不建立基线，交给首个可信观测惰性建立。
 */
function establishTodayBaseline(current: CurrentValues): void {
    const gold: number = Number.isFinite(Number(current.gold)) ? Number(current.gold) : 0;
    const exp: number = Number.isFinite(Number(current.exp)) ? Number(current.exp) : 0;
    const coupon: number = Number.isFinite(Number(current.coupon)) ? Number(current.coupon) : 0;
    const goldBean: number = Number.isFinite(Number(current.goldBean)) ? Number(current.goldBean) : 0;
    baselineReady.gold = isTrustedBalance('gold', gold);
    todayBaseline.gold = baselineReady.gold ? gold : 0;
    baselineReady.exp = isTrustedBalance('exp', exp);
    todayBaseline.exp = baselineReady.exp ? exp : 0;
    baselineReady.coupon = isTrustedBalance('coupon', coupon);
    todayBaseline.coupon = baselineReady.coupon ? coupon : 0;
    // 金豆未同步时基线留空，等首个真实值再建立
    baselineReady.goldBean = isTrustedBalance('goldBean', goldBean);
    todayBaseline.goldBean = baselineReady.goldBean ? goldBean : null;
    lastState.gold = gold;
    lastState.exp = exp;
    lastState.coupon = coupon;
    lastState.goldBean = baselineReady.goldBean ? goldBean : -1;
    session.goldGained = 0;
    session.expGained = 0;
    session.couponGained = 0;
    session.goldBeanGained = 0;
}

function scheduleSave(): void {
    if (!currentAccountId) return;
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
        saveTimer = null;
        doSave();
    }, 2000);
}

function doSave(): void {
    if (!currentAccountId) return;
    checkAndResetDailyStats();
    const todayKey: string = getTodayKey();
    const data: any = {
        date: currentDateKey ?? getTodayKey(),
        operations: { ...operations },
        todayBaseline: { ...todayBaseline },
        baselineReady: { ...baselineReady },
        assetBaseline: { ...assetBaseline },
        ranchOperations: { ...ranchOperations },
        savedAt: Date.now(),
    };
    savePersistedStats(currentAccountId, data);
}

/**
 * 读取持久化的基线数值：null/undefined/空串视为“尚未建立基线”，避免把 null 当成 0。
 */
function readBaseNumber(value: any): number | null {
    if (value === null || value === undefined || value === '') return null;
    const num: number = Number(value);
    return Number.isFinite(num) ? num : null;
}

function readNonNegativeNumber(value: any): number {
    const num: number = readBaseNumber(value);
    return num === null ? 0 : Math.max(0, num);
}

/**
 * 重建观测点与基线：以当前数值为起点。
 * 统计文件里已有当日基线时，调用方会在此之后把基线还原为持久化的 0 点数值。
 */
function initStats(
    gold: number,
    exp: number,
    coupon: number = 0,
    goldBean: number = 0,
    confirmed: Partial<BalanceConfirmed> = {},
): void {
    sessionStartedAt = Date.now();
    // 背包快照里读到过的余额项即视为权威值：0 也是真实余额
    if (confirmed.gold) balanceConfirmed.gold = true;
    if (confirmed.exp) balanceConfirmed.exp = true;
    if (confirmed.coupon) balanceConfirmed.coupon = true;
    if (confirmed.goldBean) balanceConfirmed.goldBean = true;
    const g: number = Number.isFinite(Number(gold)) ? Number(gold) : 0;
    const e: number = Number.isFinite(Number(exp)) ? Number(exp) : 0;
    const c: number = Number.isFinite(Number(coupon)) ? Number(coupon) : 0;
    const gb: number = Number.isFinite(Number(goldBean)) ? Number(goldBean) : 0;
    lastState.gold = g;
    lastState.exp = e;
    lastState.coupon = c;
    lastState.goldBean = gb;
    // 未同步的余额（0 且未确认）不建立基线，交给首个可信观测惰性建立
    baselineReady.gold = isTrustedBalance('gold', g);
    todayBaseline.gold = baselineReady.gold ? g : 0;
    baselineReady.exp = isTrustedBalance('exp', e);
    todayBaseline.exp = baselineReady.exp ? e : 0;
    baselineReady.coupon = isTrustedBalance('coupon', c);
    todayBaseline.coupon = baselineReady.coupon ? c : 0;
    baselineReady.goldBean = isTrustedBalance('goldBean', gb);
    todayBaseline.goldBean = baselineReady.goldBean ? gb : null;
}

function initStatsWithPersistence(
    accountId: string,
    gold: number,
    exp: number,
    coupon: number = 0,
    goldBean: number = 0,
    confirmed: Partial<BalanceConfirmed> = {},
): void {
    if (currentAccountId !== accountId) {
        for (const key of assetKeys) {
            delete assetBaseline[key];
            delete assetBalances[key];
        }
    }
    currentAccountId = accountId;
    const todayKey: string = getTodayKey();
    currentDateKey = todayKey;
    const saved: any = loadPersistedStats(accountId);

    restoreOperationCounts(ranchOperations, saved?.date === todayKey ? saved.ranchOperations : undefined);
    initStats(gold, exp, coupon, goldBean, confirmed);

    if (saved && saved.date === todayKey) {
        for (const key of assetKeys) delete assetBalances[key];
        const savedAssets: any = saved.assetBaseline;
        for (const key of assetKeys) {
            const amount = readBaseNumber(savedAssets?.[key]);
            if (amount !== null && Number.isSafeInteger(amount) && amount >= 0) assetBaseline[key] = amount;
            else delete assetBaseline[key];
        }

        Object.keys(saved.operations || {}).forEach((key: string) => {
            if (operations[key] !== undefined) {
                operations[key] = Number(saved.operations[key]) || 0;
            }
        });
        // 还原当日 0 点基线：账号重启不改变统计口径
        const savedBase: any = (saved.todayBaseline && typeof saved.todayBaseline === 'object')
            ? saved.todayBaseline
            : (saved.initialState && typeof saved.initialState === 'object') ? saved.initialState : {};
        todayBaseline.gold = readNonNegativeNumber(savedBase.gold);
        todayBaseline.exp = readBaseNumber(savedBase.exp) ?? exp;
        todayBaseline.coupon = readNonNegativeNumber(savedBase.coupon);
        const savedGoldBean: number | null = readBaseNumber(savedBase.goldBean);
        todayBaseline.goldBean = savedGoldBean === null ? null : Math.max(0, savedGoldBean);
        // 基线可信标记：旧统计文件没有该字段时，按“基线值大于 0 才可信”推导
        const savedReady: any = (saved.baselineReady && typeof saved.baselineReady === 'object')
            ? saved.baselineReady
            : null;
        baselineReady.gold = savedReady ? !!savedReady.gold : isPositiveBalance(todayBaseline.gold);
        baselineReady.exp = savedReady ? !!savedReady.exp : isPositiveBalance(todayBaseline.exp);
        baselineReady.coupon = savedReady ? !!savedReady.coupon : isPositiveBalance(todayBaseline.coupon);
        baselineReady.goldBean = savedReady
            ? !!savedReady.goldBean
            : todayBaseline.goldBean !== null && isPositiveBalance(todayBaseline.goldBean);
        // 兼容更早的格式：只保存 todayGains（当日收入累计），
        // 迁移时按当前余额反推基线，保证当日已获得的金额不丢失
        if (saved.todayGains && !saved.todayBaseline) {
            const legacyGains: any = (saved.todayGains && typeof saved.todayGains === 'object') ? saved.todayGains : {};
            const legacyGold: number = readNonNegativeNumber(legacyGains.gold);
            if (legacyGold > 0) {
                todayBaseline.gold = Math.max(0, gold - legacyGold);
                baselineReady.gold = isPositiveBalance(todayBaseline.gold);
            }
            const legacyCoupon: number = readNonNegativeNumber(legacyGains.coupon);
            if (legacyCoupon > 0) {
                todayBaseline.coupon = Math.max(0, coupon - legacyCoupon);
                baselineReady.coupon = isPositiveBalance(todayBaseline.coupon);
            }
        }
        // 自愈：基线不可信时（旧版本把尚未同步的余额写成了 0），用当前余额重建基线，
        // 今日累计从当前余额重新开始，避免把全部余额算成今日收入（金币会显示成几亿）
        if (!baselineReady.gold && isTrustedBalance('gold', gold)) {
            console.warn(`[统计] 金币基线无效(${todayBaseline.gold})，按当前余额 ${gold} 重建当日基线`);
            todayBaseline.gold = gold;
            baselineReady.gold = true;
        }
        if (!baselineReady.exp && isTrustedBalance('exp', exp)) {
            todayBaseline.exp = exp;
            baselineReady.exp = true;
        }
        if (!baselineReady.coupon && isTrustedBalance('coupon', coupon)) {
            todayBaseline.coupon = coupon;
            baselineReady.coupon = true;
        }
        if (!baselineReady.goldBean && isTrustedBalance('goldBean', goldBean)) {
            todayBaseline.goldBean = goldBean;
            baselineReady.goldBean = true;
        }
        console.warn(`[统计] 已恢复今日统计数据: ${JSON.stringify(saved.operations)}`);
        return;
    }

    // 跨天或首次运行：以启动时的余额作为当日 0 点基线，并按节流写盘
    for (const key of assetKeys) {
        delete assetBaseline[key];
        delete assetBalances[key];
    }
    Object.keys(operations).forEach((key: string) => {
        operations[key] = 0;
    });
    if (saved) {
        console.warn(`[统计] 日期已变更，重置统计 (${saved.date} -> ${todayKey})`);
    }
    scheduleSave();
}

/**
 * 差分统计的唯一入口：只在 getStats 里调用，以真实余额（userState）为准。
 */
function updateStats(currentGold: number, currentExp: number, currentCoupon?: number, currentGoldBean?: number): void {
    if (lastState.gold === -1) lastState.gold = currentGold;
    if (lastState.exp === -1) lastState.exp = currentExp;

    if (lastState.gold <= 0) {
        // 上一次的余额不可信（未同步），本次观测只建立观测点
        lastState.gold = currentGold;
    } else {
        session.lastGoldGain = currentGold > lastState.gold ? currentGold - lastState.gold : 0;
        lastState.gold = currentGold;
    }

    if (currentExp > lastState.exp) {
        const delta: number = currentExp - lastState.exp;
        const now: number = Date.now();
        if (delta === session.lastExpGain && (now - (session.lastExpTime || 0) < 1000)) {
            // console.warn(`[系统] 忽略重复经验增量 +${delta}`);
        } else {
            session.lastExpGain = delta;
            session.lastExpTime = now;
            // console.warn(`[系统] 经验 +${delta} (总计: ${currentExp})`);
        }
    } else {
        session.lastExpGain = 0;
    }
    lastState.exp = currentExp;

    // 背包类货币（点券/金豆）：未拿到真实值（0）时保留上一次观测点
    if (typeof currentCoupon === 'number' && (currentCoupon > 0 || balanceConfirmed.coupon)) {
        lastState.coupon = currentCoupon;
    }
    if (typeof currentGoldBean === 'number' && (currentGoldBean > 0 || balanceConfirmed.goldBean)) {
        lastState.goldBean = currentGoldBean;
    }
}

/**
 * 状态栏推送到达时的回调：只更新“本次 +N”的瞬时展示。
 * 这里不参与差分统计：状态栏数值与真实余额可能存在瞬时差，
 * 若在此处推进观测点，同一笔收支会被重复计入，统计数字会失控放大。
 */
function recordGoldExp(gold: number, exp: number): void {
    const g: number = Number(gold);
    const e: number = Number(exp);
    if (Number.isFinite(g)) {
        session.lastGoldGain = g > lastState.gold ? g - lastState.gold : 0;
    }
    if (Number.isFinite(e)) {
        session.lastExpGain = e > lastState.exp ? e - lastState.exp : 0;
        if (session.lastExpGain > 0) session.lastExpTime = Date.now();
    }
}

function resetSessionGains(): void {
    // 今日累计由 0 点基线算出，这里只重置瞬时增量
    session.lastGoldGain = 0;
    session.lastExpGain = 0;
    session.lastExpTime = 0;
}

/**
 * 今日累计值：以 0 点基线为起点的净变化。
 * 金币/点券/金豆/经验 = 当前余额 − 0 点基线，支出会体现为负数。
 */
function computeTodayGains(current: CurrentValues): void {
    // 基线尚未建立（余额未同步）时，用首个可信观测建立基线，今日累计从 0 开始
    if (!baselineReady.gold && isTrustedBalance('gold', current.gold)) {
        todayBaseline.gold = current.gold;
        baselineReady.gold = true;
        scheduleSave();
    }
    if (!baselineReady.exp && isTrustedBalance('exp', current.exp)) {
        todayBaseline.exp = current.exp;
        baselineReady.exp = true;
        scheduleSave();
    }
    if (!baselineReady.coupon && isTrustedBalance('coupon', current.coupon)) {
        todayBaseline.coupon = current.coupon;
        baselineReady.coupon = true;
        scheduleSave();
    }
    if (!baselineReady.goldBean && isTrustedBalance('goldBean', current.goldBean)) {
        // 金豆首个真实值只作为基线建立，不计入今日变化
        todayBaseline.goldBean = current.goldBean;
        baselineReady.goldBean = true;
        scheduleSave();
    }
    session.goldGained = baselineReady.gold ? current.gold - todayBaseline.gold : 0;
    session.expGained = baselineReady.exp ? current.exp - todayBaseline.exp : 0;
    session.couponGained = baselineReady.coupon ? current.coupon - todayBaseline.coupon : 0;
    session.goldBeanGained = baselineReady.goldBean
        ? current.goldBean - (todayBaseline.goldBean as number)
        : 0;
}

function getStats(statusData: any, userState: any, connected: boolean, limits: any): any {
    const statusObj: any = (statusData && typeof statusData === 'object') ? statusData : {};
    const userObj: any = (userState && typeof userState === 'object') ? userState : {};

    const rawGold: any = userObj.gold ?? statusObj.gold;
    const rawExp: any = userObj.exp ?? statusObj.exp;
    const rawCoupon: any = userObj.coupon ?? statusObj.coupon;
    const rawGoldBean: any = userObj.goldBean ?? statusObj.goldBean;
    const currentGold: number = Number.isFinite(Number(rawGold)) ? Number(rawGold) : 0;
    const currentExp: number = Number.isFinite(Number(rawExp)) ? Number(rawExp) : 0;
    const currentCoupon: number = Number.isFinite(Number(rawCoupon)) ? Number(rawCoupon) : 0;
    const currentGoldBean: number = Number.isFinite(Number(rawGoldBean)) ? Number(rawGoldBean) : 0;
    const hasBalance = (value: any): boolean => value !== null && value !== undefined && value !== ''
        && Number.isSafeInteger(Number(value)) && Number(value) >= 0;

    checkAndResetDailyStats({ gold: currentGold, exp: currentExp, coupon: currentCoupon, goldBean: currentGoldBean });

    if (connected) {
        updateStats(currentGold, currentExp, currentCoupon, currentGoldBean);
    }
    computeTodayGains({ gold: currentGold, exp: currentExp, coupon: currentCoupon, goldBean: currentGoldBean });

    const operationsSnapshot: OperationsMap = { ...operations };
    return {
        connection: { connected },
        status: {
            name: userObj.name || statusObj.name,
            level: statusObj.level || userObj.level || 0,
            gold: currentGold,
            coupon: Number.isFinite(Number(userObj.coupon)) ? Number(userObj.coupon) : 0,
            goldBean: currentGoldBean,
            exp: currentExp,
            platform: statusObj.platform || userObj.platform || 'qq',
            avatarUrl: String(userObj.avatarUrl || statusObj.avatarUrl || '').trim(),
        },
        uptime: process.uptime(),
        sessionElapsedSeconds: Math.max(0, (Date.now() - sessionStartedAt) / 1000),
        operations: operationsSnapshot,
        ranchOperations: { ...ranchOperations },
        sessionExpGained: session.expGained,
        sessionGoldGained: session.goldGained,
        sessionCouponGained: session.couponGained,
        sessionGoldBeanGained: session.goldBeanGained,
        todayAssetGains: {
            gold: connected && hasBalance(rawGold) && baselineReady.gold && isTrustedBalance('gold', currentGold) ? session.goldGained : null,
            coupon: connected && hasBalance(rawCoupon) && baselineReady.coupon && isTrustedBalance('coupon', currentCoupon) ? session.couponGained : null,
            goldBean: connected && hasBalance(rawGoldBean) && baselineReady.goldBean && isTrustedBalance('goldBean', currentGoldBean) ? session.goldBeanGained : null,
            ...Object.fromEntries(Object.entries(getAssetTodayGains()).map(([key, value]) => [key, connected ? value : null])),
        },
        lastExpGain: session.lastExpGain,
        lastGoldGain: session.lastGoldGain,
        limits,
    };
}

function saveStats(): void {
    doSave();
}

module.exports = {
    recordOperation,
    initStats,
    initStatsWithPersistence,
    updateStats,
    recordGoldExp,
    resetSessionGains,
    getStats,
    saveStats,
    getTodayKey,
    loadPersistedStats,
    checkAndResetDailyStats,
    recordAssetBalances,
    getAssetTodayGains,
};
