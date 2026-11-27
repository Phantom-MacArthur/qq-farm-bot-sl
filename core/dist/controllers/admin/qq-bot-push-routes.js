"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mountQqBotPushRoutes = mountQqBotPushRoutes;
const store = require('../../models/store');
const { getActiveQqBotPush } = require('../../services/qq-bot-push');
const { handleApiError } = require('./middleware');
const ROUTE = '/api/settings/qq-bot-push';
function requireJson(req, res, next) {
    if (!req.is('application/json')) {
        res.status(415).json({ ok: false, error: '请使用 application/json 提交推送设置' });
        return;
    }
    next();
}
function snapshot() {
    const service = getActiveQqBotPush();
    const config = service?.getConfig() ?? store.getQqBotPush();
    return {
        enabled: config.enabled && config.channelEnabled,
        appId: config.appId,
        appSecretConfigured: !!config.appSecret,
        openid: config.openid,
        offlineNotify: config.offlineNotify,
        status: service?.getStatus() ?? null,
    };
}
function mountQqBotPushRoutes(app) {
    app.get(ROUTE, (_req, res) => res.json({ ok: true, data: snapshot() }));
    app.post(ROUTE, requireJson, (req, res) => {
        try {
            const body = req.body || {};
            const saved = store.getQqBotPush();
            const service = getActiveQqBotPush();
            const appId = String(body.appId ?? saved.appId).trim();
            const suppliedSecret = typeof body.appSecret === 'string' ? body.appSecret.trim() : '';
            const appSecret = suppliedSecret || (appId === saved.appId ? saved.appSecret : '');
            const enabled = body.enabled === true;
            if (enabled && (!appId || !appSecret)) {
                res.status(400).json({ ok: false, error: '启用 QQ 机器人前请填写 AppID 和 AppSecret' });
                return;
            }
            const update = { channelEnabled: enabled, enabled, appId, appSecret,
                openid: String(body.openid ?? saved.openid).trim(), offlineNotify: body.offlineNotify !== false };
            if (service)
                service.setConfig(update);
            else
                store.setQqBotPush(update);
            res.json({ ok: true, data: snapshot() });
        }
        catch (error) {
            handleApiError(res, error);
        }
    });
    app.post(`${ROUTE}/capture`, requireJson, (_req, res) => {
        try {
            const service = getActiveQqBotPush();
            if (!service)
                throw new Error('推送服务未初始化');
            service.startCapture();
            res.json({ ok: true, data: snapshot() });
        }
        catch (error) {
            handleApiError(res, error);
        }
    });
    app.post(`${ROUTE}/test`, requireJson, async (_req, res) => {
        try {
            const service = getActiveQqBotPush();
            if (!service)
                throw new Error('推送服务未初始化');
            await service.testSend();
            res.json({ ok: true });
        }
        catch (error) {
            handleApiError(res, error);
        }
    });
}
//# sourceMappingURL=qq-bot-push-routes.js.map