import type { AutoCodeRefreshConfig, CaptureSettings, GlobalConfig, LoginSettings, OfflineReminder, SystemConfig, UIConfig } from '../../types/config';
export {};

const { DEFAULT_CLIENT_VERSION, DEFAULT_WX_CLIENT_VERSION, DEFAULT_TIME_ZONE, normalizeTimeZone, resolveClientVersionUpdatedAt } = require('../../config/config');

const sharedState = require('./shared-state');

const {
    PUSHOO_CHANNELS,
    OFFLINE_PUSH_CHANNELS,
    defaultChannelCredentials,
    DEFAULT_OFFLINE_REMINDER,
    DEFAULT_LOGIN_SETTINGS,
    DEFAULT_CAPTURE_SETTINGS,
    DEFAULT_AUTO_CODE_REFRESH,
    globalConfig,
    normalizeAccountConfig,
    cloneAccountConfig,
    DEFAULT_ACCOUNT_CONFIG,
} = sharedState;

function normalizeOfflineReminder(input: unknown): OfflineReminder {
    const src: Record<string, any> = (input && typeof input === 'object') ? input as Record<string, any> : {};
    const rawChannel = (src.channel !== undefined && src.channel !== null)
        ? String(src.channel).trim().toLowerCase()
        : '';
    const channelSet = new Set(OFFLINE_PUSH_CHANNELS);
    const endpoint = (src.endpoint !== undefined && src.endpoint !== null)
        ? String(src.endpoint).trim()
        : DEFAULT_OFFLINE_REMINDER.endpoint;
    const migratedChannel = rawChannel
        || (PUSHOO_CHANNELS.has(String(endpoint || '').trim().toLowerCase())
            ? String(endpoint || '').trim().toLowerCase()
            : DEFAULT_OFFLINE_REMINDER.channel);
    const channel = channelSet.has(migratedChannel)
        ? migratedChannel
        : DEFAULT_OFFLINE_REMINDER.channel;
    const token = (src.token !== undefined && src.token !== null)
        ? String(src.token).trim()
        : DEFAULT_OFFLINE_REMINDER.token;
    const secret = (src.secret !== undefined && src.secret !== null)
        ? String(src.secret).trim()
        : DEFAULT_OFFLINE_REMINDER.secret;
    const title = (src.title !== undefined && src.title !== null)
        ? String(src.title).trim()
        : DEFAULT_OFFLINE_REMINDER.title;
    const msg = (src.msg !== undefined && src.msg !== null)
        ? String(src.msg).trim()
        : DEFAULT_OFFLINE_REMINDER.msg;
    const wxPusherUid = (src.wxPusherUid !== undefined && src.wxPusherUid !== null)
        ? String(src.wxPusherUid).trim()
        : DEFAULT_OFFLINE_REMINDER.wxPusherUid;
    // 分渠道凭据：以 4 个支持的渠道为固定键，叠加已有数据；
    // 旧版若已配置 token/wxPusherUid 且对应渠道尚未填写，则作为该渠道凭据迁移。
    const credentialsInput = (src.channelCredentials && typeof src.channelCredentials === 'object')
        ? src.channelCredentials as Record<string, any>
        : {};
    const channelCredentials = defaultChannelCredentials();
    for (const key of OFFLINE_PUSH_CHANNELS) {
        const entry = credentialsInput[key];
        if (entry && typeof entry === 'object') {
            channelCredentials[key] = {
                token: String(entry.token ?? '').trim(),
                wxPusherUid: String(entry.wxPusherUid ?? '').trim(),
            };
        }
        if (!channelCredentials[key]!.token && key === channel) {
            channelCredentials[key]!.token = token;
        }
        if (!channelCredentials[key]!.wxPusherUid && key === channel) {
            channelCredentials[key]!.wxPusherUid = wxPusherUid;
        }
    }
    return {
        channel,
        endpoint,
        token,
        secret,
        wxPusherUid,
        channelCredentials,
        title,
        msg,
    };
}

function saveGlobalConfig(changes: Partial<GlobalConfig> = {}): void {
    const next = { ...globalConfig, ...changes };
    const fallback = normalizeAccountConfig(next.defaultAccountConfig, DEFAULT_ACCOUNT_CONFIG);
    next.defaultAccountConfig = cloneAccountConfig(fallback);
    // Publish memory only after persistence succeeds. Account documents have their
    // own write path, so a global setting never scans or serializes all accounts.
    sharedState.configStorage.saveGlobal(next);
    Object.assign(globalConfig, next);
    sharedState.accountFallbackConfig = fallback;
}

function getUI(): UIConfig {
    return { ...globalConfig.ui };
}

function setUITheme(theme: unknown): UIConfig {
    const t = String(theme || '').toLowerCase();
    const next: UIConfig['theme'] = (t === 'light') ? 'light' : 'dark';
    saveGlobalConfig({ ui: { ...globalConfig.ui, theme: next } });
    return getUI();
}

function getOfflineReminder(accountId: string): OfflineReminder {
    const id = String(accountId || '').trim();
    if (!id)
        return normalizeOfflineReminder({});
    const stored = globalConfig.accountOfflineReminders
        ? globalConfig.accountOfflineReminders[id]
        : undefined;
    return normalizeOfflineReminder(stored || {});
}

function normalizeLoginSettings(input: unknown): LoginSettings {
    const src: Record<string, any> = (input && typeof input === 'object') ? input as Record<string, any> : {};
    return {
        wechatQrLogin: typeof src.wechatQrLogin === 'boolean' ? src.wechatQrLogin : DEFAULT_LOGIN_SETTINGS.wechatQrLogin,
        qqQrLogin: typeof src.qqQrLogin === 'boolean' ? src.qqQrLogin : DEFAULT_LOGIN_SETTINGS.qqQrLogin,
        napCatEndpoint: typeof src.napCatEndpoint === 'string' ? src.napCatEndpoint.trim() : DEFAULT_LOGIN_SETTINGS.napCatEndpoint,
        napCatSignature: typeof src.napCatSignature === 'string' ? src.napCatSignature.trim() : DEFAULT_LOGIN_SETTINGS.napCatSignature,
    };
}

function getLoginSettings(): LoginSettings {
    return normalizeLoginSettings(globalConfig.loginSettings);
}

function setLoginSettings(cfg: Partial<LoginSettings> | undefined): LoginSettings {
    const next = normalizeLoginSettings({ ...getLoginSettings(), ...(cfg || {}) });
    if (next.qqQrLogin && (!next.napCatEndpoint || !next.napCatSignature)) {
        throw new Error('开启 QQ 扫码登录前，请配置 NapCat 接口地址和接口签名');
    }
    saveGlobalConfig({ loginSettings: next });
    return getLoginSettings();
}

function normalizeAutoCodeRefresh(input: unknown): AutoCodeRefreshConfig {
    const src: Record<string, any> = (input && typeof input === 'object') ? input as Record<string, any> : {};
    const intervalMinutes = Number(src.intervalMinutes);
    const maxRetries = Number(src.maxRetries);
    return {
        enabled: src.enabled !== false,
        intervalMinutes: Math.max(1, Math.min(1440, Number.isFinite(intervalMinutes)
            ? Math.round(intervalMinutes)
            : DEFAULT_AUTO_CODE_REFRESH.intervalMinutes)),
        maxRetries: Math.max(1, Math.min(100, Number.isFinite(maxRetries)
            ? Math.round(maxRetries)
            : DEFAULT_AUTO_CODE_REFRESH.maxRetries)),
    };
}

function getAutoCodeRefresh(): AutoCodeRefreshConfig {
    return normalizeAutoCodeRefresh(globalConfig.autoCodeRefresh);
}

function setAutoCodeRefresh(cfg: Partial<AutoCodeRefreshConfig> | undefined): AutoCodeRefreshConfig {
    const next = normalizeAutoCodeRefresh({ ...getAutoCodeRefresh(), ...(cfg || {}) });
    saveGlobalConfig({ autoCodeRefresh: next });
    return getAutoCodeRefresh();
}

function normalizeCaptureSettings(input: unknown): CaptureSettings {
    const src: Record<string, any> = (input && typeof input === 'object') ? input as Record<string, any> : {};
    return {
        enabled: typeof src.enabled === 'boolean' ? src.enabled : DEFAULT_CAPTURE_SETTINGS.enabled,
        autoImportQqGids: typeof src.autoImportQqGids === 'boolean'
            ? src.autoImportQqGids
            : DEFAULT_CAPTURE_SETTINGS.autoImportQqGids,
    };
}

function getCaptureSettings(): CaptureSettings {
    return normalizeCaptureSettings(globalConfig.captureSettings);
}

function setCaptureSettings(cfg: Partial<CaptureSettings> | undefined): CaptureSettings {
    const next = normalizeCaptureSettings({ ...getCaptureSettings(), ...(cfg || {}) });
    saveGlobalConfig({ captureSettings: next });
    return getCaptureSettings();
}

function setOfflineReminder(cfg: Partial<OfflineReminder> | undefined, accountId: string): OfflineReminder {
    const id = String(accountId || '').trim();
    if (!id)
        throw new Error('下线提醒必须关联当前账号');
    if (!globalConfig.accountOfflineReminders)
        globalConfig.accountOfflineReminders = {};
    const current = normalizeOfflineReminder(globalConfig.accountOfflineReminders[id] || {});
    const next = normalizeOfflineReminder({ ...current, ...(cfg || {}) });
    saveGlobalConfig({
        accountOfflineReminders: {
            ...globalConfig.accountOfflineReminders,
            [id]: next,
        },
    });
    return getOfflineReminder(id);
}

function getOfflineReminderDefault(): OfflineReminder | null {
    return globalConfig.offlineReminderDefault
        ? normalizeOfflineReminder(globalConfig.offlineReminderDefault)
        : null;
}

function setOfflineReminderDefault(cfg: Partial<OfflineReminder> | undefined): OfflineReminder {
    const next = normalizeOfflineReminder(cfg || {});
    saveGlobalConfig({ offlineReminderDefault: next });
    return getOfflineReminderDefault()!;
}

function applyOfflineReminderDefault(accountId: string): OfflineReminder | null {
    const def = getOfflineReminderDefault();
    if (!def)
        return null;
    return setOfflineReminder(def, accountId);
}

function getSystemConfig(): SystemConfig | null {
    return globalConfig.systemConfig ? { ...globalConfig.systemConfig } : null;
}

function setSystemConfig(config: Partial<SystemConfig> | undefined): SystemConfig | null {
    if (!config || typeof config !== 'object') return null;
    const DEFAULT_DEVICE_INFO = {
        os: 'Windows',
        clientVersion: DEFAULT_CLIENT_VERSION,
        sysSoftware: 'Windows',
        network: 'wifi',
        memory: '16384',
        deviceId: 'DESKTOP-PC<WPC>',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 MicroMessenger/7.0.20.1781(0x6700143B) NetType/WIFI MiniProgramEnv/Windows WindowsWechat/WMPF WindowsWechat(0x63090a13)',
    };
    const current = globalConfig.systemConfig;
    const srcDevice = {
        ...(current?.deviceInfo || {}),
        ...((config.deviceInfo && typeof config.deviceInfo === 'object') ? config.deviceInfo : {}),
    };
    const topVersion = String(config.clientVersion || '').trim();
    const deviceVersion = String(config.deviceInfo?.clientVersion || '').trim();
    const requestedVersion = deviceVersion || topVersion || current?.clientVersion;
    const clientVersion = requestedVersion || DEFAULT_DEVICE_INFO.clientVersion;
    const currentVersion = String(globalConfig.systemConfig?.clientVersion || DEFAULT_DEVICE_INFO.clientVersion).trim();
    const currentUpdatedAt = Number(globalConfig.systemConfig?.clientVersionUpdatedAt);
    const clientVersionUpdatedAt = resolveClientVersionUpdatedAt(
        clientVersion,
        currentVersion,
        currentUpdatedAt,
        config.clientVersionUpdatedAt,
    );
    // Older API clients may omit the new field; never copy the QQ version into it.
    const currentWxVersion = globalConfig.systemConfig?.wxClientVersion || DEFAULT_WX_CLIENT_VERSION;
    const wxClientVersion = config.wxClientVersion === undefined
        ? currentWxVersion : (String(config.wxClientVersion || '').trim() || DEFAULT_WX_CLIENT_VERSION);
    const wxClientVersionUpdatedAt = resolveClientVersionUpdatedAt(
        wxClientVersion, currentWxVersion, globalConfig.systemConfig?.wxClientVersionUpdatedAt,
        config.wxClientVersionUpdatedAt, Date.now(), 'wx',
    );
    const deviceInfo = {
        os: String((srcDevice as any).os || DEFAULT_DEVICE_INFO.os).trim(),
        clientVersion,
        sysSoftware: String((srcDevice as any).sysSoftware || DEFAULT_DEVICE_INFO.sysSoftware).trim(),
        network: String((srcDevice as any).network || DEFAULT_DEVICE_INFO.network).trim(),
        memory: String((srcDevice as any).memory || DEFAULT_DEVICE_INFO.memory).trim(),
        deviceId: String((srcDevice as any).deviceId || DEFAULT_DEVICE_INFO.deviceId).trim(),
        userAgent: String((srcDevice as any).userAgent || DEFAULT_DEVICE_INFO.userAgent).trim(),
    };
    const next: SystemConfig = {
        serverUrl: String(config.serverUrl ?? current?.serverUrl ?? '').trim(),
        clientVersion: deviceInfo.clientVersion,
        clientVersionUpdatedAt,
        wxClientVersion,
        wxClientVersionUpdatedAt,
        platform: String(config.platform || current?.platform || 'qq').trim(),
        os: deviceInfo.os,
        timeZone: normalizeTimeZone(config.timeZone || current?.timeZone || DEFAULT_TIME_ZONE),
        deviceInfo,
    };
    saveGlobalConfig({ systemConfig: next });
    return { ...globalConfig.systemConfig };
}

// Initialize on load
const { loadGlobalConfig } = sharedState;
loadGlobalConfig();
// Apply offlineReminder normalization after load
{
    const raw = (globalConfig as any).accountOfflineReminders;
    const normalized: Record<string, OfflineReminder> = {};
    if (raw && typeof raw === 'object') {
        for (const key of Object.keys(raw)) {
            normalized[key] = normalizeOfflineReminder(raw[key]);
        }
    }
    // 迁移旧版全局 offlineReminder（若已有数据）到 _default 但仍保留为模板字段。
    const legacy = (globalConfig as any).offlineReminder;
    if (legacy && typeof legacy === 'object') {
        if (!globalConfig.offlineReminderDefault)
            globalConfig.offlineReminderDefault = normalizeOfflineReminder(legacy);
        delete (globalConfig as any).offlineReminder;
    }
    globalConfig.accountOfflineReminders = normalized;
}
globalConfig.loginSettings = normalizeLoginSettings(globalConfig.loginSettings);
globalConfig.captureSettings = normalizeCaptureSettings(globalConfig.captureSettings);
globalConfig.autoCodeRefresh = normalizeAutoCodeRefresh(globalConfig.autoCodeRefresh);
if (sharedState.systemConfigMigrated && !process.env.FARM_ACCOUNT_ID) {
    saveGlobalConfig();
    sharedState.systemConfigMigrated = false;
}

module.exports = {
    saveGlobalConfig,
    getUI,
    setUITheme,
    getLoginSettings,
    setLoginSettings,
    getCaptureSettings,
    setCaptureSettings,
    normalizeCaptureSettings,
    getAutoCodeRefresh,
    setAutoCodeRefresh,
    normalizeAutoCodeRefresh,
    getOfflineReminder,
    setOfflineReminder,
    getOfflineReminderDefault,
    setOfflineReminderDefault,
    applyOfflineReminderDefault,
    getSystemConfig,
    setSystemConfig,
};
