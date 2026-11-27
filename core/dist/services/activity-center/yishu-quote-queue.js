"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createYishuQuoteQueue = createYishuQuoteQueue;
function createYishuQuoteQueue(deps) {
    let day = '';
    let minimumDay = deps.minimumDay?.() || '';
    let targets = [];
    let background = [];
    let manual = [];
    let manualInFlightDay = '';
    let busy = false;
    let lastStartedAt = -Infinity;
    let roundStartedAt = -Infinity;
    let lastError = '';
    let manualNote = '';
    let limit = 0;
    const rows = new Map();
    const failures = new Set();
    const attempts = new Map();
    let onlineTargets = new Map();
    let priority = new Set();
    function currentDay() {
        const next = deps.day();
        if (!next || next < minimumDay)
            return '';
        if (next === day)
            return day;
        day = next;
        if (day > minimumDay) {
            minimumDay = day;
            deps.activateDay?.(day);
        }
        rows.clear();
        for (const row of deps.restore(day))
            rows.set(row.gid, row);
        failures.clear();
        attempts.clear();
        priority = new Set([...onlineTargets.keys()].filter(gid => !rows.has(gid)));
        targets = [];
        background = [];
        manual = [];
        roundStartedAt = -Infinity;
        lastError = '';
        manualNote = '';
        return day;
    }
    function snapshot() {
        const activeDay = currentDay();
        const quoted = (activeDay ? [...rows.values()].map(row => ({ ...row, ...onlineTargets.get(row.gid) })) : []).sort((a, b) => {
            const delta = (BigInt(b.totalPrice) - BigInt(a.totalPrice)) || (BigInt(b.quota) - BigInt(a.quota));
            return delta < 0n ? -1 : delta > 0n ? 1 : 0;
        });
        const known = new Set(activeDay ? [...rows.keys(), ...targets.map(target => target.gid), ...onlineTargets.keys()] : []);
        const unquoted = activeDay ? [...onlineTargets.values()].filter(target => !rows.has(target.gid)).map(target => ({
            ...target, quotePending: true, price: '0', bonus: '0', totalPrice: '0', quota: '0', quotaCap: '0', quotaUsed: '0',
            canSell: null, sharedToday: false, quotedAt: 0,
        })) : [];
        return {
            shops: [...quoted, ...unquoted], best: quoted[0] || null, ownShop: null, cached: true, paced: true,
            scanned: quoted.length, failed: activeDay ? failures.size : 0, candidateCount: known.size, friendCount: known.size,
            pendingCount: [...known].filter(gid => !rows.has(gid) && !failures.has(gid)).length,
            panelFriendCount: activeDay ? targets.filter(target => target.via === 'panel').length : 0,
            panelScannedCount: quoted.filter(shop => shop.via === 'panel').length,
            scannedAt: quoted.reduce((latest, shop) => Math.max(latest, shop.quotedAt * 1000), 0),
            day: activeDay, limit, manualPending: activeDay ? manual.length + Number(manualInFlightDay === activeDay) : 0,
            friendListError: activeDay ? lastError : '', message: activeDay ? manualNote : '等待游戏服务器确认当天报价日期',
        };
    }
    function setOnlineTargets(targets) {
        const next = new Map(targets.map(target => [target.gid, target]));
        for (const gid of onlineTargets.keys()) {
            if (!next.has(gid))
                priority.delete(gid);
        }
        for (const gid of next.keys()) {
            if (!onlineTargets.has(gid) && !rows.has(gid))
                priority.add(gid);
        }
        onlineTargets = next;
    }
    function refreshZeroQuotes() {
        const activeDay = currentDay();
        if (activeDay && !manual.length && manualInFlightDay !== activeDay) {
            manual = [...rows.values()].filter(row => row.price === '0' || row.bonus === '0');
            manualNote = manual.length ? '' : '暂无基础价或加成为 0 的已查铺子';
        }
        return snapshot();
    }
    async function tick(options) {
        const startedDay = currentDay();
        if (!startedDay || busy || !options.ready())
            return;
        limit = options.limit;
        if (!options.enabled()) {
            background = [];
            roundStartedAt = -Infinity;
        }
        const spacing = manual.length ? 3000 : 10000;
        const now = deps.now();
        if (now - lastStartedAt < spacing)
            return;
        busy = true;
        try {
            if (!manual.length && !priority.size && !background.length && options.enabled() && now - roundStartedAt >= options.intervalMs) {
                roundStartedAt = now;
                try {
                    const loaded = await deps.loadTargets();
                    if (currentDay() !== startedDay || !options.ready() || !options.enabled())
                        return;
                    targets = [...new Map([...loaded.map(target => [target.gid, target]), ...onlineTargets]).values()];
                    background = targets.filter(target => !onlineTargets.has(target.gid)
                        || now - (attempts.get(target.gid) ?? -Infinity) >= options.intervalMs).sort((a, b) => {
                        const aTime = attempts.get(a.gid) ?? (rows.has(a.gid) ? -1 : -Infinity);
                        const bTime = attempts.get(b.gid) ?? (rows.has(b.gid) ? -1 : -Infinity);
                        return aTime === bTime ? 0 : aTime - bTime;
                    }).slice(0, limit);
                    lastError = '';
                }
                catch (error) {
                    if (currentDay() === startedDay)
                        lastError = error?.message || '好友列表读取失败';
                    return;
                }
            }
            const expedited = manual.length > 0;
            const priorityGid = options.enabled() ? priority.values().next().value : undefined;
            const target = expedited ? manual.shift() : priorityGid ? onlineTargets.get(priorityGid) : options.enabled() ? background.shift() : undefined;
            if (!target || !options.ready())
                return;
            priority.delete(target.gid);
            background = background.filter(item => item.gid !== target.gid);
            manualInFlightDay = expedited ? startedDay : '';
            lastStartedAt = deps.now();
            attempts.set(target.gid, lastStartedAt);
            try {
                const quote = await deps.query(target);
                if (currentDay() !== startedDay || !options.ready())
                    return;
                rows.set(target.gid, quote);
                failures.delete(target.gid);
                manualNote = '';
                deps.save(day, [...rows.values()]);
            }
            catch (error) {
                if (currentDay() !== startedDay || !options.ready())
                    return;
                failures.add(target.gid);
                if (error?.code === 'YSHF_SHOP_CLOSED' && rows.delete(target.gid)) {
                    deps.save(day, [...rows.values()]);
                }
            }
        }
        finally {
            manualInFlightDay = '';
            busy = false;
        }
    }
    function updateQuota(saleDay, gid, quota) {
        if (!saleDay || saleDay !== currentDay())
            return;
        const row = rows.get(gid);
        if (!row)
            return;
        rows.set(gid, { ...row, quota, quotaUsed: (BigInt(row.quotaCap) - BigInt(quota)).toString() });
        deps.save(day, [...rows.values()]);
    }
    return { currentDay, snapshot, refreshZeroQuotes, tick, updateQuota, setOnlineTargets };
}
//# sourceMappingURL=yishu-quote-queue.js.map