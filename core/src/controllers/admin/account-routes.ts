import type { OfflineReminderChannel } from '../../types/config';
import { normalizePushChannel, readPushChannels, singlePushChannel } from '../../config/push-channels';
import type { Application, Request, Response } from 'express';
import type { AdminContext } from './context';
export {};

/**
 * Account CRUD routes, account-logs, logs, and settings routes.
 */

const store = require('../../models/store');
const { pushChannelError, sendPushChannels } = require('../../services/push');
const { addOrUpdateAccount, deleteAccount } = store;
const { findAccountByRef } = require('../../services/account-resolver');
const { updateRuntimeConfig, getRuntimeConfig, getDefaultSystemConfig, getDevicePresets, getTimeZoneOptions } = require('../../config/config');
const wxLoginAdapter = require('../../services/wx-login/adapter');

const {
    getAccId,
    getAccountIds,
    handleApiError,
    getAccountList,
    resolveAccId,
} = require('./middleware');

function mountAccountRoutes(app: Application, ctx: AdminContext): void {

    // API: 账号管理
    app.get('/api/accounts', (req: Request, res: Response) => {
        try {
            const data = ctx.provider.getAccounts();
            res.json({ ok: true, data });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });

    // API: 更新账号备注（兼容旧接口）
    app.post('/api/account/remark', (req: Request, res: Response) => {
        try {
            const body = (req.body && typeof req.body === 'object') ? req.body : {};
            const rawRef = body.id || body.accountId || body.uin || req.headers['x-account-id'];
            const accountList = getAccountList(ctx);
            const target = findAccountByRef(accountList, rawRef);
            if (!target || !target.id) {
                return res.status(404).json({ ok: false, error: 'Account not found' });
            }

            const remark = String(body.remark !== undefined ? body.remark : body.name || '').trim();
            if (!remark) {
                return res.status(400).json({ ok: false, error: 'Missing remark' });
            }

            const accountId = String(target.id);
            const data = addOrUpdateAccount({ id: accountId, name: remark });
            if (ctx.provider && typeof ctx.provider.setRuntimeAccountName === 'function') {
                ctx.provider.setRuntimeAccountName(accountId, remark);
            }
            if (ctx.provider && ctx.provider.addAccountLog) {
                ctx.provider.addAccountLog('update', `更新账号备注: ${remark}`, accountId, remark);
            }
            res.json({ ok: true, data: store.maskWxCredentialsForClient(data) });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });

    app.post('/api/accounts', async (req: Request, res: Response) => {
        try {
            const rawBody = (req.body && typeof req.body === 'object') ? req.body : {};
            const requestedName = typeof rawBody.name === 'string' ? rawBody.name.trim() : '';
            // 微信凭证只能由服务端写入，客户端提交的同名字段先整体丢弃。
            const clientBody = store.stripProtectedWxCredentials(rawBody);
            const body = typeof clientBody.name === 'string' ? { ...clientBody, name: requestedName } : clientBody;
            if (!requestedName) {
                return res.status(400).json({ ok: false, error: '账号备注不能为空' });
            }
            const visibleAccounts = getAccountList(ctx);
            const remarkMatchedAccount = !body.id && requestedName
                ? visibleAccounts.find((account: any) => String(account.name || '').trim() === requestedName)
                : null;
            const isRemarkRelogin = !!remarkMatchedAccount;
            const updateRef = body.id || (remarkMatchedAccount && remarkMatchedAccount.id) || '';
            const isUpdate = !!updateRef;

            const resolvedUpdateId = isUpdate ? resolveAccId(ctx, updateRef) : '';
            const payload: any = isUpdate ? { ...body, id: resolvedUpdateId || String(updateRef) } : { ...body };
            // wxSessionId 只是本次扫码的一次性凭据，不是账号字段，不能落盘。
            const wxSessionId = String(payload.wxSessionId || '').trim();
            delete payload.wxSessionId;

            let wasRunning = false;
            if (isUpdate && ctx.provider.isAccountRunning) {
                wasRunning = ctx.provider.isAccountRunning(payload.id);
            }

            const oldAccount = isUpdate
                ? (ctx.provider.getAccounts().accounts || []).find((a: any) => a.id === String(payload.id))
                : null;

            // 只有携带尚未消费的待绑定扫码会话时才能写入凭证。
            let boundWxInfo: any = null;
            if (wxSessionId && payload.wxid) {
                boundWxInfo = wxLoginAdapter.peekPendingWxInfo(wxSessionId, String(payload.wxid));
                if (!boundWxInfo) {
                    return res.status(400).json({ ok: false, error: '扫码会话已过期，请重新扫码后保存' });
                }
                payload.loginBuffer = boundWxInfo.loginBuffer;
                payload.refreshtoken = boundWxInfo.refreshtoken;
                payload.accesstoken = boundWxInfo.accesstoken;
            } else if (isUpdate && payload.wxid !== undefined && String(oldAccount?.wxid || '') !== String(payload.wxid || '')) {
                // 换绑微信号却没带新会话时，必须清掉旧凭证，否则会用上一个微信号的登录凭据操作该账号。
                payload.loginBuffer = '';
                payload.refreshtoken = '';
                payload.accesstoken = '';
            }

            // 检查是否仅修改了备注信息
            let onlyRemarkChanged = false;
            if (isUpdate && oldAccount) {
                // 检查 payload 中是否只包含 id 和 name 字段
                const payloadKeys = Object.keys(payload);
                const onlyIdAndName = payloadKeys.length === 2 && payloadKeys.includes('id') && payloadKeys.includes('name');
                if (onlyIdAndName) {
                    onlyRemarkChanged = true;
                }
            }

            const data = addOrUpdateAccount(payload);
            if (boundWxInfo) {
                wxLoginAdapter.consumePendingWxInfo(wxSessionId, String(payload.wxid || ''));
            }
            if (ctx.provider.addAccountLog) {
                const accountId = isUpdate ? String(payload.id) : String((data.accounts.at(-1) || {}).id || '');
                const accountName = payload.name || '';
                ctx.provider.addAccountLog(
                    isUpdate ? 'update' : 'add',
                    isRemarkRelogin
                        ? `通过备注重新登录账号: ${accountName || accountId}`
                        : isUpdate ? `更新账号: ${accountName || accountId}` : `添加账号: ${accountName || accountId}`,
                    accountId,
                    accountName
                );
            }
            // 如果是新增，自动启动
            if (!isUpdate) {
                const newAcc = data.accounts.at(-1);
                if (newAcc) {
                    // startAccount 可能是异步取码流程，这里保持原有的不阻塞响应语义，仅记录失败
                    void Promise.resolve(ctx.provider.startAccount(newAcc.id)).catch((error: any) => {
                        if (ctx.provider.addAccountLog) {
                            ctx.provider.addAccountLog('start_error', `账号启动失败: ${error?.message || error}`, String(newAcc.id), newAcc.name || '');
                        }
                    });
                }
            } else if (isRemarkRelogin) {
                // Adding with an existing remark is a relogin operation, including for stopped accounts.
                await ctx.provider.restartAccount(payload.id);
            } else if (wasRunning && !onlyRemarkChanged) {
                // 如果是更新，且之前在运行，且不是仅修改备注，则重启
                await ctx.provider.restartAccount(payload.id);
            }
            res.json({ ok: true, data: store.maskWxCredentialsForClient(data) });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });

    app.delete('/api/accounts/:id', async (req: Request, res: Response) => {
        try {
            const resolvedId = resolveAccId(ctx, req.params.id) || String(req.params.id || '');

            const before = ctx.provider.getAccounts();
            const target = findAccountByRef(before.accounts || [], req.params.id);
            await ctx.provider.stopAccount(resolvedId);
            // 先拆调度再删账号：一旦记录没了，就再也没人能根据 id 找到这个账号的任务了。
            if (ctx.provider && typeof ctx.provider.unscheduleAutoCodeRefresh === 'function') {
                ctx.provider.unscheduleAutoCodeRefresh(resolvedId);
            }
            const data = deleteAccount(resolvedId);
            if (ctx.provider.addAccountLog) {
                ctx.provider.addAccountLog('delete', `删除账号: ${(target && target.name) || req.params.id}`, resolvedId, target ? target.name : '');
            }
            res.json({ ok: true, data: store.maskWxCredentialsForClient(data) });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });

    // API: 账号日志
    app.get('/api/account-logs', (req: Request, res: Response) => {
        try {
            const limit = Number.parseInt(req.query.limit as string) || 100;
            let list: any[] = ctx.provider.getAccountLogs ? ctx.provider.getAccountLogs(limit) : [];
            if (!Array.isArray(list)) list = [];

            // 与当前 web 前端保持一致：直接返回数组
            res.json(list);
        } catch (e: any) {
            handleApiError(res, e);
        }
    });

    // API: 日志
    app.get('/api/logs', (req: Request, res: Response) => {
        const queryAccountIdRaw = (req.query.accountId || '').toString().trim();
        const id = queryAccountIdRaw ? (queryAccountIdRaw === 'all' ? '' : resolveAccId(ctx, queryAccountIdRaw)) : getAccId(ctx, req);
        // 如果没有指定账号ID，获取所有账号的日志
        if (!id) {
            const accountIds = getAccountIds(ctx);
            const allLogs: any[] = [];
            const options = {
                limit: Number.parseInt(req.query.limit as string) || 100,
                tag: req.query.tag || '',
                module: req.query.module || '',
                event: req.query.event || '',
                keyword: req.query.keyword || '',
                isWarn: req.query.isWarn,
                timeFrom: req.query.timeFrom || '',
                timeTo: req.query.timeTo || '',
            };

            for (const accId of accountIds) {
                const logs = ctx.provider.getLogs(accId, options);
                if (Array.isArray(logs)) {
                    allLogs.push(...logs);
                }
            }

            // 按时间排序并限制数量
            allLogs.sort((a: any, b: any) => (b.time || 0) - (a.time || 0));
            const limitedLogs = allLogs.slice(0, options.limit);

            return res.json({ ok: true, data: limitedLogs });
        }

        // 指定了账号ID且通过权限检查，返回该账号的日志
        const options = {
            limit: Number.parseInt(req.query.limit as string) || 100,
            tag: req.query.tag || '',
            module: req.query.module || '',
            event: req.query.event || '',
            keyword: req.query.keyword || '',
            isWarn: req.query.isWarn,
            timeFrom: req.query.timeFrom || '',
            timeTo: req.query.timeTo || '',
        };
        const list = ctx.provider.getLogs(id, options);
        res.json({ ok: true, data: list });
    });

    // API: 清空当前账号运行日志
    app.delete('/api/logs', (req: Request, res: Response) => {
        const id = getAccId(ctx, req);
        if (!id) return res.status(400).json({ ok: false, error: 'Missing x-account-id' });

        try {
            const data = ctx.provider.clearLogs(id);

            if (ctx.io && ctx.provider && typeof ctx.provider.getLogs === 'function') {
                const accountLogs = ctx.provider.getLogs(id, { limit: 100 });
                ctx.io.to(`account:${id}`).emit('logs:snapshot', {
                    accountId: id,
                    logs: Array.isArray(accountLogs) ? accountLogs : [],
                });

                const allLogs = ctx.provider.getLogs('', { limit: 100 });
                ctx.io.to('account:all').emit('logs:snapshot', {
                    accountId: 'all',
                    logs: Array.isArray(allLogs) ? allLogs : [],
                });
            }

            res.json({ ok: true, data });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });

    // API: 设置页统一保存（单次写入；运行中账号等待 worker revision ACK）
    app.post('/api/settings/save', async (req: Request, res: Response) => {
        const id = getAccId(ctx, req);
        if (!id) {
            return res.status(400).json({ ok: false, error: 'Missing x-account-id' });
        }

        try {
            const data = await ctx.provider.saveSettings(id, req.body || {});
            const unconfirmed = data && data.status === 'unconfirmed';
            res.status(unconfirmed ? 202 : 200).json({
                ok: !unconfirmed,
                saved: !!(data && data.saved),
                stopped: !!(data && data.status === 'stopped'),
                confirmed: !!(data && data.confirmed),
                unconfirmed: !!unconfirmed,
                status: data?.status,
                code: unconfirmed ? data.confirmationError?.code : undefined,
                error: unconfirmed ? (data.confirmationError?.message || '配置已保存，但 worker 尚未确认应用') : undefined,
                data: data || {},
            });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });

    // API: 设置面板主题
    app.post('/api/settings/theme', async (req: Request, res: Response) => {
        try {
            const theme = String((req.body || {}).theme || '');
            const data = await ctx.provider.setUITheme(theme);
            res.json({ ok: true, data: data || {} });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });

    // API: 获取通知默认设置
    app.get('/api/settings/offline-reminder/default', (_req: Request, res: Response) => {
        try {
            const def = typeof store.getOfflineReminderDefault === 'function' ? store.getOfflineReminderDefault() : null;
            res.json({ ok: true, data: { exists: !!def, config: def || null } });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });

    // API: 保存通知默认设置
    app.put('/api/settings/offline-reminder/default', async (req: Request, res: Response) => {
        try {
            const body = (req.body && typeof req.body === 'object') ? req.body : {};
            const cfg = (body.config && typeof body.config === 'object') ? body.config : body;
            const data = typeof store.setOfflineReminderDefault === 'function' ? store.setOfflineReminderDefault(cfg) : null;
            res.json({ ok: true, data: { exists: !!data, config: data || null } });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });

    // API: 将通知默认设置应用到当前账号
    app.post('/api/settings/offline-reminder/default/apply', async (req: Request, res: Response) => {
        try {
            const accountId = getAccId(ctx, req);
            if (!accountId) {
                return res.status(400).json({ ok: false, error: '请先选择账号' });
            }
            const data = typeof store.applyOfflineReminderDefault === 'function' ? store.applyOfflineReminderDefault(accountId) : null;
            if (!data) {
                return res.status(400).json({ ok: false, error: '尚未保存通知默认设置' });
            }
            res.json({ ok: true, data });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });

    // API: 保存下线提醒配置（按账号）
    app.post('/api/settings/offline-reminder', async (req: Request, res: Response) => {
        try {
            const accountId = getAccId(ctx, req);
            if (!accountId) {
                return res.status(400).json({ ok: false, error: '请先选择账号' });
            }
            const body = (req.body && typeof req.body === 'object') ? req.body : {};
            const data = store.setOfflineReminder ? store.setOfflineReminder(body, accountId) : {};
            res.json({ ok: true, data: data || {} });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });

    // API: 测试下线提醒推送（不落盘）
    app.post('/api/settings/offline-reminder/test', async (req: Request, res: Response) => {
        try {
            const accountId = getAccId(ctx, req);
            const saved = (accountId && store.getOfflineReminder) ? store.getOfflineReminder(accountId) : {};
            const body = (req.body && typeof req.body === 'object') ? req.body : {};
            const cfg = { ...(saved || {}), ...body };

            const channel = String(cfg.channel || '').trim().toLowerCase();
            const endpoint = String(cfg.endpoint || '').trim();
            const secret = String(cfg.secret || '').trim();
            const credentials = (cfg.channelCredentials && typeof cfg.channelCredentials === 'object') ? cfg.channelCredentials : {};
            const entry = credentials[channel] || {};
            const token = String(entry.token || cfg.token || '').trim();
            const wxPusherUid = String(entry.wxPusherUid || cfg.wxPusherUid || '').trim();
            // 与真实下线推送保持一致：标题取账号备注，不再单独配置。
            const accountName = String((ctx.provider.getAccounts().accounts || [])
                .find((a: any) => String(a?.id) === String(accountId))?.name || '').trim();
            const titleBase = String(cfg.title || '').trim() || accountName || '农场下线';
            const msgBase = String(cfg.msg || '农场下线').trim();

            if (!channel) {
                return res.status(400).json({ ok: false, error: '推送渠道不能为空' });
            }
            if (channel === 'webhook' && !endpoint) {
                return res.status(400).json({ ok: false, error: 'Webhook 渠道需要填写接口地址' });
            }
            if (channel === 'dingtalk' && !endpoint && !token) {
                return res.status(400).json({ ok: false, error: '钉钉渠道需要填写 Webhook 地址' });
            }
            if (channel !== 'webhook' && channel !== 'dingtalk' && !token) {
                return res.status(400).json({ ok: false, error: '当前推送渠道需要填写 Token' });
            }
            if (channel === 'wxpusher_wechat' && !wxPusherUid) {
                return res.status(400).json({ ok: false, error: 'WxPusher 渠道需要填写接收者 UID' });
            }

            const now = new Date();
            const ts = now.toISOString().replace('T', ' ').slice(0, 19);
            const { sendPushooMessage, sendWxPusherMessage, sendWxPusherWechatMessage } = require('../../services/push');
            const payload = {
                channel,
                endpoint,
                token,
                secret,
                wxPusherUid,
                title: `${titleBase}（测试）`,
                content: `${msgBase}\n\n这是一条下线提醒测试消息。\n时间: ${ts}`,
            };
            const ret = channel === 'wxpusher'
                ? await sendWxPusherMessage(payload)
                : channel === 'wxpusher_wechat'
                    ? await sendWxPusherWechatMessage(payload)
                    : await sendPushooMessage(payload);

            if (!ret) {
                return res.status(400).json({ ok: false, error: '推送失败：无返回结果' });
            }

            const isSuccess = ret.ok ||
                ret.code === 'ok' ||
                ret.code === '0' ||
                String(ret.msg || '').includes('成功') ||
                String(ret.raw?.status || '').toLowerCase() === 'success';

            if (!isSuccess && ret.msg && !String(ret.msg).includes('成功')) {
                return res.status(400).json({ ok: false, error: ret.msg || '推送失败', data: ret });
            }
            return res.json({ ok: true, data: ret, message: ret.msg || '推送成功' });
        } catch (e: any) {
            return handleApiError(res, e);
        }
    });

    // API: 获取配置
    app.get('/api/settings/push-notifications', (_req: Request, res: Response) => {
        try {
            res.json({ ok: true, data: store.getPushNotifications() });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });

    function channelListError(entries: unknown): string {
        if (!Array.isArray(entries)) return '推送渠道列表格式无效';
        const seen = new Set<string>();
        for (const raw of entries) {
            if (!raw || typeof raw !== 'object' || typeof raw.enabled !== 'boolean') return '推送渠道配置格式无效';
            const entry = normalizePushChannel(raw);
            if (seen.has(entry.channel)) return '推送渠道重复';
            seen.add(entry.channel);
            const error = pushChannelError(entry, entry.enabled);
            if (error) return error;
        }
        return '';
    }

    app.post('/api/settings/push-notifications', (req: Request, res: Response) => {
        try {
            const body = req.body || {};
            if (Object.hasOwn(body, 'notificationTypes')) {
                const types = body.notificationTypes;
                if (!types || typeof types !== 'object' || Array.isArray(types) || Object.values(types).some(value => typeof value !== 'boolean')) {
                    return res.status(400).json({ ok: false, error: '通知类型的开关值无效' });
                }
            }
            let error = '';
            if (Object.hasOwn(body, 'channels')) {
                error = channelListError(body.channels);
            } else if (Object.hasOwn(body, 'enabled')) {
                if (typeof body.enabled !== 'boolean' || !body.channel) {
                    error = '请指定要修改的渠道和启用状态';
                } else {
                    error = pushChannelError(singlePushChannel(store.getPushNotifications(), body), body.enabled);
                }
            } else if (['channel', 'endpoint', 'token', 'secret'].some(key => Object.hasOwn(body, key))) {
                const saved = store.getPushNotifications();
                const entry = singlePushChannel(saved, body);
                error = pushChannelError(entry, entry.channel !== saved.channel);
            }
            if (error) return res.status(400).json({ ok: false, error });
            res.json({ ok: true, data: store.setPushNotifications(body) });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });

    // 指定渠道时只测试该渠道，草稿参数不写入配置。
    app.post('/api/settings/push-notifications/test', async (req: Request, res: Response) => {
        try {
            const body = req.body || {};
            const saved = store.getPushNotifications();
            const single = ['channel', 'endpoint', 'token', 'secret'].some(key => Object.hasOwn(body, key));
            let targets: OfflineReminderChannel[];
            if (single) {
                const entry = singlePushChannel(saved, body);
                const error = pushChannelError(entry, true);
                if (error) return res.status(400).json({ ok: false, error });
                targets = [entry];
            } else {
                if (Object.hasOwn(body, 'channels')) {
                    const error = channelListError(body.channels);
                    if (error) return res.status(400).json({ ok: false, error });
                }
                targets = readPushChannels(body.channels ? body : saved).filter(entry => entry.enabled);
                if (!targets.length) return res.status(400).json({ ok: false, error: '请先配置并启用推送渠道' });
            }

            const title = String(body.title ?? saved.title ?? '').trim() || '账号下线提醒';
            const msg = String(body.msg ?? saved.msg ?? '').trim() || '账号下线';
            const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
            const results = await sendPushChannels(targets, { title: `${title}（测试）`, content: `${msg}\n\n这是一条通知测试消息。\n时间: ${ts}` });
            if (single) {
                const [result] = results;
                return result.ok
                    ? res.json({ ok: true, data: result, message: result.msg })
                    : res.status(400).json({ ok: false, error: result.msg, data: result });
            }
            const data = results.map(({ channel, ok, msg }) => ({ channel, ok, msg }));
            const sent = data.filter(result => result.ok).length;
            if (!sent) return res.status(400).json({ ok: false, error: data.map(r => `${r.channel}: ${r.msg}`).join('；'), data });
            return res.json({ ok: true, message: `测试完成，${sent}/${data.length} 个渠道成功`, data });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });

    app.get('/api/settings', async (req: Request, res: Response) => {
        try {
            const id = getAccId(ctx, req);
            // 直接从主进程的 store 读取，确保即使账号未运行也能获取配置
            const intervals = id ? store.getIntervals(id) : {};
            const strategy = id ? store.getPlantingStrategy(id) : null;
            const preferredSeed = id ? store.getPreferredSeed(id) : null;
            const friendQuietHours = id ? store.getFriendQuietHours(id) : null;
            const automation = id ? store.getSavedAutomation(id) : {};
            const stealDelaySeconds = id && (typeof store.getStealDelaySeconds === 'function') ? store.getStealDelaySeconds(id) : 0;
            const plantDelaySeconds = id && (typeof store.getPlantDelaySeconds === 'function') ? store.getPlantDelaySeconds(id) : 0;
            const fertilizerBuyOrganicCount = id && (typeof store.getFertilizerBuyOrganicCount === 'function') ? store.getFertilizerBuyOrganicCount(id) : 0;
            const fertilizerBuyOrganicThresholdHours = id && (typeof store.getFertilizerBuyOrganicThresholdHours === 'function') ? store.getFertilizerBuyOrganicThresholdHours(id) : 10;
            const fertilizerBuyNormalCount = id && (typeof store.getFertilizerBuyNormalCount === 'function') ? store.getFertilizerBuyNormalCount(id) : 0;
            const fertilizerBuyNormalThresholdHours = id && (typeof store.getFertilizerBuyNormalThresholdHours === 'function') ? store.getFertilizerBuyNormalThresholdHours(id) : 10;
            const fertilizerBuyCheckIntervalMinutes = id && (typeof store.getFertilizerBuyCheckIntervalMinutes === 'function') ? store.getFertilizerBuyCheckIntervalMinutes(id) : 30;
            const fertilizerBuyNormalCheckIntervalMinutes = id && typeof store.getFertilizerBuyNormalCheckIntervalMinutes === 'function'
                ? store.getFertilizerBuyNormalCheckIntervalMinutes(id) : fertilizerBuyCheckIntervalMinutes;
            const bagSeedPriority = id && (typeof store.getBagSeedPriority === 'function') ? store.getBagSeedPriority(id) : [];
            const bagSeedMultiLandReservationEnabled = id && (typeof store.getBagSeedMultiLandReservationEnabled === 'function') ? store.getBagSeedMultiLandReservationEnabled(id) : false;
            const bagSeedLandTypes = id && (typeof store.getBagSeedLandTypes === 'function') ? store.getBagSeedLandTypes(id) : {};
            const bagSeedFallbackStrategy = id && (typeof store.getBagSeedFallbackStrategy === 'function') ? store.getBagSeedFallbackStrategy(id) : 'level';
            const autoAcceptFriendMinLevel = id && (typeof store.getAutoAcceptFriendMinLevel === 'function') ? store.getAutoAcceptFriendMinLevel(id) : 0;
            const autoAcceptRequireOwnLevel = id && (typeof store.getAutoAcceptRequireOwnLevel === 'function') ? store.getAutoAcceptRequireOwnLevel(id) : false;
            const ui = store.getUI();
            const offlineReminder = (id && store.getOfflineReminder)
                ? store.getOfflineReminder(id)
                : (store.getOfflineReminderDefault ? store.getOfflineReminderDefault() : null)
                    || { channel: 'wxpusher', endpoint: '', token: '', secret: '', wxPusherUid: '', channelCredentials: {}, title: '', msg: '农场下线' };
            res.json({ ok: true, data: { intervals, strategy, preferredSeed, friendQuietHours, automation, stealDelaySeconds, plantDelaySeconds, fertilizerBuyOrganicCount, fertilizerBuyOrganicThresholdHours, fertilizerBuyNormalCount, fertilizerBuyNormalThresholdHours, fertilizerBuyCheckIntervalMinutes, fertilizerBuyNormalCheckIntervalMinutes, bagSeedPriority, bagSeedMultiLandReservationEnabled, bagSeedLandTypes, bagSeedFallbackStrategy, autoAcceptFriendMinLevel, autoAcceptRequireOwnLevel, ui, offlineReminder } });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });

    // API: 获取默认配置
    app.get('/api/settings/default', (_req: Request, res: Response) => {
        try {
            const defaultConfig = store.getDefaultAccountConfig ? store.getDefaultAccountConfig() : null;
            if (!defaultConfig) {
                return res.status(500).json({ ok: false, error: '无法获取默认配置' });
            }
            res.json({ ok: true, data: defaultConfig });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });

    // API: 默认方案（单用户全局一份，跨账号复用策略/自动化）
    app.get('/api/settings/default-plan', (_req: Request, res: Response) => {
        try {
            res.json({ ok: true, data: store.getDefaultPlan() });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });

    app.put('/api/settings/default-plan', (req: Request, res: Response) => {
        try {
            const body = (req.body && typeof req.body === 'object') ? req.body : {};
            const data = store.setDefaultPlan(body.config || {}, { enabled: body.enabled !== false });
            res.json({ ok: true, data });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });

    // 将指定账号的当前配置设为默认方案
    app.post('/api/settings/default-plan/import', (req: Request, res: Response) => {
        const id = getAccId(ctx, req);
        if (!id) {
            return res.status(400).json({ ok: false, error: 'Missing x-account-id' });
        }
        try {
            const data = store.importDefaultPlanFromAccount(id);
            res.json({ ok: true, data });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });

    // 将默认方案应用到指定账号，并同步到运行中的 worker
    app.post('/api/settings/default-plan/apply', async (req: Request, res: Response) => {
        const id = getAccId(ctx, req);
        if (!id) {
            return res.status(400).json({ ok: false, error: 'Missing x-account-id' });
        }
        try {
            const data = store.applyDefaultPlan(id);
            if (ctx.provider && typeof ctx.provider.broadcastConfig === 'function') {
                ctx.provider.broadcastConfig(id);
            }
            res.json({ ok: true, data });
        } catch (e: any) {
            const status = e?.message === '尚未保存默认方案' ? 400 : 500;
            res.status(status).json({ ok: false, error: e?.message || '应用默认方案失败' });
        }
    });

    // 将默认方案重置为出厂默认配置
    app.post('/api/settings/default-plan/reset', (_req: Request, res: Response) => {
        try {
            const data = store.resetDefaultPlan();
            res.json({ ok: true, data });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });

    // API: 微信 code 定时刷新与自动重登设置（全局，对所有账号生效）
    app.get('/api/settings/auto-code-refresh', (_req: Request, res: Response) => {
        try {
            res.json({ ok: true, data: store.getAutoCodeRefresh() });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });

    app.post('/api/settings/auto-code-refresh', async (req: Request, res: Response) => {
        try {
            const result = await ctx.provider.saveAutoCodeRefresh(req.body || {});
            const data = result && result.autoCodeRefresh ? result.autoCodeRefresh : result;
            res.json({ ok: true, data: data || {} });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });

    app.post('/api/settings/auto-code-refresh/run', async (req: Request, res: Response) => {
        const id = getAccId(ctx, req);
        if (!id) return res.status(400).json({ ok: false, error: 'Missing x-account-id' });
        try {
            const data = await ctx.provider.refreshAccountCode(id);
            res.json({ ok: true, data: data || {} });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });

    app.get('/api/settings/device-presets', (_req: Request, res: Response) => {
        try {
            res.json({ ok: true, data: getDevicePresets() });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });

    app.get('/api/settings/system-config', (_req: Request, res: Response) => {
        try {
            res.json({
                ok: true,
                data: {
                    saved: store.getSystemConfig(),
                    default: getDefaultSystemConfig(),
                    current: getRuntimeConfig(),
                    timeZones: getTimeZoneOptions(),
                    loginSettings: store.getLoginSettings
                        ? store.getLoginSettings()
                        : { wechatQrLogin: true, qqQrLogin: false, napCatEndpoint: '', napCatSignature: '' },
                },
            });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });

    app.get('/api/settings/login-config', (_req: Request, res: Response) => {
        try {
            const loginSettings = store.getLoginSettings
                ? store.getLoginSettings()
                : { wechatQrLogin: true, qqQrLogin: false, napCatEndpoint: '', napCatSignature: '' };
            res.json({ ok: true, data: loginSettings });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });

    app.post('/api/settings/login-config', (req: Request, res: Response) => {
        try {
            const body = (req.body && typeof req.body === 'object') ? req.body : {};
            const loginSettings = store.setLoginSettings
                ? store.setLoginSettings({
                    wechatQrLogin: body.wechatQrLogin,
                    qqQrLogin: body.qqQrLogin,
                    napCatEndpoint: body.napCatEndpoint,
                    napCatSignature: body.napCatSignature,
                })
                : { wechatQrLogin: true, qqQrLogin: false, napCatEndpoint: '', napCatSignature: '' };
            res.json({ ok: true, data: loginSettings });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });

    app.post('/api/settings/system-config', (req: Request, res: Response) => {
        try {
            const { serverUrl, clientVersion, wxClientVersion, platform, os, timeZone, deviceInfo } = req.body || {};
            const saved = store.setSystemConfig({ serverUrl, clientVersion, wxClientVersion, platform, os, timeZone, deviceInfo });
            updateRuntimeConfig(saved);
            if (ctx.provider && typeof ctx.provider.broadcastConfig === 'function') {
                ctx.provider.broadcastConfig('');
            }
            // Keep live sessions intact. A new login must use a fresh one-time Code.
            res.json({ ok: true, data: { saved, current: getRuntimeConfig() } });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });

    app.post('/api/settings/system-config/reset', (_req: Request, res: Response) => {
        try {
            const saved = getDefaultSystemConfig();
            store.setSystemConfig(saved);
            updateRuntimeConfig(saved);
            if (ctx.provider && typeof ctx.provider.broadcastConfig === 'function') {
                ctx.provider.broadcastConfig('');
            }
            // Keep live sessions intact. A new login must use a fresh one-time Code.
            res.json({ ok: true, data: { saved, current: getRuntimeConfig() } });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });
}

module.exports = { mountAccountRoutes };
