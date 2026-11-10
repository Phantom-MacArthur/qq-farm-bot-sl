export {};

/**
 * 抓包服务共享类型定义。
 *
 * 字段含义与 `<dataDir>/capture/config.json` 一一对应，环境变量覆盖见 config.ts。
 */

/** 平台：qq = QQ 客户端，wx = 微信客户端 */
export type CapturePlatform = 'qq' | 'wx';

/** 网卡地址分类 */
export type CaptureIpKind = 'tailscale' | 'lan' | 'other' | 'unknown';

/**
 * 抓包服务配置文件。
 *
 * 只保留嵌入模式实际使用的字段；`api*` 三项属于已删除的独立服务模式。
 */
export interface CaptureConfig {
    /** 代理监听 IP 列表 */
    proxyBind: string[];
    /** 对外公布的 IP，'auto' 表示自动检测网卡 */
    advertiseIps: string[];
    /** 地址排序优先级 */
    preferOrder: string[];
    /** MITM 代理起始端口 */
    proxyPortFrom: number;
    /** MITM 代理结束端口（当前实现与起始端口相同，只占一个端口） */
    proxyPortTo: number;
    /** 需要中间人抓取的域名，支持 `*.` 前缀通配 */
    captureHosts: string[];
    /**
     * 网关域名（可选覆盖）。命中时登录 code 放宽长度要求并采集 ver 版本号；
     * 不配置时由 code-extractor 回退 `['*.nqf.qq.com']`。
     */
    gatewayHosts?: string[];
    /** 代理自动停止秒数，0 表示不自动停止 */
    autoStopSec: number;
    /** 会话过期毫秒数 */
    sessionTtlMs: number;
    /** 日志级别 */
    logLevel: string;
    /** 配置文件读取失败时记录原因，不写回磁盘 */
    loadError?: string;
}

/**
 * 面板侧的抓包服务开关，落在 `store.json` 的公共配置里，与上面的配置文件相互独立。
 */
export interface CaptureServiceSettings {
    /** 是否允许使用抓包登录；关闭时相关路由返回 403 */
    enabled: boolean;
    /** QQ 抓包登录后是否自动把好友 GID 导入已知好友列表 */
    autoImportQqGids: boolean;
}
