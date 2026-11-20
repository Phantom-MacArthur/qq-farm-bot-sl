import { computed, watch } from 'vue'
import { hasAccountOfflineResponse } from '@/api'
import { useAccountStore } from '@/stores/account'
import { useStatusStore } from '@/stores/status'

/* 账号在线状态：
   none    未选账号
   unknown 刚切换账号、状态还没拉到当前账号（不算离线，避免切号后被当成「重新上线」）
   offline 进程未运行，或当前账号的请求/状态明确显示未连上
   online  进程在跑且已连上游戏 */
export type AccountPresence = 'none' | 'unknown' | 'offline' | 'online'

export function useAccountPresence() {
  const accountStore = useAccountStore()
  const statusStore = useStatusStore()
  return computed<AccountPresence>(() => {
    const id = String(accountStore.currentAccountId || '')
    if (!id)
      return 'none'
    const account = accountStore.currentAccount
    if (!account)
      return 'unknown'
    if (!account.running)
      return 'offline'
    if (String(statusStore.status?.accountId || '') !== id)
      return 'unknown'
    return statusStore.status?.connection?.connected && !hasAccountOfflineResponse.value ? 'online' : 'offline'
  })
}

export function useAccountOffline() {
  const presence = useAccountPresence()
  return computed(() => presence.value === 'offline')
}

/* 同一账号由离线变为在线时，执行一次页面刷新按钮的处理函数。
   切换账号不算重新上线，各页面自己的切号加载逻辑照旧。 */
export function useReconnectRefresh(refresh: () => unknown) {
  const accountStore = useAccountStore()
  const presence = useAccountPresence()
  watch([() => accountStore.currentAccountId, presence], ([id, next], [prevId, prev]) => {
    if (id && id === prevId && prev === 'offline' && next === 'online')
      void refresh()
  })
  return presence
}
