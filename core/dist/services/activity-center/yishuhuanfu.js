"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const yishuhuanfu_1 = require("../../config/yishuhuanfu");
const yishuhuanfu_history_1 = require("../yishuhuanfu-history");
const yishu_quote_queue_1 = require("./yishu-quote-queue");
const daily_completion_1 = require("../daily-completion");
const { getDataFile } = require('../../config/runtime-paths');
const { readJsonFile, writeJsonFileAtomic } = require('../json-db');
/**
 * 以薯换福（2026-11-25 ~ 2026-12-09）。
 *
 * 协议来自两轮实机抓包：活动组 2026111707，主模块 2026111708（type=26）承载
 * 状态槽 field 130 与全部命令。命令走 ActivityService.Operate 的 cmd 字段，
 * 参数与回包挂在 190+cmd 号槽位：
 *   cmd 91 领每日红薯种子（回包 191：item_id=20307 / count=28）
 *   cmd 92 查指定铺子行情（参数 192.shop_gid；回包 192：价格 / 额度 / 铺主）
 *   cmd 93 卖蜜薯（参数 193：shop_gid + count；回包 193：数量 / 单价 / 总额 / 额度 / 余额）
 *   cmd 95 刷新今日行情（参数与回包均为空）
 *   cmd 96 兑换下单（参数 196：index + count；回包 196：单价 / 到手道具 / 余额）
 *   cmd 97 查兑换目录（回包 197：序号 / 价格 / 状态 / 限额）
 *   cmd 98 分享铺子（回包 198：种子奖励 / 单价 / 分享 key）
 *
 * 第二轮抓包（2026-11-25 12:49）修正了两处早期误判：
 *   - cmd 92 是只读的铺子行情查询，不是卖薯；卖薯是 cmd 93，且必须带数量。
 *   - 兑换下单是 cmd 96，索引走目录序号，服务端回包直接给出 item_id 与余额。
 */
/** 未取证的字段一律不做语义断言，相关常量集中在这里，便于后续校正。 */
const YSHF_GROUP_ID = '2026111707';
const YSHF_ACTIVITY_ID = '2026111708';
const YSHF_SEED_ITEM_ID = '20307';
const YSHF_SWEET_POTATO_ITEM_ID = '1032';
const YSHF_LUCK_COIN_ITEM_ID = '1033';
const YSHF_CMD_CLAIM_SEED = 91;
const YSHF_CMD_SHOP_QUERY = 92;
const YSHF_SHOP_SHARE_EXPIRED_CODE = 1034184;
const YSHF_SHOP_UNAVAILABLE_CODES = [1000012, 1034001, YSHF_SHOP_SHARE_EXPIRED_CODE];
const YSHF_CMD_SELL = 93;
// 95 是「收购记录列表」，不是刷新行情。2026-11-25 15:11 抓包证实：
// 请求空、回包 slot195 = repeated 收购记录；没有记录时回包为空。
const YSHF_CMD_RECORDS = 95;
const YSHF_CMD_EXCHANGE = 96;
const YSHF_CMD_CATALOG = 97;
const YSHF_CMD_SHARE = 98;
// 99 是「领取收购提成」，请求空，回包 {1:领取额, 4:领取后福气币}。
const YSHF_CMD_CLAIM_COMMISSION = 99;
// cmd 91 回包固定带 28 个种子，cmd 98 首日分享固定带 4 个，仅用于回包缺字段时兜底。
const YSHF_DAILY_SEED_FALLBACK = '28';
const YSHF_SHARE_SEED_FALLBACK = '4';
/**
 * 单个铺子的每日接收额度上限。实机两个账号的 cmd 92 回包都是 quota=8000 起步，
 * 界面也按 7,000 / 8,000 画进度条，因此按常量处理；一旦服务端下发更大的 quota，
 * 以 quotient 为准，不让进度条出现负数。
 */
const YSHF_SHOP_QUOTA_CAP = '8000';
/** 背包余额的短缓存：只在轮询间隔内复用，领种子/卖薯/兑换后必须强制重读。 */
const BALANCE_CACHE_TTL_MS = 10 * 1000;
/**
 * 背包读取连续失败时，最多沿用多久之前的成功值。
 * 余额变化只发生在本次进程内的几个写操作上（写操作后都会强制刷新缓存），
 * 因此 10 分钟内的旧值仍然可信，比把界面刷成“--”更有用。
 *
 * 注意：自动任务的轮询间隔也是 10 分钟，正好卡在这个窗口边界上，
 * 一旦 Bag 超时就会「刚好过期 → 判定未知 → 跳过卖薯」。自动任务传自己的
 * 宽窗口（AUTO_BALANCE_STALE_MAX_MS），界面仍用这 10 分钟。
 */
const BALANCE_STALE_MAX_MS = 10 * 60 * 1000;
/** 自动任务沿用旧余额的上限：一小时内的蜜薯数足够可信，卖薯失败服务端还会兜底。 */
const AUTO_BALANCE_STALE_MAX_MS = 60 * 60 * 1000;
/**
 * 兑换目录（cmd 97）只下发序号与价格，商品由客户端静态配置按序号映射。
 * 这张表来自 2026-11-25 实机界面截图，价格与抓包逐档一致，用于给目录补名字和
 * 图标；价格对不上时视为官方调整过档位，退回序号占位而不是猜。
 * 值得注意的是 cmd 96 的回包会直接返回真实 item_id，因此兑换后可以回填校验。
 */
const YSHF_CATALOG_TEMPLATE = {
    1: { itemId: '204013', name: '七彩花弦', price: '1000000' },
    2: { itemId: '101627', name: '福气金豆礼包', price: '60000' },
    3: { itemId: '40522', name: '金币果', price: '40000' },
    4: { itemId: '40523', name: '经验蘑菇', price: '40000' },
    5: { itemId: '80011', name: '有机化肥(1小时)', price: '8500' },
    6: { itemId: '101620', name: '南瓜种子礼包', price: '28000' },
    7: { itemId: '101621', name: '荷风种子礼包', price: '28000' },
    8: { itemId: '101622', name: '千星种子礼包', price: '28000' },
    9: { itemId: '101623', name: '萌宠种子礼包', price: '35000' },
    10: { itemId: '80001', name: '化肥(1小时)', price: '7000' },
};
function createYishuHuanfuActivityService(deps) {
    const { types, sendMsgAsync, getBag, getServerTimeSec, int64String, int64Number, bytesToText, itemDto, textContent, businessError, positiveDecimal, activityWindowIsActive, readBagBalances, serializeMutation, getActivityCenterSnapshot, getUserState, 
    // 好友列表默认懒加载，测试可注入桩函数，避免拉起真实的网关请求。
    getAllFriends: getAllFriendsDep, 
    // 面板其它账号的好友同样可注入，测试不必读写磁盘存档。
    getPanelFriendGids: getPanelFriendGidsDep, } = deps;
    // 状态槽 130 的 4 号子槽只保留最近一次动作，不能用它判断“今天是否已领”，
    // 因此每日动作按服务器日期在本地记账，服务端报错时再回滚。
    let seedClaimedDateKey = '';
    let claimedSeedCount = YSHF_DAILY_SEED_FALLBACK;
    let sharedDateKey = '';
    let sharedSeedCount = YSHF_SHARE_SEED_FALLBACK;
    let currentOwnQuote;
    // 背包读取失败时保留原因，随快照一起下发，前端可以显示“余额未知”的具体理由。
    let lastBalanceError = '';
    // 前端轮询很密，同一个超时错误 5 分钟内只记一条，避免把日志刷爆后反而看不到别的信息。
    let lastBalanceLogAt = 0;
    let lastBalanceLoggedError = '';
    // 快照会被前端反复轮询，而 Bag 是串行队列的最后一环，压力一大就会被挤掉。
    // 一旦某次失败就把界面刷成“--”，数字会出现“闪一下又没了”的观感，
    // 因此这里做两级兜底：短 TTL 复用减少请求 + 失败时回退最近一次成功值。
    let lastGoodBalances = null;
    let balanceStale = false;
    // 打网关的刷新同一时刻只跑一个，结果写进 lastGoodBalances 供快照同步读取。
    let balanceRefreshingPromise = null;
    function ownGid() {
        const gid = int64String(getUserState()?.gid);
        return gid === '0' ? '' : gid;
    }
    async function queryYshfGroupReply() {
        const body = Buffer.from(types.GetGroupRequest.encode(types.GetGroupRequest.create({
            group_id: YSHF_GROUP_ID,
        })).finish());
        const { body: replyBody } = await sendMsgAsync('gamepb.activitypb.ActivityService', 'GetGroup', body);
        const reply = types.GetGroupReply.decode(replyBody);
        const activity = findMainModule(reply)?.activity;
        if (activity) {
            const start = int64Number(activity.begin_time);
            const end = int64Number(activity.end_time);
            (0, yishuhuanfu_1.observeYishuActivity)(activityWindowIsActive(activity) && getServerTimeSec() < end, end, start);
        }
        return reply;
    }
    function collectPanelFriendGids() {
        const result = [];
        const seen = new Set();
        function add(raw, accountName) {
            const gid = int64String(raw);
            if (!/^[1-9]\d*$/.test(gid) || seen.has(gid))
                return;
            seen.add(gid);
            result.push({ gid, accountName });
        }
        if (typeof getPanelFriendGidsDep === 'function') {
            const injected = getPanelFriendGidsDep();
            if (Array.isArray(injected)) {
                for (const entry of injected)
                    add(entry?.gid, String(entry?.accountName || ''));
            }
            return result;
        }
        try {
            const store = require('../../models/store');
            const { listAllKnownFriendGidsCaches } = require('../../models/store/gid-cache');
            const listed = store?.getAccounts?.();
            const accounts = Array.isArray(listed?.accounts) ? listed.accounts : [];
            const names = new Map();
            for (const account of accounts) {
                const accountId = String(account?.id || '');
                if (accountId)
                    names.set(accountId.replace(/[^\w-]/g, '_'), String(account?.name || account?.nick || accountId));
            }
            for (const { accountId, gids } of listAllKnownFriendGidsCaches()) {
                for (const gid of gids)
                    add(gid, names.get(accountId) || `账号 ${accountId}`);
            }
        }
        catch {
            // 读不到面板账号存档不是错误：退回只用本账号好友。
        }
        return result;
    }
    async function operateYshf(requestType, payload, options) {
        const body = Buffer.from(requestType.encode(requestType.create(payload)).finish());
        const { body: replyBody } = await sendMsgAsync('gamepb.activitypb.ActivityService', 'Operate', body, options);
        const reply = types.ActivityOperateReply.decode(replyBody);
        if (int64String(reply.activity_id) !== YSHF_ACTIVITY_ID) {
            throw businessError('YSHF_RESPONSE_INVALID', '以薯换福回包的活动 ID 不匹配');
        }
        if (int64Number(reply.operate_type) !== int64Number(payload.cmd)) {
            throw businessError('YSHF_RESPONSE_INVALID', '以薯换福回包的命令号不匹配');
        }
        // 领种子 / 卖薯 / 兑换 / 分享都会改变背包或福气币，必须让下次读取绕过缓存，
        // 否则界面会拿着写操作之前的余额继续展示。
        if ([YSHF_CMD_CLAIM_SEED, YSHF_CMD_SELL, YSHF_CMD_EXCHANGE, YSHF_CMD_SHARE, YSHF_CMD_CLAIM_COMMISSION].includes(int64Number(payload.cmd))) {
            invalidateBalanceCache();
        }
        return reply;
    }
    function findMainModule(groupReply) {
        const children = Array.isArray(groupReply?.group?.children) ? groupReply.group.children : [];
        return children.find((child) => int64String(child?.activity?.activity_id) === YSHF_ACTIVITY_ID) || null;
    }
    function checkDailyActionDay(snapshot) {
        const now = getServerTimeSec();
        if (now < Number(snapshot.startTime) || now >= Number(snapshot.endTime)) {
            return businessError('YSHF_INACTIVE', '以薯换福活动未在活动期内');
        }
        return (0, yishuhuanfu_1.yishuDate)(now) === snapshot.daily.dateKey ? null : businessError('YSHF_DAY_CHANGED', '游戏日已变化，请刷新活动状态');
    }
    /** 兑换目录的单档商品 DTO。status 在抓包中恒为 2，语义未取证，不据它判断可兑性。 */
    function catalogDto(catalog) {
        const goods = Array.isArray(catalog?.goods) ? catalog.goods : [];
        return goods.map((entry) => {
            const index = int64Number(entry?.index);
            const price = int64String(entry?.price);
            const template = YSHF_CATALOG_TEMPLATE[index];
            const matched = !!template && template.price === price;
            const itemId = matched ? template.itemId : null;
            const limit = int64String(entry?.limit || '0');
            // 兑换后服务端会补 field 5/6，实机均取 1，疑似今日已兑次数，语义待定，
            // 因此只作为参考值透出，剩余可兑数量仍以 limit 为上限。
            const exchangedToday = int64String(entry?.field_5 || '0');
            return {
                index,
                itemId,
                name: matched ? template.name : '',
                // 价格变动说明官方换过档位，名字一律留空，避免展示错商品。
                nameKnown: matched,
                price,
                status: int64Number(entry?.status),
                limit,
                exchangedToday,
                image: itemId ? itemDto({ item_id: itemId, count: '1' }).image : '',
                exchangeable: true,
            };
        });
    }
    function yshfDto(groupReply, balances = null, catalog = null) {
        const main = findMainModule(groupReply);
        const activity = main?.activity || null;
        if (!activity) {
            throw businessError('YSHF_UNAVAILABLE', '服务端未发现以薯换福活动');
        }
        const state = main?.yishuhuanfu || {};
        const claims = state.claims || {};
        const shareState = state.share || {};
        // 130.5 = 基础收购价、130.6 = 分享暴击加成。早期版本把这两个字段写反，
        // 导致界面写成“基础 33 + 暴击 111”。官方抓包 111 + 33 = 144 与界面一致。
        const basePrice = int64String(state.base_price || '0');
        const bonus = int64String(state.bonus_price || '0');
        // 成交价 = 基础价 + 加成，最终以 cmd 93 回包为准，这里只作展示与预估。
        const estimatedPrice = basePrice !== '0'
            ? (BigInt(basePrice) + BigInt(bonus)).toString()
            : null;
        const active = activityWindowIsActive(activity) && getServerTimeSec() < int64Number(activity.end_time);
        const dateKey = (0, yishuhuanfu_1.yishuDate)(getServerTimeSec());
        const readBalance = (itemId) => balances?.get(itemId) || '0';
        const seedBalance = balances ? readBalance(YSHF_SEED_ITEM_ID) : null;
        const sweetPotatoBalance = balances ? readBalance(YSHF_SWEET_POTATO_ITEM_ID) : null;
        // 福气币以服务端状态槽为准（卖出后出现、兑换后扣减，实机 69120→62120→27120），
        // 背包余额只在状态槽缺失时兜底。
        const stateLuckCoin = int64String(state.luck_coin || '0');
        const bagLuckCoin = balances ? readBalance(YSHF_LUCK_COIN_ITEM_ID) : null;
        const luckCoinBalance = stateLuckCoin !== '0' ? stateLuckCoin : bagLuckCoin;
        // 130.1 是服务端的今日领取标记，比本地日期记账可靠得多：
        // 进程重启、跨设备、多端操作都能立刻体现。本地记账只作为兜底保留。
        const savedSeed = (0, daily_completion_1.getDailyMark)('yishu_claim_seed');
        const savedShare = (0, daily_completion_1.getDailyMark)('yishu_share');
        const seedClaimed = !!claims.seed_claimed || seedClaimedDateKey === dateKey || savedSeed?.status === 'completed';
        const shared = !!claims.share_claimed || sharedDateKey === dateKey || savedShare?.status === 'completed' || savedShare?.count !== undefined;
        const shareTimeSec = Number(int64String(shareState.timestamp || '0'));
        const sharedToday = Number.isFinite(shareTimeSec) && shareTimeSec > 0
            && (0, yishuhuanfu_1.yishuDate)(shareTimeSec) === dateKey;
        const dailySeedCount = seedClaimed ? (seedClaimedDateKey === dateKey ? claimedSeedCount : savedSeed?.count ?? YSHF_DAILY_SEED_FALLBACK) : '0';
        const dailyShareCount = shared || sharedToday ? (sharedDateKey === dateKey ? sharedSeedCount : savedShare?.count ?? YSHF_SHARE_SEED_FALLBACK) : '0';
        // 基础价为 0 说明服务端还没下发当日行情，此时不能卖，否则按 0 价结算。
        const quoteReady = basePrice !== '0';
        const hasSweetPotato = balances === null || BigInt(sweetPotatoBalance || '0') > 0n;
        const gid = ownGid();
        const catalogLoaded = catalog !== null;
        // 可兑性只看活动期：目录/价格/余额都是前端与下单前的实时校验，
        // 拿 catalogLoaded 当开关会让快照刷新把按钮短暂打回不可兑。
        const exchangeEnabled = active;
        return {
            groupId: YSHF_GROUP_ID,
            activityId: YSHF_ACTIVITY_ID,
            name: bytesToText(activity.name) || '以薯换福',
            startTime: int64String(activity.begin_time),
            endTime: int64String(activity.end_time),
            rules: textContent(activity.extra),
            active,
            serverTime: String(getServerTimeSec()),
            shop: {
                gid,
                // price 保留为“基础价”，与 state.base_price 同源；成交以 cmd 93 回包为准。
                price: basePrice,
                priceKnown: quoteReady,
                quoteTime: int64String(shareState.timestamp || '0'),
                selfPrice: basePrice,
                bonus,
                estimatedPrice,
                // 130.7 = 本人铺子今日接收总量（实机 10000 / 12972）。
                capacity: int64String(state.capacity || '0'),
                // 剩余接收额度只能靠 cmd 92 现查，快照里不带，前端进页面时单独查一次。
                quota: null,
                quotaCap: YSHF_SHOP_QUOTA_CAP,
                quotaUsed: null,
            },
            seed: {
                ...itemDto({ item_id: YSHF_SEED_ITEM_ID, count: seedBalance || '0' }),
                balance: seedBalance,
                balanceKnown: balances !== null,
            },
            sweetPotato: {
                ...itemDto({ item_id: YSHF_SWEET_POTATO_ITEM_ID, count: sweetPotatoBalance || '0' }),
                balance: sweetPotatoBalance,
                balanceKnown: balances !== null,
            },
            luckCoin: {
                ...itemDto({ item_id: YSHF_LUCK_COIN_ITEM_ID, count: luckCoinBalance || '0' }),
                balance: luckCoinBalance,
                balanceKnown: luckCoinBalance !== null,
            },
            // 收购提成：好友把蜜薯卖进你的铺子后产生，界面「可领提成」就是 pending。
            // 没提成时服务端不下发 11 号字段，此时读出来是 0，语义上等于「没有」。
            commission: {
                pending: int64String(state.pending_commission || '0'),
                claimable: active && BigInt(int64String(state.pending_commission || '0')) > 0n,
                flag: int64String(state.commission_flag || '0'),
            },
            catalog: catalog || [],
            catalogLoaded,
            // stale=true 表示这次没读到背包，当前数字是上一次成功值（不做错误提示）。
            balanceStale: balances !== null && balanceStale,
            balanceError: balances === null ? (lastBalanceError || '背包读取失败') : '',
            daily: {
                dateKey,
                seedClaimed,
                seedReceivedToday: (BigInt(dailySeedCount) + BigInt(dailyShareCount)).toString(),
                shared,
                // 130.2.3 是分享时间戳，落在今天说明今天触发过分享暴击。
                sharedToday,
            },
            actions: {
                claimSeed: {
                    enabled: active && !seedClaimed,
                    available: active && !seedClaimed,
                    availabilityKnown: true,
                },
                sell: {
                    enabled: active && hasSweetPotato,
                    available: active && hasSweetPotato,
                    availabilityKnown: balances !== null,
                },
                share: {
                    enabled: active && !shared,
                    available: active && !shared,
                    availabilityKnown: true,
                },
                exchange: {
                    enabled: exchangeEnabled,
                    available: exchangeEnabled,
                    availabilityKnown: true,
                },
            },
        };
    }
    /**
     * 余额改成「快照永不等待 + 后台保活」两条通道。
     *
     * 背景：Bag 排在 7 个活动请求之后，网关并发一满就超时。之前快照里同步读、还重试三次
     * （250/700ms 退避 + 每次都要等网关超时），一次抖动既拖慢快照，又只能拿到 null；
     * 更糟的是页面挂载与轮询会并发打两个快照，后一个失败就覆盖前一个的成功结果，
     * 表现就是「刚刷新有数字、几秒后整排变 --」。
     *
     * 现在只有 refreshBalances 一个通道打网关（互斥，同一时刻只有一个在途），结果写进内存；
     * 快照只同步读内存。并发快照读的是同一份状态，不可能一个成功一个失败把数字打回去。
     */
    async function refreshBalances(options = {}) {
        // 在途请求直接复用。注意：复用方拿到的可能是「按更窄窗口判定的 null」，
        // 自动任务因此先在调用处决定重试次数与窗口，避免和界面抢同一个 promise。
        if (balanceRefreshingPromise)
            return balanceRefreshingPromise;
        const retryDelays = options.retries === 0 ? [] : [250, 700];
        const staleMaxMs = options.staleMaxMs ?? BALANCE_STALE_MAX_MS;
        const task = (async () => {
            for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
                try {
                    // 一律走普通 getBag()：会复用在途请求；传 fresh:true 会绕过在途去重，
                    // 等于连甩三个 Bag 请求，反而更容易撞上网关超时。
                    const data = readBagBalances(await getBag(), [
                        YSHF_SEED_ITEM_ID,
                        YSHF_SWEET_POTATO_ITEM_ID,
                        YSHF_LUCK_COIN_ITEM_ID,
                    ]);
                    lastBalanceError = '';
                    balanceStale = false;
                    lastGoodBalances = { at: Date.now(), data };
                    return data;
                }
                catch (error) {
                    lastBalanceError = String(error?.message || error || '背包读取失败');
                    if (attempt < retryDelays.length)
                        await new Promise(resolve => setTimeout(resolve, retryDelays[attempt]));
                }
            }
            logBalanceFailure();
            if (freshFallback(staleMaxMs)) {
                // 失败但手里还有可用成功值：继续用它，只标 stale。
                balanceStale = true;
                return lastGoodBalances.data;
            }
            balanceStale = false;
            return null;
        })();
        balanceRefreshingPromise = task;
        try {
            return await task;
        }
        finally {
            if (balanceRefreshingPromise === task)
                balanceRefreshingPromise = null;
        }
    }
    /** 同一类失败 5 分钟只记一条，避免把日志刷爆后反而看不到别的信息。 */
    function logBalanceFailure() {
        try {
            const nowAt = Date.now();
            if (lastBalanceLoggedError !== lastBalanceError || nowAt - lastBalanceLogAt > 5 * 60 * 1000) {
                lastBalanceLoggedError = lastBalanceError;
                lastBalanceLogAt = nowAt;
                require('../../utils/utils').logWarn('以薯换福背包读取失败', { error: lastBalanceError });
            }
        }
        catch {
            // 日志失败不影响主流程
        }
    }
    /** 最近一次成功值是否还能用（窗口可由调用方放宽，自动任务用 1 小时）。 */
    function freshFallback(maxMs = BALANCE_STALE_MAX_MS) {
        return !!lastGoodBalances && Date.now() - lastGoodBalances.at <= maxMs;
    }
    /** 快照专用：同步返回内存里的余额，绝不 await 网关。 */
    function currentBalances(maxMs = BALANCE_STALE_MAX_MS) {
        if (freshFallback(maxMs)) {
            // 值还在手就先给出去；超过 10 秒顺手在后台补一次，不阻塞本次快照。
            if (Date.now() - lastGoodBalances.at > BALANCE_CACHE_TTL_MS)
                void refreshBalances();
            return lastGoodBalances.data;
        }
        // 还没有任何成功值：触发后台刷新，本次先按未知下发（前端会用 localStorage 兜底）。
        void refreshBalances();
        return null;
    }
    /** 写操作成功后余额一定变了，立刻在后台补一次真值。 */
    function invalidateBalanceCache() {
        void refreshBalances();
    }
    async function getCurrentYishuHuanfuActivity(options = {}) {
        const requestDay = quoteQueue.currentDay();
        const seedCheck = (0, daily_completion_1.beginDailyCheck)('yishu_claim_seed');
        const shareCheck = (0, daily_completion_1.beginDailyCheck)('yishu_share');
        const groupReply = await queryYshfGroupReply();
        // 写操作后、以及进程里还没有任何成功值时，同步单次读一次（不重试）。
        // 其余情况只读内存，快照不会被 Bag 拖住，也不会出现并发快照互相覆盖。
        // 自动任务需要更硬的读数：给重试次数和更宽松的 stale 窗口，
        // 否则「轮询间隔 10 分钟 = stale 上限 10 分钟」会让它每次刚好读到未知值。
        const staleMaxMs = options.balanceStaleMaxMs ?? BALANCE_STALE_MAX_MS;
        const balances = options.freshBalances || !freshFallback(staleMaxMs)
            ? await refreshBalances({ retries: options.balanceRetries ?? 0, staleMaxMs })
            : currentBalances(staleMaxMs);
        // 目录查询是独立命令，快照里不拉，避免每次刷新快照都多发一条网关请求；
        // 前端进入活动页时单独调用 queryYishuHuanfuCatalog。
        const snapshot = yshfDto(groupReply, balances, null);
        if (snapshot.active && seedCheck?.dateKey === snapshot.daily.dateKey && snapshot.daily.seedClaimed) {
            (0, daily_completion_1.recordDailyMark)(seedCheck, 'completed');
        }
        if (snapshot.active && shareCheck?.dateKey === snapshot.daily.dateKey) {
            if (snapshot.daily.sharedToday)
                (0, daily_completion_1.recordDailyMark)(shareCheck, 'completed');
            else if (snapshot.daily.shared)
                (0, daily_completion_1.recordDailyMark)(shareCheck, 'pending_confirmation');
        }
        if (requestDay && requestDay === quoteQueue.currentDay() && requestDay === snapshot.daily.dateKey) {
            const { gid, price, bonus, estimatedPrice, priceKnown } = snapshot.shop;
            const user = getUserState();
            currentOwnQuote = snapshot.active && gid ? { day: requestDay, shop: {
                    gid, name: '自家铺子', avatar: String(user?.avatarUrl || ''), level: int64String(user?.level || 0),
                    via: 'own', own: true, unlimited: true, quotePending: !priceKnown,
                    price, bonus, totalPrice: estimatedPrice || '0', quota: '0', quotaCap: '0', quotaUsed: '0',
                    canSell: null, sharedToday: snapshot.daily.sharedToday,
                    quotedAt: deps.getQuoteTime?.() || getServerTimeSec(),
                } } : undefined;
        }
        return snapshot;
    }
    async function claimYishuHuanfuSeeds(options = {}) {
        return serializeMutation(async () => {
            if ((0, daily_completion_1.isDailyComplete)('yishu_claim_seed'))
                throw businessError('YSHF_SEED_ALREADY_CLAIMED', '今日红薯种子已经领取，无需重复领取');
            const check = (0, daily_completion_1.beginDailyCheck)('yishu_claim_seed');
            const snapshot = await getCurrentYishuHuanfuActivity({ freshBalances: true });
            if (!snapshot.active) {
                throw businessError('YSHF_INACTIVE', '以薯换福活动未在活动期内');
            }
            if (snapshot.daily.seedClaimed) {
                throw businessError('YSHF_SEED_ALREADY_CLAIMED', '今日红薯种子已经领取，无需重复领取');
            }
            if ((0, daily_completion_1.getDailyMark)('yishu_claim_seed')?.status === 'pending_confirmation') {
                throw businessError('YSHF_DAILY_ACTION_PENDING', '本次领种结果待核对，请先刷新活动状态');
            }
            const reply = await (async () => {
                try {
                    return await operateYshf(types.YshfClaimSeedRequest, {
                        activity_id: YSHF_ACTIVITY_ID,
                        cmd: YSHF_CMD_CLAIM_SEED,
                        params: {},
                    }, {
                        expectedErrorCodes: [1034177],
                        beforeSend: () => checkDailyActionDay(snapshot),
                        onSent: () => (0, daily_completion_1.recordDailyMark)(check, 'pending_confirmation'),
                    });
                }
                catch (error) {
                    const message = String(error?.message || '');
                    // 服务端用 1034177 表示今天已经领过。以前这个码没有映射，前端只能看到
                    // “活动操作失败，请刷新页面后重试”，按钮也不会变灰。
                    if (String(error?.code || '') === '1034177' || /code=1034177\b/.test(message)) {
                        seedClaimedDateKey = snapshot.daily.dateKey;
                        (0, daily_completion_1.recordDailyMark)(check, 'completed');
                        throw businessError('YSHF_SEED_ALREADY_CLAIMED', '今日红薯种子已经领取，明天再来领取');
                    }
                    if (/^\d+$/.test(String(error?.code || '')))
                        (0, daily_completion_1.recordDailyMark)(check, 'clear_pending');
                    throw error;
                }
            })();
            if (!reply?.yshf_claim_seed) {
                (0, daily_completion_1.recordDailyMark)(check, 'pending_confirmation');
                throw businessError('YSHF_DAILY_ACTION_PENDING', '领种回包未能确认，请先刷新活动状态');
            }
            seedClaimedDateKey = snapshot.daily.dateKey;
            const grant = reply?.yshf_claim_seed?.grant;
            const count = grant ? int64String(grant.count) : YSHF_DAILY_SEED_FALLBACK;
            claimedSeedCount = count;
            (0, daily_completion_1.recordDailyMark)(check, 'completed', { count });
            return {
                count,
                reward: grant ? itemDto({ item_id: int64String(grant.item_id), count }) : null,
                message: `领取红薯种子 ${count} 个`,
                // 自动任务只要结果，不需要整份活动中心快照（那是 7 个活动的读，代价很高）。
                snapshot: options.withSnapshot === false ? null : await getActivityCenterSnapshot(),
            };
        });
    }
    /**
     * 按铺主 gid 查今日行情（cmd 92）。是否能查到报价由服务端决定。
     */
    async function fetchShopQuote(targetGid, beforeSend) {
        let reply;
        try {
            reply = await operateYshf(types.YshfShopQueryRequest, {
                activity_id: YSHF_ACTIVITY_ID,
                cmd: YSHF_CMD_SHOP_QUERY,
                params: { shop_gid: targetGid },
            }, { expectedErrorCodes: YSHF_SHOP_UNAVAILABLE_CODES, beforeSend });
        }
        catch (error) {
            const code = Number(error?.code);
            if (code === YSHF_SHOP_SHARE_EXPIRED_CODE) {
                throw businessError('YSHF_SHOP_SHARE_EXPIRED', '铺子的分享链接已失效，请联系店主重新分享');
            }
            if (YSHF_SHOP_UNAVAILABLE_CODES.includes(code)) {
                throw businessError('YSHF_SHOP_CLOSED', '该铺子暂未开放收购');
            }
            throw error;
        }
        const quote = reply?.yshf_shop?.quote;
        const shop = quote?.shop;
        // 官方抓包（2026-11-25 13:51，好友 1006086548 风筝有风）：
        // quote.base_price=99、quote.bonus_price=66，游戏界面「今日蜜薯收购价」显示 165。
        // 成交价 = 基础价 + 暴击加成，两个字段都不能单独当成交价用。
        const price = int64String(quote?.base_price || '0');
        const quota = int64String(quote?.quota || '0');
        const bonus = int64String(quote?.bonus_price || '0');
        const totalPrice = (BigInt(price) + BigInt(bonus)).toString();
        // quota 是“还能再收多少”，额度上限实机恒为 8000，用来算已用量。
        const cap = BigInt(YSHF_SHOP_QUOTA_CAP) > BigInt(quota) ? YSHF_SHOP_QUOTA_CAP : quota;
        const own = targetGid === ownGid();
        // can_sell = 这个铺子现在收不收薯。三态：true 可收 / false 明确拒收 / null 回包没这个字段。
        // protobufjs 对 bool 取默认值 false，读到的 false 分不清「明确 0」和「没下发」，
        // 所以先用 hasOwnProperty 判断字段是否真的在报文里，否则整排铺子会被误判成关张。
        // 自家铺子不占好友额度，界面显示「不限」，能不能卖同样只看 can_sell。
        const shopReply = reply?.yshf_shop;
        const hasCanSell = !!shopReply && Object.prototype.hasOwnProperty.call(shopReply, 'can_sell');
        const canSell = hasCanSell ? !!shopReply.can_sell : null;
        return {
            gid: targetGid,
            own,
            price,
            totalPrice,
            quota,
            quotaCap: cap,
            quotaUsed: (BigInt(cap) - BigInt(quota)).toString(),
            bonus,
            sharedToday: BigInt(bonus) > 0n,
            quotedAt: deps.getQuoteTime?.() || getServerTimeSec(),
            canSell,
            shop: shop ? {
                gid: int64String(shop.gid),
                name: shop.name || '',
                avatar: shop.avatar || '',
                level: int64String(shop.level),
            } : null,
        };
    }
    /**
     * 查指定铺子的今日行情（cmd 92）。不传 gid 时查自己铺子，
     * 返回该铺收购价、剩余接收额度与铺主信息。
     */
    async function queryYishuHuanfuShop(friendGidInput = null) {
        const quoteDay = requireQuoteDay();
        const own = ownGid();
        const targetGid = friendGidInput === null || friendGidInput === undefined || friendGidInput === ''
            ? own
            : positiveDecimal(friendGidInput, 'INVALID_YSHF_SHOP_GID', 'friendGid');
        if (!targetGid) {
            throw businessError('YSHF_OWN_GID_UNKNOWN', '无法确定本人 GID，暂时查不了铺子行情');
        }
        const quote = await fetchShopQuote(targetGid);
        requireQuoteDay(quoteDay);
        return {
            targetGid,
            quoteDay,
            own: targetGid === own,
            ...quote,
            message: `铺子今日收购价 ${quote.totalPrice}（基础 ${quote.price} + 加成 ${quote.bonus}），剩余接收额度 ${quote.quota}`,
        };
    }
    async function loadYishuFriendTargets() {
        const activity = findMainModule(await queryYshfGroupReply())?.activity;
        if (!activity || !activityWindowIsActive(activity) || getServerTimeSec() >= int64Number(activity.end_time)) {
            throw businessError('YSHF_INACTIVE', '以薯换福活动未在活动期内');
        }
        const own = ownGid();
        let listError;
        let friends = [];
        try {
            const loader = typeof getAllFriendsDep === 'function'
                ? getAllFriendsDep
                : () => require('../friend/api').getAllFriends(false, 'low');
            const reply = await loader(false, 'low');
            if (Array.isArray(reply?.game_friends))
                friends = reply.game_friends;
            else if (Array.isArray(reply?.gameFriends))
                friends = reply.gameFriends;
        }
        catch (error) {
            listError = error;
        }
        const panelFriends = collectPanelFriendGids();
        if (listError && !panelFriends.length)
            throw listError;
        const targets = [];
        const localFriends = [];
        const panelGroups = new Map();
        const seen = new Set();
        if (own)
            seen.add(own);
        for (const friend of friends) {
            const gid = int64String(friend?.gid);
            if (!gid || gid === '0' || seen.has(gid))
                continue;
            seen.add(gid);
            localFriends.push({
                gid,
                name: friend?.remark || friend?.name || gid,
                avatar: friend?.avatar_url || '',
                level: int64String(friend?.level),
                via: 'friend',
            });
        }
        // 面板里其它账号的好友同样并入候选，能否查价和出售由服务端判定。
        for (const entry of panelFriends) {
            if (seen.has(entry.gid))
                continue;
            seen.add(entry.gid);
            const group = panelGroups.get(entry.accountName) || [];
            group.push({
                gid: entry.gid,
                // 名字靠 cmd 92 回包里的铺主信息补，界面没有名字时会退化成显示 GID。
                name: '',
                avatar: '',
                level: '0',
                via: 'panel',
                panelAccount: entry.accountName,
            });
            panelGroups.set(entry.accountName, group);
        }
        const groups = [localFriends, ...panelGroups.values()];
        const longestGroup = Math.max(...groups.map(group => group.length));
        // Give each account an early place in the scan window.
        for (let index = 0; index < longestGroup; index++) {
            for (const group of groups) {
                const entry = group[index];
                if (entry)
                    targets.push(entry);
            }
        }
        return targets;
    }
    const quoteAccountId = process.env.FARM_ACCOUNT_ID || '';
    const quoteCachePrefix = quoteAccountId && getDataFile(`yishuhuanfu/${Buffer.from(quoteAccountId, 'utf8').toString('base64url')}`);
    const quoteDateFile = quoteCachePrefix && `${quoteCachePrefix}.quote-day.json`;
    const quoteQueue = (0, yishu_quote_queue_1.createYishuQuoteQueue)({
        day: deps.getQuoteDay,
        now: deps.quoteClock || (() => performance.now()),
        loadTargets: loadYishuFriendTargets,
        query: async (target) => {
            const { shop, ...quote } = await fetchShopQuote(target.gid, () => (0, yishuhuanfu_1.isYishuAutomationInWindow)(getServerTimeSec())
                ? null : businessError('YSHF_INACTIVE', '以薯换福活动未在活动期内'));
            if (shop?.gid !== target.gid)
                throw businessError('YSHF_SHOP_UNKNOWN', '无法确认铺主');
            return {
                ...target, ...quote,
                name: target.name || shop.name,
                avatar: target.avatar || shop.avatar,
                level: target.level !== '0' ? target.level : shop.level,
            };
        },
        minimumDay: () => {
            const day = quoteDateFile && readJsonFile(quoteDateFile)?.day;
            return typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : '';
        },
        activateDay: (day) => {
            if (!quoteDateFile)
                return;
            try {
                writeJsonFileAtomic(quoteDateFile, { day }, 0);
            }
            catch { /* 仍可在本次运行中防止报价日期倒退。 */ }
        },
        restore: (day) => {
            if (!quoteCachePrefix)
                return [];
            const cache = readJsonFile(`${quoteCachePrefix}.${day}.quotes.json`);
            if (cache?.day === day && Array.isArray(cache.rows))
                return cache.rows;
            const legacy = readJsonFile(`${quoteCachePrefix}.quotes.json`);
            const last = (0, yishuhuanfu_history_1.readYishuHistory)(quoteAccountId).reverse().find(entry => entry.day === day && entry.scan);
            const scan = last?.scan;
            const rows = legacy?.day === day && Array.isArray(legacy.rows) ? legacy.rows : scan?.shops || [];
            return rows.filter(row => row.gid !== ownGid() && (row.via === 'friend' || row.via === 'panel' || row.via === 'account')
                && Number.isFinite(row.quotedAt) && (0, yishuhuanfu_1.yishuDate)(row.quotedAt) === day);
        },
        save: (day, rows) => {
            if (!quoteCachePrefix)
                return;
            try {
                writeJsonFileAtomic(`${quoteCachePrefix}.${day}.quotes.json`, { day, rows }, 0);
            }
            catch { /* 磁盘不可用时继续使用本次运行中的报价。 */ }
        },
    });
    function quoteDayError() {
        return businessError('YSHF_QUOTE_CHANGED', '报价日期已变化，请等游戏服务器确认当天日期后重新查价');
    }
    function requireQuoteDay(expected) {
        const day = quoteQueue.currentDay();
        if (!day || (expected !== undefined && expected !== day))
            throw quoteDayError();
        return day;
    }
    function includeOwnShop(scan) {
        if (!currentOwnQuote || currentOwnQuote.day !== scan.day)
            return scan;
        const ownShop = currentOwnQuote.shop;
        const shops = [...scan.shops];
        const insertion = shops.findIndex(shop => shop.quotePending || BigInt(shop.totalPrice) <= BigInt(ownShop.totalPrice));
        shops.splice(insertion < 0 ? shops.length : insertion, 0, ownShop);
        const best = !ownShop.quotePending && (!scan.best || BigInt(ownShop.totalPrice) >= BigInt(scan.best.totalPrice)) ? ownShop : scan.best;
        return {
            ...scan, best, ownShop, shops,
            scanned: scan.scanned + Number(!ownShop.quotePending),
            candidateCount: scan.candidateCount + 1,
            pendingCount: scan.pendingCount + Number(ownShop.quotePending),
            scannedAt: ownShop.quotePending ? scan.scannedAt : Math.max(scan.scannedAt, ownShop.quotedAt * 1000),
        };
    }
    function scanYishuHuanfuFriendShops() {
        return includeOwnShop(quoteQueue.snapshot());
    }
    function refreshYishuHuanfuFriendShops(mode) {
        if (mode === 'off')
            return { ...scanYishuHuanfuFriendShops(), message: '当前卖薯模式已停用比价' };
        return includeOwnShop(quoteQueue.refreshQuotes(mode === 'manual'));
    }
    function tickYishuHuanfuFriendShops(options) {
        return quoteQueue.tick(options);
    }
    function setYishuOnlineShopAccounts(accounts) {
        const own = ownGid();
        const peers = Array.isArray(accounts) ? accounts.flatMap((account) => {
            const gid = String(account?.gid || '');
            if (!/^[1-9]\d*$/.test(gid) || gid === own)
                return [];
            return [{ gid, name: String(account.name || gid), avatar: String(account.avatar || ''), level: String(account.level || '0'), via: 'account' }];
        }) : [];
        quoteQueue.setOnlineTargets(peers);
    }
    /**
     * 卖蜜薯（cmd 93）。不传 friendGid 时卖给自己的铺子；传 friendGid 时占用对方
     * 每日接收额度，对方获得提成。
     * count 缺省为背包全部蜜薯；服务端按传入数量成交，成交价由服务端决定，回包
     * 里的 price / total / balance 才是结算依据，任何本地预估都不作数。
     */
    async function sellYishuHuanfuSweetPotato(friendGidInput = null, countInput = null, options = {}) {
        return serializeMutation(async () => {
            const accountId = process.env.FARM_ACCOUNT_ID || '';
            const history = (0, yishuhuanfu_history_1.readYishuHistory)(accountId);
            const previous = options.clientOrderId
                ? history.find(entry => entry.type === 'sale' && entry.clientOrderId === options.clientOrderId)
                : undefined;
            if (previous)
                return { ...previous, snapshot: null, message: '该笔出售已确认成交' };
            if ((0, yishuhuanfu_history_1.pendingYishuOrder)(history)) {
                throw businessError('YSHF_ORDER_PENDING', '上一笔出售结果待核对，请先确认库存和到账');
            }
            const saleDay = requireQuoteDay(options.expectedDay);
            const snapshot = await getCurrentYishuHuanfuActivity({ freshBalances: true });
            if (!snapshot.active) {
                throw businessError('YSHF_INACTIVE', '以薯换福活动未在活动期内');
            }
            const own = ownGid();
            if (!own) {
                throw businessError('YSHF_OWN_GID_UNKNOWN', '无法确定本人 GID，暂时不能卖出蜜薯');
            }
            const targetGid = friendGidInput === null || friendGidInput === undefined || friendGidInput === ''
                ? own
                : positiveDecimal(friendGidInput, 'INVALID_YSHF_FRIEND_GID', 'friendGid');
            const balance = snapshot.sweetPotato.balance;
            if (balance !== null && BigInt(balance) <= 0n) {
                throw businessError('INSUFFICIENT_YSHF_SWEET_POTATO', '背包里没有可出售的蜜薯');
            }
            if (targetGid === own && !snapshot.shop.priceKnown) {
                throw businessError('YSHF_QUOTE_NOT_READY', '今日收购价尚未生成，请先领取红薯种子');
            }
            if ((options.auto || options.expectedPrice !== undefined) && (snapshot.balanceStale || balance === null)) {
                throw businessError('YSHF_BALANCE_UNKNOWN', '需要重新确认蜜薯库存');
            }
            const ownPrice = snapshot.shop.estimatedPrice || '0';
            let quotedPrice = ownPrice;
            let quotedQuota = null;
            let targetName = targetGid === own ? '自家铺子' : '';
            let count;
            if (countInput === null || countInput === undefined || countInput === '') {
                if (balance === null) {
                    throw businessError('YSHF_BALANCE_UNKNOWN', '读取不到蜜薯数量，请显式指定出售数量');
                }
                count = balance;
            }
            else {
                count = positiveDecimal(countInput, 'INVALID_YSHF_SELL_COUNT', 'count');
                if (balance !== null && BigInt(count) > BigInt(balance)) {
                    throw businessError('INSUFFICIENT_YSHF_SWEET_POTATO', `背包只有 ${balance} 个蜜薯，不足 ${count} 个`);
                }
            }
            // 卖给好友铺子前先查一次行情（cmd 92）：确认铺主 gid 与请求一致、
            // 对方现在收不收（can_sell）、剩余接收额度够用，避免“卖出去才发现
            // 铺子不是这个人的 / 已经收满关张”。自己的铺子不限量，不需要这一步。
            if (targetGid !== own) {
                const quote = await fetchShopQuote(targetGid);
                quotedPrice = quote.totalPrice;
                quotedQuota = quote.quota;
                if (!quote.shop || quote.shop.gid !== targetGid) {
                    throw businessError('YSHF_SHOP_UNKNOWN', `无法确认铺子 ${targetGid} 的主人，本次未出售`);
                }
                targetName = quote.shop.name;
                // canSell === null 表示回包没带这个字段（旧版本/字段缺失），按可卖继续，
                // 由随后的额度校验与下单回包兜底；只有明确 false 才拦下。
                if (quote.canSell === false) {
                    throw businessError('YSHF_SHOP_CLOSED', `${quote.shop.name || targetGid} 的铺子当前不收蜜薯，换一家或卖给自己`);
                }
                if (BigInt(count) > BigInt(quote.quota)) {
                    throw businessError('YSHF_SHOP_QUOTA_INSUFFICIENT', `${quote.shop.name || targetGid} 的铺子今日只剩 ${quote.quota} 个接收额度，不足 ${count} 个`);
                }
            }
            if ((options.expectedPrice !== undefined && String(options.expectedPrice) !== quotedPrice)
                || (options.expectedQuota !== undefined && String(options.expectedQuota) !== quotedQuota)) {
                throw businessError('YSHF_QUOTE_CHANGED', '铺子价格或额度已变化，请按新条件确认');
            }
            const now = getServerTimeSec();
            requireQuoteDay(saleDay);
            if (snapshot.daily.dateKey !== saleDay || (0, yishuhuanfu_1.yishuDate)(now) !== saleDay)
                throw quoteDayError();
            const activityEnd = Number(snapshot.endTime);
            if (Number.isFinite(activityEnd) && activityEnd > 0 && now >= activityEnd) {
                throw businessError('YSHF_INACTIVE', '活动已关闭');
            }
            const validateAutoSale = () => {
                if (!options.auto)
                    return null;
                if (!options.auto.isEnabled() || !(0, yishuhuanfu_1.isYishuSaleTime)(getServerTimeSec(), options.auto.slot, options.auto.getSellAfterTime?.())) {
                    return businessError('YSHF_SELL_WINDOW_CLOSED', '已过本轮自动卖薯时段');
                }
                const minPrice = (0, yishuhuanfu_1.normalizeYishuMinPrice)(options.auto.getMinPrice?.());
                if (BigInt(quotedPrice) <= 0n || BigInt(quotedPrice) < BigInt(minPrice)) {
                    return businessError('YSHF_PRICE_TOO_LOW', '目标报价未达到自动出售门槛');
                }
                return null;
            };
            const autoError = validateAutoSale();
            if (autoError)
                throw autoError;
            const order = { targetGid, count, quotedPrice, quotedQuota, ownPrice, source: options.auto ? 'auto' : 'manual', clientOrderId: options.clientOrderId };
            const orderId = (0, yishuhuanfu_history_1.beginYishuOrder)(accountId, now, order);
            let result;
            let blockedBeforeSend = false;
            try {
                const reply = await operateYshf(types.YshfSellRequest, {
                    activity_id: YSHF_ACTIVITY_ID,
                    cmd: YSHF_CMD_SELL,
                    params: { shop_gid: targetGid, count },
                }, {
                    beforeSend: () => {
                        const error = quoteQueue.currentDay() === saleDay
                            ? checkDailyActionDay(snapshot) ?? validateAutoSale() : quoteDayError();
                        blockedBeforeSend = !!error;
                        return error;
                    },
                });
                result = reply?.yshf_sell;
            }
            catch (error) {
                // 网关明确拒绝才可结束该订单。超时或断线保留待核对记录。
                if (blockedBeforeSend || /^\d+$/.test(String(error?.code || ''))) {
                    (0, yishuhuanfu_history_1.appendYishuHistory)(accountId, now, { type: 'resolved', orderId, status: 'rejected', reason: error.message });
                    throw error;
                }
                throw businessError('YSHF_RESULT_UNKNOWN', '出售已尝试提交，请核对库存和到账后再操作');
            }
            const isOwn = targetGid === own;
            const soldCount = result ? int64String(result.count) : '0';
            const price = result ? int64String(result.price) : '0';
            const total = result ? int64String(result.total) : '0';
            // 回包自洽校验：数量对不上或金额 ≠ 单价 × 数量，说明这条回包不可信，
            // 不能向用户谎报“卖出成功”。
            if (!result || soldCount !== count || BigInt(price) <= 0n || BigInt(total) !== BigInt(price) * BigInt(soldCount)) {
                throw businessError('YSHF_RESULT_UNKNOWN', '服务端回包数量或金额无法确认，请刷新核对');
            }
            if (quotedQuota !== null)
                quoteQueue.updateQuota(saleDay, targetGid, (BigInt(quotedQuota) - BigInt(soldCount)).toString());
            (0, yishuhuanfu_history_1.appendYishuHistory)(accountId, now, {
                ...order, type: 'sale', orderId, targetName, price, income: total,
                estimatedGain: ((BigInt(price) - BigInt(ownPrice)) * BigInt(count)).toString(),
            });
            invalidateBalanceCache();
            const updatedSnapshot = options.withSnapshot === false ? null : await getActivityCenterSnapshot().catch(() => null);
            return {
                targetGid,
                own: isOwn,
                count: soldCount,
                price,
                income: total,
                quota: result ? int64String(result.quota) : '0',
                balance: result ? int64String(result.balance) : null,
                message: `已向${isOwn ? '自己的铺子' : `好友 ${targetGid} 的铺子`}卖出 ${soldCount} 个蜜薯，单价 ${price}，共得 ${total} 福气币`,
                snapshot: updatedSnapshot,
            };
        });
    }
    async function resolveYishuSale(orderId) {
        return serializeMutation(async () => {
            const accountId = process.env.FARM_ACCOUNT_ID || '';
            const pending = (0, yishuhuanfu_history_1.pendingYishuOrder)((0, yishuhuanfu_history_1.readYishuHistory)(accountId));
            if (!pending || pending.orderId !== orderId)
                throw businessError('YSHF_ORDER_PENDING', '待核对订单已变化');
            const current = await getCurrentYishuHuanfuActivity({ freshBalances: true, balanceStaleMaxMs: 0 });
            if (current.balanceStale || current.sweetPotato.balance == null || current.luckCoin.balance == null) {
                throw businessError('YSHF_BALANCE_UNKNOWN', '库存或福气币余额未获得确认');
            }
            (0, yishuhuanfu_history_1.appendYishuHistory)(accountId, getServerTimeSec(), {
                type: 'resolved', orderId: pending.orderId, status: 'acknowledged',
                sweetPotato: current.sweetPotato.balance, luckCoin: current.luckCoin.balance,
            });
            return { message: '已记录人工核对结果' };
        });
    }
    /**
     * 刷新本人铺子的今日行情（cmd 92，shop_gid 传自己 gid）。
     * 旧实现打的是 cmd 95，而 95 其实是收购记录列表，回包不带任何行情字段，
     * 所以这个按钮以前点了「没反应」——记录为空时回包就是空的。
     */
    async function refreshYishuHuanfuQuote() {
        const gid = ownGid();
        if (!gid)
            throw businessError('YSHF_GID_UNKNOWN', '未获取到本人 gid，无法刷新行情');
        const quote = await queryYishuHuanfuShop(gid);
        return {
            ...quote,
            message: `今日收购价 ${quote.totalPrice}（基础 ${quote.price} + 暴击 ${quote.bonus}），还可收 ${quote.quota}`,
            // 前端点完「刷新行情」需要把新价格写回快照，否则按钮看起来没反应。
            // 余额读取已改成内存命中，这里不会再多等一次 Bag。
            snapshot: await getActivityCenterSnapshot(),
        };
    }
    function purchaseRecordDto(record) {
        return {
            timestamp: int64String(record?.timestamp || '0'),
            gid: int64String(record?.gid || '0'),
            count: int64String(record?.count || '0'),
            total: int64String(record?.total || '0'),
            name: record?.name || '',
            avatar: record?.avatar || '',
            level: int64String(record?.level || '0'),
            commission: int64String(record?.commission || '0'),
        };
    }
    /**
     * 收购记录列表（cmd 95）。界面「只展示最近 30 条」，服务端一次下发多少条就展示多少条。
     * 记录是好友把蜜薯卖进你铺子产生的：4 是付给卖家的总额，9 是你拿到的提成。
     */
    async function queryYishuHuanfuRecords() {
        const reply = await operateYshf(types.YshfRecordRequest, {
            activity_id: YSHF_ACTIVITY_ID,
            cmd: YSHF_CMD_RECORDS,
            params: {},
        });
        const records = (reply?.yshf_records?.records || []).map(purchaseRecordDto);
        const totalCommission = records
            .reduce((sum, entry) => sum + BigInt(entry.commission || '0'), 0n)
            .toString();
        return {
            records,
            count: records.length,
            totalCommission,
            message: records.length === 0 ? '暂无收购记录' : `最近 ${records.length} 条收购记录，合计提成 ${totalCommission}`,
        };
    }
    /** 领取收购提成（cmd 99）。没有可领提成时本地直接拦下，不打网关。 */
    async function claimYishuHuanfuCommission(options = {}) {
        return serializeMutation(async () => {
            const snapshot = await getCurrentYishuHuanfuActivity();
            if (!snapshot.active) {
                throw businessError('YSHF_INACTIVE', '以薯换福活动未在活动期内');
            }
            if (BigInt(snapshot.commission.pending) <= 0n) {
                throw businessError('YSHF_NO_COMMISSION', '当前没有可领取的收购提成');
            }
            const reply = await operateYshf(types.YshfClaimCommissionRequest, {
                activity_id: YSHF_ACTIVITY_ID,
                cmd: YSHF_CMD_CLAIM_COMMISSION,
                params: {},
            }, { beforeSend: () => checkDailyActionDay(snapshot) });
            const result = reply?.yshf_commission;
            const amount = result ? int64String(result.amount) : '0';
            return {
                amount,
                balance: result ? int64String(result.balance) : null,
                message: amount === '0' ? '没有可领取的提成' : `已领取收购提成 ${amount} 福气币`,
                snapshot: options.withSnapshot === false ? null : await getActivityCenterSnapshot(),
            };
        });
    }
    /** 查兑换目录（cmd 97）。只读，不下单。 */
    async function queryYishuHuanfuCatalog() {
        const reply = await operateYshf(types.YshfCatalogRequest, {
            activity_id: YSHF_ACTIVITY_ID,
            cmd: YSHF_CMD_CATALOG,
            params: {},
        });
        const catalog = catalogDto(reply?.yshf_catalog);
        return {
            catalog,
            exchangeEnabled: true,
            message: `兑换目录共 ${catalog.length} 档`,
        };
    }
    /**
     * 兑换下单（cmd 96）。index 取目录序号，count 为兑换数量。
     * 服务端回包给出真实 item_id 与兑换后余额，这里用余额做一次交叉校验，
     * 避免上游改了扣费规则后本地还按旧价展示。
     */
    async function exchangeYishuHuanfuGoods(indexInput, countInput = 1) {
        return serializeMutation(async () => {
            const snapshot = await getCurrentYishuHuanfuActivity({ freshBalances: true });
            if (!snapshot.active) {
                throw businessError('YSHF_INACTIVE', '以薯换福活动未在活动期内');
            }
            const index = positiveDecimal(indexInput, 'INVALID_YSHF_CATALOG_INDEX', 'index');
            const count = positiveDecimal(countInput, 'INVALID_YSHF_EXCHANGE_COUNT', 'count');
            // 目录价格只有 cmd 97 才有，下单前必须现查一次，避免按过期档位扣币。
            const { catalog } = await queryYishuHuanfuCatalog();
            const goods = catalog.find((entry) => String(entry.index) === String(index));
            if (!goods) {
                throw businessError('YSHF_CATALOG_ENTRY_NOT_FOUND', `兑换目录里没有第 ${index} 档商品`);
            }
            const cost = BigInt(goods.price) * BigInt(count);
            const limit = BigInt(goods.limit || '0');
            // limit 是这一档“剩余可兑”次数，超了服务端会整单拒绝，这里提前拦住。
            if (limit > 0n && BigInt(count) > limit) {
                throw businessError('YSHF_EXCEED_LIMIT', `本档剩余可兑换 ${limit} 次，本次选择了 ${count} 次`);
            }
            const balance = snapshot.luckCoin.balance;
            if (balance !== null && BigInt(balance) < cost) {
                throw businessError('INSUFFICIENT_YSHF_LUCK_COIN', `福气币不足，需要 ${cost}，当前 ${balance}`);
            }
            const reply = await operateYshf(types.YshfExchangeRequest, {
                activity_id: YSHF_ACTIVITY_ID,
                cmd: YSHF_CMD_EXCHANGE,
                params: { index, count },
            });
            const result = reply?.yshf_exchange;
            const grant = result?.grant;
            const itemId = grant ? int64String(grant.item_id) : (goods.itemId || '');
            const granted = grant ? int64String(grant.count) : count;
            const nextBalance = result ? int64String(result.balance) : null;
            return {
                index: Number(index),
                count: granted,
                itemId,
                // 静态表与回包 item_id 不一致说明官方换过档位，标记出来供前端提示。
                itemIdMatched: goods.itemId === null || goods.itemId === '',
                price: result ? int64String(result.price) : goods.price,
                cost: cost.toString(),
                balance: nextBalance,
                reward: itemId ? itemDto({ item_id: itemId, count: granted }) : null,
                message: `兑换成功：${goods.nameKnown ? goods.name : `第 ${index} 档`} × ${granted}`,
                snapshot: await getActivityCenterSnapshot(),
            };
        });
    }
    /** 分享本人铺子（cmd 98）。每日首次触发分享暴击涨价。 */
    async function shareYishuHuanfuShop(options = {}) {
        return serializeMutation(async () => {
            if ((0, daily_completion_1.isDailyComplete)('yishu_share'))
                throw businessError('YSHF_SHARE_ALREADY_DONE', '今日已经分享过铺子，暴击涨价每日只触发一次');
            const check = (0, daily_completion_1.beginDailyCheck)('yishu_share');
            const snapshot = await getCurrentYishuHuanfuActivity({ freshBalances: true });
            if (!snapshot.active) {
                throw businessError('YSHF_INACTIVE', '以薯换福活动未在活动期内');
            }
            if (snapshot.daily.shared || snapshot.daily.sharedToday) {
                throw businessError('YSHF_SHARE_ALREADY_DONE', '今日已经分享过铺子，暴击涨价每日只触发一次');
            }
            if ((0, daily_completion_1.getDailyMark)('yishu_share')?.status === 'pending_confirmation') {
                throw businessError('YSHF_DAILY_ACTION_PENDING', '分享结果待核对，请先刷新活动状态');
            }
            const reply = await operateYshf(types.YshfShareRequest, {
                activity_id: YSHF_ACTIVITY_ID,
                cmd: YSHF_CMD_SHARE,
                params: {},
            }, {
                beforeSend: () => checkDailyActionDay(snapshot),
                onSent: () => (0, daily_completion_1.recordDailyMark)(check, 'pending_confirmation'),
            }).catch(error => {
                if (/^\d+$/.test(String(error?.code || '')))
                    (0, daily_completion_1.recordDailyMark)(check, 'clear_pending');
                throw error;
            });
            if (!reply?.yshf_share) {
                (0, daily_completion_1.recordDailyMark)(check, 'pending_confirmation');
                throw businessError('YSHF_DAILY_ACTION_PENDING', '分享回包未能确认，请先刷新活动状态');
            }
            sharedDateKey = snapshot.daily.dateKey;
            const share = reply.yshf_share;
            const grant = share.grant;
            const count = grant ? int64String(grant.count) : YSHF_SHARE_SEED_FALLBACK;
            sharedSeedCount = count;
            (0, daily_completion_1.recordDailyMark)(check, 'pending_confirmation', { count });
            // cmd 98 只是“活动内的分享动作”，官方客户端还会走一次
            // ShareService.CheckCanShare → ReportShare{field_1:28, field_4:2017}，
            // 暴击加成要到这一步才真正落地。参考 Anrylin/qq-farm-bot 的实机实现。
            // 上报失败不阻断主流程，但要把原因透出去，免得用户以为分享没生效。
            let shareReported = false;
            let shareReportError = '';
            try {
                const checkBody = Buffer.from(types.CheckCanShareRequest.encode(types.CheckCanShareRequest.create({})).finish());
                const checkReply = await sendMsgAsync('gamepb.sharepb.ShareService', 'CheckCanShare', checkBody);
                if (types.CheckCanShareReply.decode(checkReply.body).can_share) {
                    const reportBody = Buffer.from(types.ReportShareRequest.encode(types.ReportShareRequest.create({ field_1: 28, field_4: 2017 })).finish());
                    await sendMsgAsync('gamepb.sharepb.ShareService', 'ReportShare', reportBody, {
                        beforeSend: () => checkDailyActionDay(snapshot),
                    });
                    shareReported = true;
                }
                else {
                    shareReportError = '当前分享入口不可用（CheckCanShare=false）';
                }
            }
            catch (error) {
                shareReportError = String(error?.message || error || '分享上报失败');
                try {
                    require('../../utils/utils').logWarn('以薯换福分享上报失败', { error: shareReportError });
                }
                catch {
                    // 日志失败不影响主流程
                }
            }
            return {
                count,
                seedReward: grant ? itemDto({ item_id: int64String(grant.item_id), count }) : null,
                price: share ? int64String(share.price) : snapshot.shop.price,
                shareKey: share?.shop?.share_key || '',
                shareReported,
                shareReportError,
                message: (shareReported ? '已提交分享，等待游戏确认暴击' : '分享上报未确认，请在 QQ 或微信游戏里分享铺子后刷新')
                    + (grant && count !== '0' ? ` · 获得 ${count} 个红薯种子` : ''),
                snapshot: options.withSnapshot === false ? null : await getActivityCenterSnapshot(),
            };
        });
    }
    // 进程起来后先预热一次背包。首个快照最容易被网关并发挤掉，而这时进程里还没有
    // “上次成功值”可回退，界面就会一路 "--" 到下一次成功为止。提前拉一次把兜底填上。
    const warmupTimer = setTimeout(() => {
        void refreshBalances();
    }, 1200);
    if (typeof warmupTimer?.unref === 'function')
        warmupTimer.unref();
    return {
        getCurrentYishuHuanfuActivity,
        claimYishuHuanfuSeeds,
        queryYishuHuanfuShop,
        scanYishuHuanfuFriendShops,
        refreshYishuHuanfuFriendShops,
        tickYishuHuanfuFriendShops,
        setYishuOnlineShopAccounts,
        sellYishuHuanfuSweetPotato,
        resolveYishuSale,
        refreshYishuHuanfuQuote,
        queryYishuHuanfuCatalog,
        queryYishuHuanfuRecords,
        claimYishuHuanfuCommission,
        exchangeYishuHuanfuGoods,
        shareYishuHuanfuShop,
    };
}
module.exports = { createYishuHuanfuActivityService };
//# sourceMappingURL=yishuhuanfu.js.map