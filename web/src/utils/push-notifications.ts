export interface PushChannelOption {
  label: string
  value: string
  docUrl: string
}

export const PUSH_CHANNEL_OPTIONS: PushChannelOption[] = [
  { label: 'Webhook(自定义接口)', value: 'webhook', docUrl: '' },
  { label: 'Qmsg 酱', value: 'qmsg', docUrl: 'https://qmsg.zendee.cn/' },
  { label: 'Server 酱', value: 'serverchan', docUrl: 'https://sct.ftqq.com/' },
  { label: 'Push Plus', value: 'pushplus', docUrl: 'https://www.pushplus.plus/' },
  { label: 'Push Plus Hxtrip', value: 'pushplushxtrip', docUrl: 'https://pushplus.hxtrip.com/' },
  { label: '钉钉', value: 'dingtalk', docUrl: 'https://open.dingtalk.com/document/orgapp/customize-robot-security-settings' },
  { label: '企业微信', value: 'wecom', docUrl: 'https://guole.fun/posts/626/' },
  { label: 'Bark', value: 'bark', docUrl: 'https://github.com/Finb/Bark' },
  { label: 'Go-cqhttp', value: 'gocqhttp', docUrl: 'https://docs.go-cqhttp.org/api/' },
  { label: 'OneBot', value: 'onebot', docUrl: 'https://docs.go-cqhttp.org/api/' },
  { label: 'Atri', value: 'atri', docUrl: 'https://blog.tianli0.top/' },
  { label: 'PushDeer', value: 'pushdeer', docUrl: 'https://www.pushdeer.com/' },
  { label: 'iGot', value: 'igot', docUrl: 'https://push.hellyw.com/' },
  { label: 'Telegram', value: 'telegram', docUrl: 'https://core.telegram.org/bots' },
  { label: '飞书', value: 'feishu', docUrl: 'https://www.feishu.cn/hc/zh-CN/articles/360024984973' },
  { label: 'IFTTT', value: 'ifttt', docUrl: 'https://ifttt.com/maker_webhooks' },
  { label: '企业微信群机器人', value: 'wecombot', docUrl: 'https://developer.work.weixin.qq.com/document/path/91770' },
  { label: 'Discord', value: 'discord', docUrl: 'https://discord.com/developers/docs/resources/webhook#execute-webhook' },
  { label: 'WxPusher', value: 'wxpusher', docUrl: 'https://wxpusher.zjiecode.com/docs/#/' },
  { label: 'MeoW', value: 'meow', docUrl: 'https://www.chuckfang.com/MeoW/api_doc.html' },
]

export interface OfflineChannelConfig {
  channel: string
  enabled: boolean
  endpoint: string
  token: string
  secret: string
}

export type PushChannelChange = Pick<OfflineChannelConfig, 'channel' | 'enabled'> & Partial<OfflineChannelConfig>

export interface PushSettings {
  notificationTypes: {
    offline: boolean
    mysteryArrival: boolean
    mysteryPurchase: boolean
  }
  channel: string
  endpoint: string
  token: string
  secret: string
  channels: OfflineChannelConfig[]
  title: string
  msg: string
}

const VALID_PUSH_CHANNELS = new Set(PUSH_CHANNEL_OPTIONS.map(item => item.value))

export function getPushChannelLabel(channel: string): string {
  const key = String(channel || '').trim().toLowerCase()
  return PUSH_CHANNEL_OPTIONS.find(item => item.value === key)?.label || key || '未知渠道'
}

export function getPushChannelDocUrl(channel: string): string {
  const key = String(channel || '').trim().toLowerCase()
  return PUSH_CHANNEL_OPTIONS.find(item => item.value === key)?.docUrl || ''
}

export function isPushChannelConfigured(input?: Partial<OfflineChannelConfig>): boolean {
  if (!input)
    return false
  const channel = String(input.channel || '').trim().toLowerCase()
  if (!VALID_PUSH_CHANNELS.has(channel))
    return false
  const endpoint = String(input.endpoint || '').trim()
  const token = String(input.token || '').trim()
  if (channel === 'webhook')
    return endpoint.length > 0
  if (channel === 'dingtalk')
    return endpoint.length > 0 || token.length > 0
  return token.length > 0
}

export function validateDingTalkWebhook(endpointInput: string): string {
  const endpoint = String(endpointInput || '').trim()
  if (!endpoint)
    return '请填写钉钉机器人设置页提供的完整 Webhook 地址'
  try {
    const url = new URL(endpoint)
    const isOfficialWebhook = url.protocol === 'https:'
      && url.hostname.toLowerCase() === 'oapi.dingtalk.com'
      && url.pathname === '/robot/send'
      && !!url.searchParams.get('access_token')
    if (!isOfficialWebhook)
      return '钉钉 Webhook 地址格式不正确，请从群机器人设置页重新复制'
  }
  catch {
    return '钉钉 Webhook 地址格式不正确，请从群机器人设置页重新复制'
  }
  return ''
}

export function normalizeChannelEntry(raw: Partial<OfflineChannelConfig> | null | undefined): OfflineChannelConfig | null {
  if (!raw || typeof raw !== 'object')
    return null
  const channel = String(raw.channel || '').trim().toLowerCase()
  if (!VALID_PUSH_CHANNELS.has(channel))
    return null
  let endpoint = String(raw.endpoint || '').trim()
  let token = String(raw.token || '').trim()
  const secret = String(raw.secret || '').trim()

  if (channel === 'dingtalk') {
    if (!endpoint && token) {
      endpoint = /^https?:\/\//i.test(token)
        ? token
        : `https://oapi.dingtalk.com/robot/send?access_token=${encodeURIComponent(token)}`
    }
    token = ''
  }

  const configured = isPushChannelConfigured({ channel, endpoint, token })
  if (!configured && !endpoint && !token && !secret)
    return null

  return {
    channel,
    enabled: raw.enabled === true && configured,
    endpoint,
    token,
    secret,
  }
}

export function normalizePushSettings(config?: Partial<PushSettings>): PushSettings {
  const rawChannel = String(config?.channel || 'webhook').trim().toLowerCase()
  let channel = VALID_PUSH_CHANNELS.has(rawChannel) ? rawChannel : 'webhook'
  let endpoint = String(config?.endpoint ?? '').trim()
  let token = String(config?.token ?? '').trim()
  let secret = String(config?.secret ?? '').trim()

  const hasExplicitChannels = Array.isArray(config?.channels)
  const channels: OfflineChannelConfig[] = []
  if (hasExplicitChannels) {
    const map = new Map<string, OfflineChannelConfig>()
    for (const item of config!.channels!) {
      const normalized = normalizeChannelEntry(item)
      if (!normalized)
        continue
      if (map.has(normalized.channel))
        map.delete(normalized.channel)
      map.set(normalized.channel, normalized)
    }
    channels.push(...map.values())
  }
  else {
    const migrated = normalizeChannelEntry({ channel, endpoint, token, secret, enabled: true })
    if (migrated && isPushChannelConfigured(migrated))
      channels.push(migrated)
  }

  const primary = channels.find(c => c.enabled)
  if (primary) {
    channel = primary.channel
    endpoint = primary.endpoint
    token = primary.token
    secret = primary.secret
  }
  else if (hasExplicitChannels) {
    channel = 'webhook'
    endpoint = ''
    token = ''
    secret = ''
  }

  return {
    channel,
    endpoint,
    token,
    secret,
    channels,
    notificationTypes: { offline: true, mysteryArrival: true, mysteryPurchase: true, ...config?.notificationTypes },
    title: typeof config?.title === 'string' ? config.title : '账号下线提醒',
    msg: typeof config?.msg === 'string' ? config.msg : '账号下线',
  }
}
