"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const { getState } = require('./state');
const { prepareAction, operate } = require('./actions');
const { getAutomation } = require('../../models/store');
const { selectAnimal } = require('./automation');
async function restock() {
    const settings = getAutomation();
    const illustrated = settings.ranch_strategy === 'illustrated';
    const bagFirst = settings.ranch_strategy === 'bag_priority' || illustrated;
    const pending = new Set();
    if (illustrated) {
        const book = await getState('illustrated');
        if (!Array.isArray(book.book?.animals))
            throw new Error('牧场图鉴状态无效');
        for (const item of book.book.animals)
            if (!item.unlocked && item.animalId)
                pending.add(Number(item.animalId));
    }
    let completed = 0;
    const messages = [];
    const initial = await getState('animals');
    for (const type of [6, 7]) {
        const initialPen = initial.facilities?.find((f) => f.moduleType === type && f.active);
        if (!initialPen)
            continue;
        // Each successful iteration must reduce a real vacancy; never buy indefinitely.
        const limit = Math.max(0, Number(initialPen.ranch?.capacity) - Number(initialPen.ranch?.count));
        for (let iteration = 0; iteration < limit; iteration++) {
            try {
                const state = await getState('bag');
                const pen = state.facilities.find((f) => f.id === initialPen.id && f.active);
                const room = pen?.ranch ? pen.ranch.capacity - pen.ranch.count : 0;
                if (room <= 0)
                    break;
                const priority = type === 6 ? settings.ranch_coop_cub_priority : settings.ranch_shed_cub_priority;
                const active = new Set(state.facilities.flatMap((facility) => (facility.ranch?.animals || []).map((animal) => Number(animal.animalId))));
                const targets = new Set([...pending].filter(id => !active.has(id)));
                const choose = (goods) => {
                    if (!illustrated)
                        return selectAnimal(goods, settings, type === 6 ? 1 : 2);
                    const candidates = goods.filter(good => good.available && good.animal?.enable_flag
                        && good.animal.husbandry_type === (type === 6 ? '窝' : '棚') && good.price.id === 1007 && BigInt(good.price.count) > 0n);
                    return candidates.filter(good => targets.has(good.animal.id))
                        .sort((a, b) => Number(a.requiredLevel || 0) - Number(b.requiredLevel || 0) || a.animal.id - b.animal.id)[0]
                        || selectAnimal(candidates, { ...settings, ranch_strategy: settings.ranch_bag_fallback }, type === 6 ? 1 : 2);
                };
                let selected;
                if (!bagFirst) {
                    const shop = await getState('shop', 5);
                    selected = choose(shop.shop.goods);
                    if (!selected)
                        break;
                }
                const stock = (state.bag || []).filter((item) => !item.locked && item.animalId
                    && Number(item.count) > 0 && item.husbandryType === (type === 6 ? '窝' : '棚')
                    && (illustrated ? targets.has(item.animalId) : bagFirst || item.animalId === selected.animal.id));
                stock.sort((a, b) => (illustrated ? (a.requiredLevel ?? Infinity) - (b.requiredLevel ?? Infinity) || a.animalId - b.animalId : bagFirst
                    ? (priority.indexOf(a.id) < 0 ? priority.length : priority.indexOf(a.id))
                        - (priority.indexOf(b.id) < 0 ? priority.length : priority.indexOf(b.id)) : 0)
                    || b.animalId - a.animalId || a.id - b.id);
                if (illustrated && settings.ranch_bag_fallback === 'bag_priority' && !stock.length) {
                    const shop = await getState('shop', 5);
                    selected = choose(shop.shop.goods);
                    // 可执行的图鉴目标优先于第二策略的常规背包补栏。
                    if (!selected || !targets.has(selected.animal.id)) {
                        const extra = (state.bag || []).filter((item) => !item.locked && item.animalId
                            && Number(item.count) > 0 && item.husbandryType === (type === 6 ? '窝' : '棚'));
                        const rank = (id) => priority.indexOf(id) < 0 ? priority.length : priority.indexOf(id);
                        extra.sort((a, b) => rank(a.id) - rank(b.id) || b.animalId - a.animalId || a.id - b.id);
                        stock.push(...extra);
                    }
                }
                let action = 'place';
                let input;
                if (stock.length) {
                    input = { ranchId: pen.id, itemId: stock[0].id, count: Math.min(illustrated && targets.has(stock[0].animalId) ? 1 : Infinity, room, Number(stock[0].count)) };
                }
                else {
                    if (!selected) {
                        const shop = await getState('shop', 5);
                        selected = choose(shop.shop.goods);
                    }
                    if (!selected)
                        break;
                    const count = Math.min(illustrated && targets.has(selected.animal.id) ? 1 : Infinity, room, selected.maxCount, selected.remaining ?? Infinity, Math.floor(Number(selected.price.balance) / Number(selected.price.count)));
                    if (count <= 0)
                        break;
                    action = 'buy';
                    input = { shopId: 5, goodsId: selected.id, count, autoPlace: true };
                }
                const quote = await prepareAction(action, input);
                if (quote.skipped)
                    break;
                const result = await operate(action, { ...input, expected: quote.expected });
                if (result.status !== 'confirmed' || result.sceneRestored === false) {
                    messages.push(pen.name + '：放养结果待确认');
                    break;
                }
                const after = await getState('animals');
                const nextPen = after.facilities.find((f) => f.id === pen.id);
                const added = Number(nextPen?.ranch?.count) - Number(pen.ranch.count);
                if (!(added > 0)) {
                    messages.push(pen.name + '：空位未减少，请刷新核对');
                    break;
                }
                completed += added;
            }
            catch (error) {
                messages.push(initialPen.name + '：' + error.message);
                break;
            }
        }
    }
    return { status: completed ? 'confirmed' : 'skipped', completed, snapshot: await getState('animals'),
        notice: '已补栏: ' + completed + (messages.length ? '；' + messages.join('；') : ''), refreshRequired: true };
}
module.exports = { restock };
//# sourceMappingURL=restock.js.map