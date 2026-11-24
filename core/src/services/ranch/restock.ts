export {};
const { getState } = require('./state');
const { prepareAction, operate } = require('./actions');
const { getAutomation } = require('../../models/store');
const { selectAnimal } = require('./automation');

async function restock(): Promise<any> {
    const settings = getAutomation();
    const bagFirst = settings.ranch_strategy === 'bag_priority';
    let completed = 0;
    const messages: string[] = [];
    const initial = await getState('animals');
    for (const type of [6, 7]) {
        const initialPen = initial.facilities?.find((f: any) => f.moduleType === type && f.active);
        if (!initialPen) continue;
        // Each successful iteration must reduce a real vacancy; never buy indefinitely.
        const limit = Math.max(0, Number(initialPen.ranch?.capacity) - Number(initialPen.ranch?.count));
        for (let iteration = 0; iteration < limit; iteration++) {
            try {
                const state = await getState('bag');
                const pen = state.facilities.find((f: any) => f.id === initialPen.id && f.active);
                const room = pen?.ranch ? pen.ranch.capacity - pen.ranch.count : 0;
                if (room <= 0) break;
                const priority: number[] = type === 6 ? settings.ranch_coop_cub_priority : settings.ranch_shed_cub_priority;
                let selected: any;
                if (!bagFirst) {
                    const shop = await getState('shop', 5);
                    selected = selectAnimal(shop.shop.goods, settings, type === 6 ? 1 : 2);
                    if (!selected) break;
                }
                const stock = (state.bag || []).filter((item: any) => !item.locked && item.animalId
                    && Number(item.count) > 0 && item.husbandryType === (type === 6 ? '窝' : '棚')
                    && (bagFirst || item.animalId === selected.animal.id));
                stock.sort((a: any, b: any) => (bagFirst
                    ? (priority.indexOf(a.id) < 0 ? priority.length : priority.indexOf(a.id))
                    - (priority.indexOf(b.id) < 0 ? priority.length : priority.indexOf(b.id)) : 0)
                    || b.animalId - a.animalId || a.id - b.id);
                let action = 'place';
                let input: any;
                if (stock.length) {
                    input = { ranchId: pen.id, itemId: stock[0].id, count: Math.min(room, Number(stock[0].count)) };
                } else {
                    if (!selected) {
                        const shop = await getState('shop', 5);
                        selected = selectAnimal(shop.shop.goods, settings, type === 6 ? 1 : 2);
                    }
                    if (!selected) break;
                    const count = Math.min(room, selected.maxCount, selected.remaining ?? Infinity,
                        Math.floor(Number(selected.price.balance) / Number(selected.price.count)));
                    if (count <= 0) break;
                    action = 'buy';
                    input = { shopId: 5, goodsId: selected.id, count, autoPlace: true };
                }
                const quote = await prepareAction(action, input);
                if (quote.skipped) break;
                const result = await operate(action, { ...input, expected: quote.expected });
                if (result.status !== 'confirmed' || result.sceneRestored === false) {
                    messages.push(pen.name + '：放养结果待确认');
                    break;
                }
                const after = await getState('animals');
                const nextPen = after.facilities.find((f: any) => f.id === pen.id);
                const added = Number(nextPen?.ranch?.count) - Number(pen.ranch.count);
                if (!(added > 0)) {
                    messages.push(pen.name + '：空位未减少，请刷新核对');
                    break;
                }
                completed += added;
            } catch (error: any) {
                messages.push(initialPen.name + '：' + error.message);
                break;
            }
        }
    }
    return { status: completed ? 'confirmed' : 'skipped', completed, snapshot: await getState('animals'),
        notice: '已补栏: ' + completed + (messages.length ? '；' + messages.join('；') : ''), refreshRequired: true };
}
module.exports = { restock };
