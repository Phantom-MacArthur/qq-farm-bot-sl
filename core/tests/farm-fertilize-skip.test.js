const assert = require('node:assert/strict');
const test = require('node:test');

const networkPath = require.resolve('../dist/utils/network');
const protoPath = require.resolve('../dist/utils/proto');
const utilsPath = require.resolve('../dist/utils/utils');

const outcomes = [];

require.cache[networkPath] = {
    exports: {
        sendMsgAsync: async () => {
            const next = outcomes.shift();
            if (!next) return {};
            return next();
        },
        getUserState: () => ({ gid: 1 }),
        networkEvents: { emit() {} },
    },
};
require.cache[protoPath] = {
    exports: {
        types: {
            FertilizeReply: { decode: body => body || {} },
            FertilizeRequest: {
                create: value => value,
                encode: () => ({ finish: () => Buffer.alloc(0) }),
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

const { fertilize, fertilizeOrganicLoop, isSkippableFertilizeLandError } = require('../dist/services/farm/api');

test.beforeEach(() => { outcomes.length = 0; });

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
