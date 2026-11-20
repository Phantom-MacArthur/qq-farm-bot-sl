import type { Application, Request, Response } from 'express';
import type { AdminContext } from './context';
export {};

const { version } = require('../../../package.json');
const { getRuntimeConfig } = require('../../config/config');

/**
 * 系统级只读路由。
 * 面板已改为免认证访问，这里只保留版本与存活探针这类公共信息。
 */
function mountSystemRoutes(app: Application, _ctx: AdminContext): void {
    app.get('/api/ping', (_req: Request, res: Response) => {
        res.json({ ok: true, data: { ok: true, uptime: process.uptime(), version } });
    });

    app.get('/api/game-version', (_req: Request, res: Response) => {
        const { clientVersion, wxClientVersion } = getRuntimeConfig();
        res.json({ ok: true, clientVersion, wxClientVersion, botVersion: version });
    });
}

module.exports = { mountSystemRoutes };
