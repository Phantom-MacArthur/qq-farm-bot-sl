"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_crypto_1 = __importDefault(require("node:crypto"));
const service_1 = require("../../services/wx-login/service");
const wxLoginAdapter = require('../../services/wx-login/adapter');
const TARGET_APP_ID = 'wx5306c5978fdb76e4';
const TASK_TTL_MS = 110_000;
const tasks = new Map();
const wxLogin = new service_1.WxLoginService();
function destroy(task) { wxLogin.destroy(task.session); task.code = undefined; tasks.delete(task.id); }
function publicTask(task) { return { task_id: task.id, app_id: TARGET_APP_ID, status: task.status, expires_at: Math.floor((task.createdAt + TASK_TTL_MS) / 1000) }; }
function findTask(req, res) {
    const task = tasks.get(String(req.params.taskId || ''));
    if (!task || Date.now() - task.createdAt > TASK_TTL_MS) {
        if (task)
            destroy(task);
        res.status(404).json({ ok: false, error: 'Login task not found or expired' });
        return null;
    }
    return task;
}
async function createTask(accountId) {
    const { session, qr } = await wxLogin.createQrSession();
    const task = { id: node_crypto_1.default.randomBytes(32).toString('hex'), accountId, createdAt: Date.now(), status: 'waiting', session, qr };
    tasks.set(task.id, task);
    return task;
}
async function poll(task) { if (task.status === 'authorized' || task.status === 'ready_for_code')
    return; task.status = await wxLogin.poll(task.session); }
async function confirm(task) {
    if (task.status !== 'authorized')
        throw new Error('Waiting for scan authorization');
    await wxLogin.confirm(task.session);
    task.status = 'ready_for_code';
}
async function consumeCode(task) { if (task.status !== 'ready_for_code')
    throw new Error('Login code is not ready'); task.code = await wxLogin.issueCode(task.session, TARGET_APP_ID); }
function mountWxLoginRoutes(app, _ctx) {
    app.post('/api/wx-login/tasks', async (req, res) => {
        if (req.body?.app_id && req.body.app_id !== TARGET_APP_ID) {
            return res.status(400).json({ ok: false, error: 'Unsupported app_id' });
        }
        try {
            const task = await createTask(String(req.body?.account_id ?? '').trim());
            res.json({ ok: true, data: { ...publicTask(task), qr_url: `/api/wx-login/tasks/${task.id}/qr` } });
        }
        catch (error) {
            res.status(502).json({ ok: false, error: error.message });
        }
    });
    app.get('/api/wx-login/tasks/:taskId/qr', (req, res) => { const task = findTask(req, res); if (task)
        res.type('jpeg').send(task.qr); });
    app.delete('/api/wx-login/tasks/:taskId', (req, res) => {
        const taskId = String(req.params.taskId || '');
        const task = tasks.get(taskId);
        // 取码后二维码任务会结束，关闭弹窗仍需释放尚未保存的凭证。
        const released = wxLoginAdapter.releasePendingWxInfo(taskId);
        if (!task && !released)
            return res.status(404).json({ ok: false, error: 'Login task not found or expired' });
        if (task)
            destroy(task);
        return res.json({ ok: true });
    });
    app.get('/api/wx-login/tasks/:taskId/status', async (req, res) => { const task = findTask(req, res); if (!task)
        return; try {
        if (!task.pending)
            task.pending = poll(task).finally(() => { task.pending = undefined; });
        await task.pending;
        const data = publicTask(task);
        if (task.status === 'cancelled' || task.status === 'expired')
            destroy(task);
        res.json({ ok: true, data });
    }
    catch (error) {
        task.status = 'failed';
        destroy(task);
        res.status(502).json({ ok: false, error: error.message });
    } });
    app.post('/api/wx-login/tasks/:taskId/confirm', async (req, res) => { const task = findTask(req, res); if (!task)
        return; try {
        if (!task.pending)
            task.pending = confirm(task).finally(() => { task.pending = undefined; });
        await task.pending;
        res.json({ ok: true, data: publicTask(task) });
    }
    catch (error) {
        task.status = 'failed';
        destroy(task);
        res.status(502).json({ ok: false, error: error.message });
    } });
    app.post('/api/wx-login/tasks/:taskId/code', async (req, res) => {
        const task = findTask(req, res);
        if (!task)
            return;
        try {
            if (!task.pending)
                task.pending = consumeCode(task).finally(() => { task.pending = undefined; });
            await task.pending;
            if (!task.code || tasks.get(task.id) !== task)
                throw new Error('Login task not found or expired');
            // Code 已取得，长效凭据留在服务端等待账号保存。
            wxLoginAdapter.registerPendingWxInfo(task.id, {
                accountId: task.accountId,
                wxid: task.session.openid || '',
                refreshtoken: task.session.refreshtoken || '',
                accesstoken: task.session.accesstoken || '',
                loginBuffer: task.session.loginBuffer || '',
                nickname: task.session.nickname || '',
                expiresIn: task.session.expires_in,
                expiresAt: task.session.expires_at,
            });
            const data = {
                session_id: task.id,
                openid: task.session.openid,
                app_id: TARGET_APP_ID,
                code: task.code,
                nickname: task.session.nickname || '',
                err_msg: 'login:ok',
            };
            destroy(task);
            res.json({ ok: true, data });
        }
        catch (error) {
            task.status = 'failed';
            if (tasks.get(task.id) === task)
                destroy(task);
            res.status(502).json({ ok: false, error: error.message });
        }
    });
}
module.exports = { mountWxLoginRoutes };
//# sourceMappingURL=wx-login-routes.js.map