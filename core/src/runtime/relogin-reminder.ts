import type { PushNotification } from '../config/notification-types';
import { normalizeNotificationTypes } from '../config/notification-types';
const { sendPushChannels } = require('../services/push');

export {};

interface ReloginReminderOptions {
    store: any;
    sendPushooMessage: (payload: any) => Promise<any>;
    sendWxPusherMessage?: (payload: any) => Promise<any>;
    sendWxPusherWechatMessage?: (payload: any) => Promise<any>;
    log: (tag: string, msg: string, extra?: any) => void;
}

interface OfflineReminderPayload {
    accountId?: string;
    accountName?: string;
    reason?: string;
    offlineMs?: number;
}

function createReloginReminderService(options: ReloginReminderOptions) {
    const { store, sendPushooMessage, sendWxPusherMessage, sendWxPusherWechatMessage, log } = options;

    // 按渠道从 channelCredentials 解析 token / wxPusherUid；
    // 若分渠道凭据暂缺，兼容回退到旧版顶层 token / wxPusherUid 字段。
    function resolvePushChannel(accountId: string):
        | { ok: true; channel: string; token: string; wxPusherUid: string; endpoint: string; secret: string }
        | { ok: false; reason: string } {
        const cfg = store.getOfflineReminder ? store.getOfflineReminder(accountId) : null;
        if (!cfg) return { ok: false, reason: '未找到下线提醒配置' };

        const channel = String(cfg.channel || '').trim().toLowerCase();
        if (!channel) return { ok: false, reason: '下线提醒配置不完整' };

        const credentials = (cfg.channelCredentials && typeof cfg.channelCredentials === 'object')
            ? cfg.channelCredentials as Record<string, { token?: string; wxPusherUid?: string }>
            : {};
        const entry = credentials[channel] || {};
        const token = String(entry.token || cfg.token || '').trim();
        const wxPusherUid = String(entry.wxPusherUid || cfg.wxPusherUid || '').trim();
        const endpoint = String(cfg.endpoint || '').trim();
        const secret = String(cfg.secret || '').trim();

        if (channel === 'webhook' && !endpoint) return { ok: false, reason: 'Webhook 渠道未设置接口地址' };
        if (channel === 'dingtalk' && !endpoint && !token) return { ok: false, reason: '钉钉渠道未设置 Webhook 地址' };
        if (channel !== 'webhook' && channel !== 'dingtalk' && !token) return { ok: false, reason: '下线提醒渠道未设置 Token' };
        if (channel === 'wxpusher_wechat' && !wxPusherUid) return { ok: false, reason: 'WxPusher 渠道未设置接收者 UID' };
        return { ok: true, channel, token, wxPusherUid, endpoint, secret };
    }

    async function sendConfiguredPush(payload: { candidates?: PushNotification[]; title?: string; content?: string; accountId?: string; accountName?: string; logLabel?: string; appendAccountName?: boolean } = {}): Promise<void> {
        const accountId = String(payload.accountId || '').trim();
        const accountName = String(payload.accountName || '').trim();
        const global = store.getPushNotifications?.();
        const enabled = normalizeNotificationTypes(global?.notificationTypes);
        const notification = payload.candidates ? payload.candidates.find(item => enabled[item.type]) : payload;
        if (!notification) return;
        const baseTitle = String(notification.title || '').trim();
        const content = String(notification.content || '').trim();
        const appendAccountName = payload.appendAccountName !== false;
        const title = appendAccountName && accountName ? `${baseTitle} ${accountName}` : baseTitle;
        const logLabel = String(payload.logLabel || '事件提醒').trim() || '事件提醒';
        try {
            const targets = global?.channels.filter((entry: { enabled: boolean }) => entry.enabled) || [];
            if (targets.length && title && content) {
                const results = await sendPushChannels(targets, { title, content }, sendPushooMessage);
                for (const result of results) {
                    if (result.ok) log('系统', `${logLabel}发送成功（${result.channel}）: ${accountName || accountId || title}`);
                    else log('错误', `${logLabel}发送失败（${result.channel}）: ${result.msg}`);
                }
                return;
            }
            const channelCfg = resolvePushChannel(accountId);
            if (channelCfg.ok === false) {
                log('错误', channelCfg.reason);
                return;
            }
            if (!title || !content) {
                log('错误', '推送标题或内容为空');
                return;
            }

            const basePayload = {
                channel: channelCfg.channel,
                endpoint: channelCfg.endpoint,
                token: channelCfg.token,
                secret: channelCfg.secret,
                wxPusherUid: channelCfg.wxPusherUid,
                title,
                content,
            };

            let result: any;
            if (channelCfg.channel === 'wxpusher' && typeof sendWxPusherMessage === 'function') {
                result = await sendWxPusherMessage(basePayload);
            } else if (channelCfg.channel === 'wxpusher_wechat' && typeof sendWxPusherWechatMessage === 'function') {
                result = await sendWxPusherWechatMessage(basePayload);
            } else {
                result = await sendPushooMessage(basePayload);
            }

            if (result?.ok) {
                log('系统', `${logLabel}发送成功: ${accountName || accountId || title}`);
            } else {
                log('错误', `${logLabel}发送失败: ${result?.msg || 'unknown'}`);
            }
        } catch (e: any) {
            log('错误', `${logLabel}发送异常: ${e.message}`);
        }
    }

    async function triggerOfflineReminder(payload: OfflineReminderPayload = {}): Promise<void> {
        try {
            const accountId = String(payload.accountId || '').trim();
            const accountName = String(payload.accountName || '').trim();
            const reason = String(payload.reason || 'unknown');
            log('系统', `触发下线提醒: 账号=${accountName || accountId}, 原因=${reason}`, { accountId, accountName, reason });

            const global = store.getPushNotifications?.();
            if (global?.notificationTypes.offline === false) return;
            const useGlobal = global?.channels.some((entry: { enabled: boolean }) => entry.enabled);
            const cfg = useGlobal ? global : store.getOfflineReminder?.(accountId);
            if (!cfg) {
                log('错误', '未找到下线提醒配置');
                return;
            }

            // 标题默认使用当前账号备注（账号名）；内容默认「农场下线」。
            const baseTitle = String(cfg.title || '').trim() || accountName || '农场下线';
            const content = String(cfg.msg || '').trim() || '农场下线';
            if (!baseTitle || !content) {
                log('错误', '下线提醒配置不完整');
                return;
            }

            await sendConfiguredPush({ title: baseTitle, content, accountId, accountName, logLabel: '下线提醒', appendAccountName: false });
        } catch (e: any) {
            log('错误', `下线提醒发送异常: ${e.message}`);
        }
    }

    return { triggerOfflineReminder, sendConfiguredPush };
}

module.exports = { createReloginReminderService };
