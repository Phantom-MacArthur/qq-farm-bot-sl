import type { Request } from 'express';
import type { ActivityRouteContext } from './types';

export function mountYishuHuanfuActivityRoutes({ app, ctx, withAccount, mountGet }: ActivityRouteContext): void {
    mountGet('/api/activity-center/yishuhuanfu', 'getCurrentYishuHuanfuActivity');
    mountGet('/api/activity-center/yishuhuanfu/catalog', 'queryYishuHuanfuCatalog');
    // 收购记录列表（cmd 95，只读）：界面「只展示最近 30 条」。
    mountGet('/api/activity-center/yishuhuanfu/records', 'queryYishuHuanfuRecords');
    mountGet('/api/activity-center/yishuhuanfu/farm', 'getYishuFarmStatus');
    app.get('/api/activity-center/yishuhuanfu/history', withAccount(async (accountId, req) =>
        ctx.provider.getYishuAutomationHistory(accountId, req.query?.day)));
    app.post('/api/activity-center/yishuhuanfu/sell/resolve', withAccount((accountId, req) =>
        ctx.provider.resolveYishuSale(accountId, req.body?.orderId)));
    mountGet('/api/activity-center/yishuhuanfu/friends', 'scanYishuHuanfuFriendShops');
    app.post('/api/activity-center/yishuhuanfu/friends/refresh', withAccount(accountId =>
        ctx.provider.refreshYishuHuanfuFriendShops(accountId)));
    // 查铺子行情（cmd 92，只读）：不传 friendGid 查自己铺子。
    app.get('/api/activity-center/yishuhuanfu/shop', withAccount((accountId: string, req: Request) => (
        ctx.provider.queryYishuHuanfuShop(accountId, req.query?.friendGid ?? null)
    )));
    // 卖薯（cmd 93）：friendGid 缺省卖给自己铺子；count 缺省卖出背包全部。
    app.post('/api/activity-center/yishuhuanfu/sell', withAccount((accountId: string, req: Request) => (
        ctx.provider.sellYishuHuanfuSweetPotato(accountId, req.body?.friendGid ?? null, req.body?.count ?? null, {
            expectedPrice: req.body?.expectedPrice,
            expectedQuota: req.body?.expectedQuota,
            expectedDay: req.body?.expectedDay,
            clientOrderId: typeof req.body?.clientOrderId === 'string' ? req.body.clientOrderId.slice(0, 80) : undefined,
            withSnapshot: req.body?.withSnapshot !== false,
        })
    )));
    // 兑换下单（cmd 96）：index 为目录序号，count 为数量。
    app.post('/api/activity-center/yishuhuanfu/exchange', withAccount((accountId: string, req: Request) => (
        ctx.provider.exchangeYishuHuanfuGoods(accountId, req.body?.index, req.body?.count ?? 1)
    )));
    app.post('/api/activity-center/yishuhuanfu/quote/refresh', withAccount((accountId: string) => ctx.provider.refreshYishuHuanfuQuote(accountId)));
    // 领取收购提成（cmd 99）。
}
