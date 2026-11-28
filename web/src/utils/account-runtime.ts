export interface AccountRuntime {
  running?: boolean
  online?: boolean
  runtimeState?: 'logging_in' | 'relogin_waiting' | 'running' | 'offline' | 'stopping' | 'stopped'
  reloginAt?: number | null
}

export function isAccountActive(account: AccountRuntime) {
  return !!account.running || account.runtimeState === 'logging_in' || account.runtimeState === 'relogin_waiting'
    || account.runtimeState === 'running' || account.runtimeState === 'stopping'
}

export function getAccountRuntimeStatus(account: AccountRuntime, now: number) {
  switch (account.runtimeState) {
    case 'logging_in':
      return { text: '登录中', color: 'bg-blue-500', busy: true }
    case 'relogin_waiting': {
      const deadline = Number(account.reloginAt)
      const seconds = Number.isFinite(deadline) ? Math.max(0, Math.ceil((deadline - now) / 1000)) : 0
      return { text: seconds > 0 ? `Code 待核对，${seconds}秒后重登` : 'Code 待核对，即将重登', color: 'bg-amber-500', busy: false }
    }
    case 'running':
      return { text: '运行中', color: 'bg-green-500', busy: false }
    case 'offline':
      return { text: '已掉线', color: 'bg-red-500', busy: false }
    case 'stopping':
      return { text: '停止中', color: 'bg-gray-400', busy: true }
    case 'stopped':
      return { text: '已停止', color: 'bg-gray-300', busy: false }
    default:
      if (account.running && account.online === false)
        return { text: '连接未确认', color: 'bg-amber-500', busy: false }
      return { text: account.running ? '运行中' : '已停止', color: account.running ? 'bg-green-500' : 'bg-gray-300', busy: false }
  }
}
