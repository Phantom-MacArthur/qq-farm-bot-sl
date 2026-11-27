export {};
export interface CaptureLogger {
    (levelName: string, message: string, extra?: any): void;
    debug: (message: string, extra?: any) => void;
    info: (message: string, extra?: any) => void;
    warn: (message: string, extra?: any) => void;
    error: (message: string, extra?: any) => void;
}
//# sourceMappingURL=logger.d.ts.map