"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const { version } = require('../../../package.json');
const { getActiveWebBuildId } = require('./web-version');
const { getServiceSummary } = require('../../session/ipc');
const { getRuntimeConfig } = require('../../config/config');
/**
 * 系统级只读路由。
 * 面板已改为免认证访问，这里只保留版本与存活探针这类公共信息。
 */
function mountSystemRoutes(app, _ctx) {
    app.get('/api/ping', (_req, res) => {
        res.json({ ok: true, data: { ok: true, uptime: process.uptime(), version, webBuildId: getActiveWebBuildId() } });
    });
    app.get('/api/game-version', async (_req, res) => {
        const { clientVersion, wxClientVersion } = getRuntimeConfig();
        res.json({ ok: true, clientVersion, wxClientVersion, botVersion: version, serviceSummary: await getServiceSummary().catch(() => null) });
    });
}
module.exports = { mountSystemRoutes };
//# sourceMappingURL=system-routes.js.map