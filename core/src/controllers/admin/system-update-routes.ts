import type { Application, NextFunction, Request, Response } from 'express';
export {};

const systemUpdate = require('../../services/system-update');
const { handleApiError } = require('./middleware');

function sendUpdateError(res: Response, err: any): void {
    if (Number.isInteger(err?.statusCode)) {
        res.status(err.statusCode).json({
            ok: false,
            error: err?.message || '操作失败',
            code: err?.code,
        });
        return;
    }
    handleApiError(res, err);
}

function requireJson(req: Request, res: Response, next: NextFunction): void {
    // Require a JSON body so an ordinary cross-site form cannot trigger a panel update.
    if (!req.is('application/json')) {
        res.status(415).json({ ok: false, error: '请使用 application/json 提交更新请求' });
        return;
    }
    next();
}

function mountSystemUpdateRoutes(app: Application): void {
    app.get('/api/system/update/status', async (_req: Request, res: Response) => {
        try {
            const data = await systemUpdate.getSystemUpdateStatus();
            res.json({ ok: true, data });
        } catch (err: any) {
            sendUpdateError(res, err);
        }
    });

    app.post('/api/system/update/check', requireJson, async (_req: Request, res: Response) => {
        try {
            const data = await systemUpdate.checkSystemUpdates();
            res.json({ ok: true, data });
        } catch (err: any) {
            sendUpdateError(res, err);
        }
    });

    app.post('/api/system/update/pull', requireJson, async (_req: Request, res: Response) => {
        try {
            const data = await systemUpdate.pullSystemUpdates();
            res.json({ ok: true, data });
        } catch (err: any) {
            sendUpdateError(res, err);
        }
    });

    app.post('/api/system/update/apply', requireJson, async (req: Request, res: Response) => {
        try {
            const pullFirst = req.body?.pullFirst !== false;
            const data = await systemUpdate.applySystemUpdate({ pullFirst });
            res.json({ ok: true, data });
        } catch (err: any) {
            sendUpdateError(res, err);
        }
    });

    app.post('/api/system/update/rollback', requireJson, async (req: Request, res: Response) => {
        try {
            const data = await systemUpdate.rollbackSystemRelease(req.body?.releaseId);
            res.json({ ok: true, data });
        } catch (err: any) {
            sendUpdateError(res, err);
        }
    });
}

module.exports = { mountSystemUpdateRoutes };
