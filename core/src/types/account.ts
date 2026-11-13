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
}

export interface AccountsData {
  accounts: Account[];
  nextId: number;
}
