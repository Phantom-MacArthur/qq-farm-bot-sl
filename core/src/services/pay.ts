export {};

const { sendMsgAsync } = require('../utils/network');
const { types } = require('../utils/proto');
const DEFAULT_RECHARGE_SOURCE: string = 'MallUI';

async function getRechargeInfo(source: string = DEFAULT_RECHARGE_SOURCE): Promise<any> {
    const body: Uint8Array = types.GetRechargeInfoRequest.encode(
        types.GetRechargeInfoRequest.create({
            source: String(source || DEFAULT_RECHARGE_SOURCE),
        }),
    ).finish();
    const { body: replyBody } = await sendMsgAsync(
        'gamepb.paypb.PayService',
        'GetRechargeInfo',
        body,
    );
    return types.GetRechargeInfoReply.decode(replyBody);
}

async function getDiamondBalance(): Promise<number> {
    const reply: any = await getRechargeInfo();
    const infos: any[] = Array.isArray(reply?.recharge_infos) ? reply.recharge_infos : [];
    if (!infos[0] || infos[0].balance === null || infos[0].balance === undefined) {
        throw new Error('钻石余额未能确认');
    }
    const rawBalance = infos[0].balance;
    const balance = Number(rawBalance);
    if ((typeof rawBalance !== 'number' && typeof rawBalance !== 'string' && typeof rawBalance !== 'object')
        || (typeof rawBalance === 'string' && !/^\d+$/.test(rawBalance))
        || !Number.isSafeInteger(balance) || balance < 0) throw new Error('钻石余额未能确认');
    return balance;
}

module.exports = {
    DEFAULT_RECHARGE_SOURCE,
    getDiamondBalance,
    getRechargeInfo,
};
