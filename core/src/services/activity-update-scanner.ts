export {};

/**
 * QQ 农场活动更新扫描器（移植自 B 项目 activity-update-scanner.js）
 *
 * 通过读取本机 QQ 小程序解包源码目录（game.js/game.json/tsdk.wasm/assets）与 gamecaches，
 * 抽取疑似活动 ID 并与已知活动集合比对，产出候选更新报告。
 * 强依赖 macOS QQ 容器路径（或环境变量 QQ_MINIAPP_SRC / QQ_MINIAPP_FS）；
 * 平台不匹配时 findLatestSource 返回空，scanActivityUpdates 报告 status='unavailable'。
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const APP_ID = '1112386029';
const SOURCE_PREFIX = `${APP_ID}_3_`;
const REQUIRED_SOURCE_FILES = ['game.js', 'game.json', path.join('tsdk', 'tsdk.wasm'), 'assets'];
const ACTIVITY_ID_PATTERN = /\b20\d{8}\b/g;

function getDefaultMiniappRoot(homeDir = os.homedir()): string {
  return path.join(homeDir, 'Library', 'Containers', 'com.tencent.qqexminiprogram', 'Data',
    'Library', 'Application Support', 'QQEX', 'miniapp', 'temps', 'miniapp_src');
}

function getDefaultFsRoot(homeDir = os.homedir()): string {
  return path.join(homeDir, 'Library', 'Containers', 'com.tencent.qqexminiprogram', 'Data',
    'Library', 'Application Support', 'QQEX', 'miniapp', 'fs');
}

function statOrNull(target: string): any {
  try {
    return fs.statSync(target);
  }
  catch {
    return null;
  }
}

function inspectCandidate(root: string, name: string): any {
  const directory = path.join(root, name);
  const missing = REQUIRED_SOURCE_FILES.filter(relative => !statOrNull(path.join(directory, relative)));
  const wasmPath = path.join(directory, 'tsdk', 'tsdk.wasm');
  const wasmStat = statOrNull(wasmPath);
  return {
    name,
    directory,
    complete: missing.length === 0,
    missing,
    wasmModifiedAt: wasmStat?.mtimeMs || 0,
    wasmSize: wasmStat?.size || 0,
  };
}

function findLatestSource(root: string): any {
  let names: string[] = [];
  try {
    names = fs.readdirSync(root, { withFileTypes: true })
      .filter((entry: any) => entry.isDirectory() && entry.name.startsWith(SOURCE_PREFIX))
      .map((entry: any) => entry.name);
  }
  catch {
    return { latest: null, candidates: [] };
  }
  const candidates = names.map(name => inspectCandidate(root, name))
    .sort((a, b) => b.wasmModifiedAt - a.wasmModifiedAt);
  return { latest: candidates.find((item: any) => item.complete) || null, candidates };
}

function extractActivityIds(gameJsPath: string): number[] {
  const source = fs.readFileSync(gameJsPath, 'utf8');
  return [...new Set((source.match(ACTIVITY_ID_PATTERN) || []) as string[])]
    .map(Number)
    .filter(isPlausibleActivityId)
    .sort((a, b) => b - a);
}

function isPlausibleActivityId(value: any): boolean {
  const text = String(value);
  if (!/^20\d{8}$/.test(text))
    return false;
  const year = Number(text.slice(0, 4));
  const month = Number(text.slice(4, 6));
  const day = Number(text.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function findGameCaches(fsRoot: string): any[] {
  const results: any[] = [];
  let accounts: any[] = [];
  try {
    accounts = fs.readdirSync(fsRoot, { withFileTypes: true }).filter((entry: any) => entry.isDirectory());
  }
  catch {
    return results;
  }
  for (const account of accounts) {
    const directory = path.join(fsRoot, account.name, APP_ID, 'usr', 'gamecaches');
    const cacheList = path.join(directory, 'cacheList.json');
    const cacheStat = statOrNull(cacheList);
    if (!cacheStat)
      continue;
    results.push({
      account: account.name,
      directory,
      cacheListModifiedAt: cacheStat.mtimeMs,
      bundles: ['mainscene', 'extraRes', 'plant', 'delayRes', 'audio', 'petdog']
        .filter(name => !!statOrNull(path.join(directory, name))),
    });
  }
  return results.sort((a, b) => b.cacheListModifiedAt - a.cacheListModifiedAt);
}

function scanActivityUpdates(options: any = {}): any {
  const miniappRoot = options.miniappRoot || process.env.QQ_MINIAPP_SRC || getDefaultMiniappRoot(options.homeDir);
  const fsRoot = options.fsRoot || process.env.QQ_MINIAPP_FS || getDefaultFsRoot(options.homeDir);
  const knownActivityIds = new Set((options.knownActivityIds || []).map(Number));
  const { latest, candidates } = findLatestSource(miniappRoot);
  const caches = findGameCaches(fsRoot);
  const warnings: string[] = [];
  let detectedActivityIds: number[] = [];

  if (!latest) {
    warnings.push('未找到包含 game.js、game.json、tsdk/tsdk.wasm 和 assets 的完整 QQ 农场源码目录');
  }
  else {
    try {
      detectedActivityIds = extractActivityIds(path.join(latest.directory, 'game.js'));
    }
    catch (error: any) {
      warnings.push(`读取 game.js 失败: ${error.message}`);
    }
  }
  if (!caches.length)
    warnings.push('未找到 QQ 农场 gamecaches/cacheList.json，活动图片可能尚未下载');

  const unknownActivityIds = knownActivityIds.size
    ? detectedActivityIds.filter(id => !knownActivityIds.has(id))
    : detectedActivityIds;

  return {
    scannedAt: Date.now(),
    appId: APP_ID,
    source: latest
      ? {
          version: latest.name,
          modifiedAt: latest.wasmModifiedAt,
          wasmSize: latest.wasmSize,
        }
      : null,
    candidateCount: candidates.length,
    incompleteCandidates: candidates.filter((item: any) => !item.complete).map((item: any) => ({
      version: item.name,
      missing: item.missing,
    })),
    detectedActivityIds,
    unknownActivityIds,
    caches: caches.map((cache: any) => ({
      cacheListModifiedAt: cache.cacheListModifiedAt,
      bundles: cache.bundles,
    })),
    warnings,
    status: !latest ? 'unavailable' : unknownActivityIds.length ? 'update-found' : 'up-to-date',
  };
}

module.exports = {
  APP_ID,
  extractActivityIds,
  findLatestSource,
  isPlausibleActivityId,
  scanActivityUpdates,
};
