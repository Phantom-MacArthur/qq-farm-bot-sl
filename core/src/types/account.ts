export {};
export interface Account {
  id: string;
  name: string;
  code: string;
  platform: string;
  uin: string;
  qq: string;
  avatar: string;
  nick?: string;
  /** 微信扫码登录得到的 openid，也是定时刷新 Code 的账号身份。 */
  wxid?: string;
  /** 应用宝 loginBuffer（一次性取 Code 的根凭证），只允许存在于服务端。 */
  loginBuffer?: string;
  /** loginBuffer 续期用的滚动凭证，只允许存在于服务端。 */
  refreshtoken?: string;
  accesstoken?: string;
  createdAt: number;
  updatedAt: number;
  expires_in?: number;
  expires_at?: number;
  wxCredentialRefreshedAt?: number;
  wxCredentialLastAttemptAt?: number;
  wxCredentialRefreshError?: string;
  /**
   * 服务端已明确吊销授权（-109 / 40188 invalid scope），自动续期必须停手。
   *
   * 只在为 `true` 时有意义：换到新凭据（重新扫码 / 手动填 Code / 续期成功）
   * 时由 `addOrUpdateAccount` 清掉。缺失等价于 `false`。
   */
  wxCredentialNeedsRescan?: boolean;
  /** 账号运行时状态（由 data-provider 投影，不落盘）。 */
  runtimeState?: string;
  /** 等待掉线重登的时间戳（仅 relogin_waiting 时有效）。 */
  reloginAt?: number;
}

export interface AccountsData {
  accounts: Account[];
  nextId: number;
}
