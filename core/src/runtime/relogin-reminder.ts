import type { PushNotification } from '../config/notification-types';
import type { OfflineReminder } from '../types/config';
import { normalizeNotificationTypes } from '../config/notification-types';

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
    function resolvePushChannel(cfg: OfflineReminder | undefined):
        | { ok: true; channel: string; token: string; wxPusherUid: string; endpoint: string; secret: string }
        | { ok: false; reason: string } {
        if (!cfg) return { ok: false, reason: '未找到账号推送通知配置' };

        const channel = String(cfg.channel || '').trim().toLowerCase();
        if (!channel) return { ok: false, reason: '账号推送通知配置不完整' };

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
        if (channel !== 'webhook' && channel !== 'dingtalk' && !token) return { ok: false, reason: '账号推送渠道未设置 Token' };
        if (channel === 'wxpusher_wechat' && !wxPusherUid) return { ok: false, reason: 'WxPusher 渠道未设置接收者 UID' };
        return { ok: true, channel, token, wxPusherUid, endpoint, secret };
    }

    async function sendConfiguredPush(payload: { candidates?: PushNotification[]; title?: string; content?: string; accountId?: string; accountName?: string; logLabel?: string; appendAccountName?: boolean } = {}): Promise<void> {
        const accountId = String(payload.accountId || '').trim();
        const accountName = String(payload.accountName || '').trim();
        const account = store.getOfflineReminder?.(accountId);
        const enabled = normalizeNotificationTypes(account?.notificationTypes);
        const notification = payload.candidates ? payload.candidates.find(item => enabled[item.type]) : payload;
        if (!notification) return;
        const baseTitle = String(notification.title || '').trim();
        const custom = 'type' in notification && notification.type !== 'offline'
            ? account?.mysteryMessages?.[notification.type] : '';
        const content = String(notification.content || '').trim();
        const appendAccountName = payload.appendAccountName !== false;
        const title = [appendAccountName && accountName ? `${baseTitle} ${accountName}` : baseTitle, String(custom || '').trim()].filter(Boolean).join(' ');
        const logLabel = String(payload.logLabel || '事件提醒').trim() || '事件提醒';
        try {
            const channelCfg = resolvePushChannel(account);
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

            const cfg: OfflineReminder | undefined = store.getOfflineReminder?.(accountId);
            if (cfg?.notificationTypes?.offline === false) return;
            if (!cfg) {
                log('错误', '未找到下线提醒配置');
                return;
            }

            // 内容栏作为标题后缀，正文保留下线事件说明。
            const baseTitle = [String(cfg.title || '').trim() || accountName || '农场下线', String(cfg.msg || '').trim()].filter(Boolean).join(' ');
            const content = '农场下线';
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
