"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const { sendMsgAsync } = require('../utils/network');
const { types } = require('../utils/proto');
const DEFAULT_RECHARGE_SOURCE = 'MallUI';
async function getRechargeInfo(source = DEFAULT_RECHARGE_SOURCE) {
    const body = types.GetRechargeInfoRequest.encode(types.GetRechargeInfoRequest.create({
        source: String(source || DEFAULT_RECHARGE_SOURCE),
    })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.paypb.PayService', 'GetRechargeInfo', body);
    return types.GetRechargeInfoReply.decode(replyBody);
}
async function getDiamondBalance() {
    const reply = await getRechargeInfo();
    const infos = Array.isArray(reply?.recharge_infos) ? reply.recharge_infos : [];
    if (!infos[0] || infos[0].balance === null || infos[0].balance === undefined) {
        throw new Error('钻石余额未能确认');
    }
    const rawBalance = infos[0].balance;
    const balance = Number(rawBalance);
    if ((typeof rawBalance !== 'number' && typeof rawBalance !== 'string' && typeof rawBalance !== 'object')
        || (typeof rawBalance === 'string' && !/^\d+$/.test(rawBalance))
        || !Number.isSafeInteger(balance) || balance < 0)
        throw new Error('钻石余额未能确认');
    return balance;
}
module.exports = {
    DEFAULT_RECHARGE_SOURCE,
    getDiamondBalance,
    getRechargeInfo,
};
//# sourceMappingURL=pay.js.map