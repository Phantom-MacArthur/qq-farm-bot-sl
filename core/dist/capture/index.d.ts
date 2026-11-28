export {};
export interface CaptureCoreOptions {
    /** 数据目录（配置与 CA 存放），默认沿用 bot 的 data 目录 */
    dataDir?: string;
    /** 日志函数 (level, message, extra)，默认控制台 */
    log?: (level: string, message: string, extra?: any) => void;
}
//# sourceMappingURL=index.d.ts.map