import type { Application } from 'express';
import type { AdminContext } from './context';
export {};

/**
 * 活动更新 / CDN 自动发现 admin 路由（移植自 B 项目 admin-activity-update-routes.js，适配 SL）
 *
 * 与 B 的差异（按“原样全部移植 + 择优适配”决策）：
 * - 在线扫描器改用 SL 的 provider.getActivityDirectorySnapshot(accountRef)（返回已聚合的
 *   {activities:[{id,name,activityIds,startTime,endTime}]}），B 特有的
 *   getActivityDiscoverySnapshot / getActivityGroupSnapshot「分组探针」逻辑无对应 RPC，故去除，
 *   仅保留目录比对得出未登记活动 ID；CDN 封面解析失败时优雅降级为无图。
 * - knownActivityIds 来源于 SL 的 activity-gameplay-registry 静态登记 + CDN 卡片规则表，
 *   取代 B 的 `*_ACTIVITY_ID` 常量导出。
 * - 鉴权沿用 SL 全局中间件（/api/* 自动校验 x-admin-token），源码图片路由置于 /api 之外，
 *   与抓包证书一致，便于手机直取。
 *
 * 端点：
 * - GET  /activity-source-asset/:bundle/:filename   本机展开源码原生图片（/api 之外）
 * - GET  /api/activity/update/status                监控状态与最近报告
 * - GET  /api/activity/directory                    最近在线活动目录快照
 * - POST /api/activity/update/scan                  立即触发一次扫描
 */

const { buildActivityGameplayBindings } = require('../../services/activity-gameplay-registry');
const {
  getActivityUpdateState,
  runActivityUpdateScan,
  startActivityUpdateMonitor,
} = require('../../services/activity-update-monitor');
const {
  ACTIVITY_CARD_ASSET_RULES,
  findSourceAsset,
  resolveActivityCardImages,
  resolveActivityCdnImages,
} = require('../../services/activity-cdn-resolver');

function collectKnownActivityIds(): number[] {
  const ids = new Set<number>();
  for (const key of buildActivityGameplayBindings({}).keys()) {
    const id = Number(key);
    if (Number.isFinite(id) && id > 0) ids.add(id);
  }
  for (const rule of ACTIVITY_CARD_ASSET_RULES || []) {
    for (const id of rule.ids || []) {
      const value = Number(id);
      if (Number.isFinite(value) && value > 0) ids.add(value);
    }
  }
  return [...ids];
}

function flattenDirectoryIds(activities: any[]): number[] {
  const result: number[] = [];
  for (const item of activities || []) {
    for (const raw of [item?.id, ...(Array.isArray(item?.activityIds) ? item.activityIds : [])]) {
      const id = Number(raw);
      if (Number.isFinite(id) && id > 0) result.push(id);
    }
  }
  return result;
}

function findUnknownActivities(activities: any[], knownIds: Iterable<number>): any[] {
  const known = new Set(Array.from(knownIds || []).map(Number));
  return (activities || []).filter((item) => {
    const id = Number(item?.id);
    return Number.isFinite(id) && id > 0 && !known.has(id);
  });
}

function mountActivityUpdateRoutes(app: Application, ctx: AdminContext): void {
  const provider = ctx.provider;
  const knownActivityIds = collectKnownActivityIds();

  const pickConnectedAccount = (): any => {
    const accounts = provider.getAccounts()?.accounts || [];
    return accounts.find((item: any) => {
      if (!item.running || !provider.isAccountRunning(item.id)) return false;
      const status = provider.getStatus(item.id);
      return !!status?.connection?.connected;
    }) || null;
  };

  const scanOnlineActivities = async (knownIds: number[], _localReport: any = null): Promise<any> => {
    const account = pickConnectedAccount();
    if (!account) {
      return {
        available: false,
        error: '没有已连接账号，暂时无法调用 ActivityService.List',
        activities: [],
        activityWindows: [],
        groups: [],
        unknownActivityIds: [],
      };
    }

    // SL 目录快照已按活动分组聚合，无 B 的 activityWindows / GetGroup 探针可用。
    const directory = await provider.getActivityDirectorySnapshot(account.id);
    const activities = directory?.activities || [];
    const unknown = findUnknownActivities(activities, knownIds);
    const unknownIds = [...new Set([
      ...unknown.map((item: any) => Number(item.id)),
      ...flattenDirectoryIds(unknown).filter((id: number) => !new Set(knownIds.map(Number)).has(id)),
    ])].sort((a, b) => b - a);

    // CDN 封面解析依赖本机展开源码（macOS）；失败时降级为无图，不影响活动 ID 检测。
    try {
      await resolveActivityCdnImages({ activities, groups: [] });
      const officialCardImages = await resolveActivityCardImages(activities);
      for (const item of activities) {
        const imageUrl = officialCardImages.get(Number(item.id));
        if (imageUrl) item.imageUrl = imageUrl;
      }
    }
    catch (error: any) {
      console.warn(`[活动更新] CDN 图片解析失败: ${error.message}`);
    }

    return {
      available: true,
      accountName: account.name || account.nick || '在线账号',
      scannedAt: Date.now(),
      activities,
      activityWindows: activities,
      groups: [],
      unknownActivityIds: unknownIds,
    };
  };

  startActivityUpdateMonitor({
    knownActivityIds,
    onlineScanner: scanOnlineActivities,
    localScanEnabled: String(process.env.ACTIVITY_LOCAL_SCAN_ENABLED || '').toLowerCase() === 'true',
  });

  // 本机展开源码原生图片（置于 /api 之外，参照抓包证书，供手机直取）
  app.get('/activity-source-asset/:bundle/:filename', (req: any, res: any) => {
    const sourceFile = findSourceAsset(req.params.bundle, req.params.filename);
    if (!sourceFile) return res.sendStatus(404);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.sendFile(sourceFile);
  });

  app.get('/api/activity/update/status', (_req: any, res: any) => {
    res.json({ ok: true, ...getActivityUpdateState() });
  });

  app.get('/api/activity/directory', (_req: any, res: any) => {
    const state = getActivityUpdateState();
    const online = state.report?.online;
    res.json({
      ok: true,
      scannedAt: online?.scannedAt || state.report?.scannedAt || 0,
      knownActivityIds,
      activities: online?.activities || [],
      activityWindows: online?.activityWindows || [],
      groups: online?.groups || [],
      unknownActivityIds: online?.unknownActivityIds || [],
    });
  });

  app.post('/api/activity/update/scan', async (_req: any, res: any) => {
    try {
      const report = await runActivityUpdateScan();
      res.json({ ok: true, report, ...getActivityUpdateState() });
    }
    catch (error: any) {
      res.status(500).json({ ok: false, error: error.message || '活动更新扫描失败' });
    }
  });
}

module.exports = {
  mountActivityUpdateRoutes,
  // 导出纯函数供单测复用
  collectKnownActivityIds,
  findUnknownActivities,
  flattenDirectoryIds,
};
