import type { YishuHuanfuFriendShopDto } from '@/stores/activity-center'

export type YishuHuanfuTabKey = 'shop' | 'records' | 'store'

export function isYishuSaleTarget(shop?: YishuHuanfuFriendShopDto | null): shop is YishuHuanfuFriendShopDto {
  return !!shop?.gid && !shop.quotePending && Number(shop.totalPrice) > 0
    && (shop.own || (shop.canSell !== false && Number(shop.quota) > 0))
}

export function yishuSaleQuota(shop: YishuHuanfuFriendShopDto): string | null {
  return shop.own ? null : shop.quota
}

export interface YishuHistoryEntry {
  at: number
  type: 'sale' | 'harvest'
  count: string | number
  targetGid?: string
  targetName?: string
}

export interface YishuHistory {
  day: string
  days: string[]
  entries: YishuHistoryEntry[]
  pendingOrder: { orderId: string } | null
}

const beijingTime = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

export function yishuTime(seconds: number | null | undefined) {
  return seconds ? beijingTime.format(seconds * 1000) : '—'
}
