const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');

const networkPath = require.resolve('../dist/utils/network');
const protoPath = require.resolve('../dist/utils/proto');
const utilsPath = require.resolve('../dist/utils/utils');

const outcomes = [];
const networkEvents = new EventEmitter();

require.cache[networkPath] = {
    exports: {
        sendMsgAsync: async () => {
            const next = outcomes.shift();
            if (!next) return {};
            return next();
        },
        getUserState: () => ({ gid: 1 }),
        networkEvents,
    },
};
require.cache[protoPath] = {
    exports: {
        types: {
            FertilizeRequest: {
                create: value => value,
                encode: () => ({ finish: () => Buffer.alloc(0) }),
            },
            FertilizeReply: {
                decode: () => ({}),
            },
        },
    },
};
require.cache[utilsPath] = {
    exports: {
        toLong: value => value,
        toNum: value => Number(value) || 0,
        sleep: async () => {},
        randomDelay: async () => {},
        log: () => {},
        logWarn: () => {},
    },
};

const {
    fertilize, fertilizeBatch, fertilizeOrganicLoop, isSkippableFertilizeLandError,
    isFertilizerContainerEmpty, NORMAL_FERTILIZER_ID, ORGANIC_FERTILIZER_ID,
} = require('../dist/services/farm/api');

const containerEmptyError = () => {
    throw Object.assign(new Error('Fertilize failed'), { code: 1000019, errorMessage: '化肥容器不足' });
};

test.beforeEach(() => {
    outcomes.length = 0;
    networkEvents.emit('itemChanges', [
        { item: { id: NORMAL_FERTILIZER_ID }, delta: 1 },
        { item: { id: ORGANIC_FERTILIZER_ID }, delta: 1 },
    ]);
});

test('isSkippableFertilizeLandError recognizes per-land fertilize rejects', () => {
    assert.equal(isSkippableFertilizeLandError({ code: 1001024 }), true);
    assert.equal(isSkippableFertilizeLandError({ code: 1001025, message: '之前阶段已使用了该化肥' }), true);
    assert.equal(isSkippableFertilizeLandError(new Error('PlantService.Fertilize 错误: code=1001025 之前阶段已使用了该化肥')), true);
    assert.equal(isSkippableFertilizeLandError(new Error('code=1000019 肥料不足')), false);
    assert.equal(isSkippableFertilizeLandError(new Error('network down')), false);
});

test('fertilize skips 1001025 lands and continues, then stops on other errors', async () => {
    outcomes.push(
        () => {
            const error = new Error('PlantService.Fertilize 错误: code=1001025 之前阶段已使用了该化肥');
            error.code = 1001025;
            throw error;
        },
        () => ({}),
        () => {
            const error = new Error('PlantService.Fertilize 错误: code=1001024 当前阶段不可施肥');
            error.code = 1001024;
            throw error;
        },
        () => ({}),
        () => {
            throw new Error('PlantService.Fertilize 错误: code=1000019 肥料不足');
        },
        () => ({}),
    );

    const count = await fertilize([1, 2, 3, 4, 5, 6], 1011, false);
    assert.equal(count, 2);
    assert.equal(outcomes.length, 1);
    assert.equal(isFertilizerContainerEmpty(1011), false, '肥料不足的文案不该记成容器为空');
});

test('普通化肥容器不足会记住结论，施成功或到期后解除', async () => {
    outcomes.push(containerEmptyError);
    assert.equal(await fertilize([11], NORMAL_FERTILIZER_ID, false), 0);
    assert.equal(isFertilizerContainerEmpty(NORMAL_FERTILIZER_ID), true);
    assert.equal(isFertilizerContainerEmpty(ORGANIC_FERTILIZER_ID), false);
    outcomes.push(() => ({}));
    assert.equal(await fertilize([11], NORMAL_FERTILIZER_ID, true), 0);
    assert.equal(outcomes.length, 1, '暂停期间未发送请求');

    const realNow = Date.now;
    Date.now = () => realNow() + 6 * 60 * 1000;
    try {
        assert.equal(isFertilizerContainerEmpty(NORMAL_FERTILIZER_ID), false, '超过 5 分钟要重新试探');
    } finally {
        Date.now = realNow;
    }

    assert.equal(await fertilize([12], NORMAL_FERTILIZER_ID, true), 1);
    outcomes.push(containerEmptyError, () => ({}));
    assert.equal(await fertilize([12], NORMAL_FERTILIZER_ID, true), 0);
    assert.equal(isFertilizerContainerEmpty(NORMAL_FERTILIZER_ID), true);
    await fertilizeBatch([13], NORMAL_FERTILIZER_ID);
    assert.equal(isFertilizerContainerEmpty(NORMAL_FERTILIZER_ID), false, '手动施肥仍能请求，成功后恢复自动施肥');
});

test('有机肥确认缺货时只暂停有机肥，收到补充事件后解除', async () => {
    outcomes.push(containerEmptyError);
    await assert.rejects(() => fertilizeBatch([1], ORGANIC_FERTILIZER_ID), { code: 1000019 });
    assert.equal(await fertilizeOrganicLoop([1], false), 0);
    assert.equal(isFertilizerContainerEmpty(ORGANIC_FERTILIZER_ID), true);
    assert.equal(isFertilizerContainerEmpty(NORMAL_FERTILIZER_ID), false);
    networkEvents.emit('itemChanges', [{ item: { id: NORMAL_FERTILIZER_ID }, delta: 1 }]);
    assert.equal(isFertilizerContainerEmpty(ORGANIC_FERTILIZER_ID), true);
    networkEvents.emit('itemChanges', [{ item: { id: ORGANIC_FERTILIZER_ID }, delta: 1 }]);
    assert.equal(isFertilizerContainerEmpty(ORGANIC_FERTILIZER_ID), false);
});

for (const organic of [false, true]) {
    test(`${organic ? 'organic loop' : 'normal fertilizer'} preserves partial success on stock shortage in strict mode`, async () => {
        outcomes.push(() => ({}), () => {
            throw Object.assign(new Error('肥料不足'), { code: 1000019 });
        }, () => ({}));
        const count = organic
            ? await fertilizeOrganicLoop([1, 2, 3], true)
            : await fertilize([1, 2, 3], 1011, true);
        assert.equal(count, 1);
        assert.equal(outcomes.length, 1, 'must not retry after fertilizer is exhausted');
    });

    test(`${organic ? 'organic loop' : 'normal fertilizer'} still propagates network failures`, async () => {
        outcomes.push(() => { throw new Error('network down'); });
        await assert.rejects(organic
            ? fertilizeOrganicLoop([1], true)
            : fertilize([1], 1011, true), /network down/);
    });
}
