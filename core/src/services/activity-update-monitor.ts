export {};

/**
 * 活动更新监控器（移植自 B 项目 activity-update-monitor.js）
 *
 * 定时/手动触发一次“活动更新扫描”：本机源码扫描（可选，默认关闭）+ 注入的在线扫描器，
 * 经 analyzeReport 归并（保留上次成功的在线快照，避免账号未连接时清空已持久化活动），
 * 结果落盘到 data/activity-update-report.json 供面板读取。
 * 在线扫描器由 admin 路由通过 startActivityUpdateMonitor({onlineScanner}) 注入，
 * 本机源码扫描仅在 ACTIVITY_LOCAL_SCAN_ENABLED=true 时启用（依赖 macOS QQ 容器路径）。
 */

const fs = require('node:fs');
const path = require('node:path');
const { getDataFile } = require('../config/runtime-paths');
const { scanActivityUpdates } = require('./activity-update-scanner');

const DEFAULT_INTERVAL_MS = 3 * 60 * 60 * 1000;
const MIN_INTERVAL_MS = 60 * 1000;
const STATE_FILE = getDataFile('activity-update-report.json');

let timer: any = null;
let running = false;
let report: any = null;
let knownActivityIds: number[] = [];
let intervalMs = DEFAULT_INTERVAL_MS;
let nextScanAt = 0;
let onlineScanner: ((knownIds: number[], localReport: any) => Promise<any>) | null = null;
let localScanEnabled = false;

function emptyLocalReport(): any {
  return {
    scannedAt: Date.now(),
    appId: '1112386029',
    source: null,
    candidateCount: 0,
    incompleteCandidates: [],
    detectedActivityIds: [],
    unknownActivityIds: [],
    caches: [],
    warnings: [],
    localScanEnabled: false,
  };
}

function readSavedReport(): any {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  }
  catch {
    return null;
  }
}

function writeSavedReport(value: any): void {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, `${JSON.stringify(value, null, 2)}\n`);
  }
  catch (error: any) {
    console.warn(`[活动更新] 保存分析结果失败: ${error.message}`);
  }
}

function analyzeReport(scanned: any, previous: any, online: any = null): any {
  // 服务刚启动时账号通常尚未连接。此时保留上次成功的在线目录，避免一次
  // “暂不可用”扫描把已经持久化的活动、分组和历史时间窗全部清空。
  const previousOnline = previous?.online;
  const hasPreviousOnlineSnapshot = previousOnline?.available
    || previousOnline?.stale && (
      previousOnline.activities?.length
      || previousOnline.activityWindows?.length
      || previousOnline.groups?.length
    );
  const effectiveOnline = online?.available === false && hasPreviousOnlineSnapshot
    ? {
        ...previousOnline,
        available: false,
        error: online.error || '在线扫描暂不可用',
        stale: true,
        lastSuccessfulScannedAt: previousOnline.lastSuccessfulScannedAt || previousOnline.scannedAt || 0,
      }
    : online;
  // 正式候选必须得到在线接口确认。本机源码/缓存仅作为辅助证据展示。
  const candidateIds = ([...new Set(effectiveOnline?.unknownActivityIds || [])] as number[])
    .sort((a, b) => b - a);
  const groups = new Map<string, number[]>();
  for (const id of candidateIds) {
    const date = String(id).slice(0, 8);
    const items = groups.get(date) || [];
    items.push(id);
    groups.set(date, items);
  }
  const previousVersion = previous?.source?.version || '';
  return {
    ...scanned,
    status: !scanned.source && !effectiveOnline?.available
      ? 'unavailable'
      : candidateIds.length ? 'update-found' : 'up-to-date',
    unknownActivityIds: candidateIds,
    online: effectiveOnline,
    localEvidence: {
      enabled: scanned.localScanEnabled === true,
      unknownActivityIds: scanned.unknownActivityIds || [],
      detectedActivityIds: scanned.detectedActivityIds || [],
      source: scanned.source || null,
      caches: scanned.caches || [],
      warnings: scanned.warnings || [],
    },
    sourceChanged: !!previousVersion && previousVersion !== scanned.source?.version,
    previousSourceVersion: previousVersion || null,
    analysis: {
      candidateGroups: [...groups.entries()].map(([date, ids]) => ({ date, ids })),
      requiresProtocolSample: candidateIds.length > 0,
      safeToAutoApply: false,
      summary: candidateIds.length
        ? `发现 ${candidateIds.length} 个候选活动 ID，已自动读取在线活动列表和只读活动分组`
        : effectiveOnline?.available
          ? '在线活动列表未发现尚未登记的新活动'
          : '在线分析等待已连接账号',
    },
  };
}

async function runActivityUpdateScan(): Promise<any> {
  if (running) return report;
  running = true;
  try {
    const previous = report || readSavedReport();
    const scanned = localScanEnabled
      ? { ...scanActivityUpdates({ knownActivityIds }), localScanEnabled: true }
      : emptyLocalReport();
    let online = null;
    if (typeof onlineScanner === 'function') {
      try {
        online = await onlineScanner(knownActivityIds, scanned);
      }
      catch (error: any) {
        online = { available: false, error: error.message || String(error), activities: [], groups: [], unknownActivityIds: [] };
      }
    }
    report = analyzeReport(scanned, previous, online);
    writeSavedReport(report);
    return report;
  }
  finally {
    running = false;
    nextScanAt = Date.now() + intervalMs;
  }
}

function scheduleNextScan(): void {
  if (timer) clearTimeout(timer);
  nextScanAt = Date.now() + intervalMs;
  timer = setTimeout(async () => {
    try {
      await runActivityUpdateScan();
    }
    catch (error: any) {
      console.warn(`[活动更新] 定时分析失败: ${error.message}`);
    }
    finally {
      scheduleNextScan();
    }
  }, intervalMs);
  timer.unref?.();
}

function startActivityUpdateMonitor(options: any = {}): void {
  knownActivityIds = (options.knownActivityIds || []).map(Number);
  onlineScanner = typeof options.onlineScanner === 'function' ? options.onlineScanner : null;
  localScanEnabled = options.localScanEnabled === true
    || String(process.env.ACTIVITY_LOCAL_SCAN_ENABLED || '').toLowerCase() === 'true';
  intervalMs = Math.max(MIN_INTERVAL_MS, Number(options.intervalMs) || Number(process.env.ACTIVITY_UPDATE_INTERVAL_MS) || DEFAULT_INTERVAL_MS);
  report = report || readSavedReport();
  scheduleNextScan();
  setImmediate(() => runActivityUpdateScan().catch((error: any) => {
    console.warn(`[活动更新] 初始分析失败: ${error.message}`);
  }));
}

function getActivityUpdateState(): any {
  return {
    running,
    intervalMs,
    nextScanAt,
    report: report || readSavedReport(),
  };
}

module.exports = {
  DEFAULT_INTERVAL_MS,
  analyzeReport,
  getActivityUpdateState,
  runActivityUpdateScan,
  startActivityUpdateMonitor,
};
