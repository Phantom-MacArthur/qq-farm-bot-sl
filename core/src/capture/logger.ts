export {};

/**
 * 抓包服务日志（轻量控制台输出）
 *
 * 挂载到 bot 主进程时可用 options.log 注入 winston logger，
 * 此处保留独立实现，方便脱离 admin 上下文单独测试。
 */

const LEVELS: Record<string, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface CaptureLogger {
    (levelName: string, message: string, extra?: any): void;
    debug: (message: string, extra?: any) => void;
    info: (message: string, extra?: any) => void;
    warn: (message: string, extra?: any) => void;
    error: (message: string, extra?: any) => void;
}

function createLogger(level: string = 'info'): CaptureLogger {
    const threshold = LEVELS[String(level || 'info').toLowerCase()] ?? LEVELS.info;

    function write(levelName: string, message: string, extra?: any) {
        if (LEVELS[levelName] < threshold) return;
        const time = new Date().toISOString();
        const extraText = extra && typeof extra === 'object'
            ? ` ${JSON.stringify(extra)}`
            : (extra ? ` ${extra}` : '');
        console[levelName === 'error' ? 'error' : 'log'](
            `[${time}] [capture] [${levelName.toUpperCase()}] ${message}${extraText}`,
        );
    }

    const log = ((levelName: string, message: string, extra?: any) => write(String(levelName || 'info').toLowerCase(), message, extra)) as CaptureLogger;
    log.debug = (message: string, extra?: any) => write('debug', message, extra);
    log.info = (message: string, extra?: any) => write('info', message, extra);
    log.warn = (message: string, extra?: any) => write('warn', message, extra);
    log.error = (message: string, extra?: any) => write('error', message, extra);
    return log;
}

module.exports = { createLogger };
