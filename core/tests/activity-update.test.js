const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');

const finder = require('../dist/services/cdn-resource-finder');
const scanner = require('../dist/services/activity-update-scanner');
const monitor = require('../dist/services/activity-update-monitor');
const routes = require('../dist/controllers/admin/activity-update-routes');

// ===== cdn-resource-finder =====

test('decodeUuid passes through full/short ids and decodes 22-char compressed uuids', () => {
  const full = 'a1b2c3d4-0000-4000-8000-000000000000';
  assert.equal(finder.decodeUuid(full), full);
  assert.equal(finder.decodeUuid('012345678'), '012345678');
  const decoded = finder.decodeUuid('a1bcdefghijklmnopqrstu');
  assert.match(decoded, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});

test('versionHash returns hash for index and null when absent', () => {
  const config = { versions: { native: [3, 'abc', 5, 'def'] } };
  assert.equal(finder.versionHash(config, 'native', 3), 'abc');
  assert.equal(finder.versionHash(config, 'native', '5'), 'def');
  assert.equal(finder.versionHash(config, 'native', 9), null);
  assert.equal(finder.versionHash({}, 'native', 1), null);
});

test('bundleConfigUrl builds remote config url and validates inputs', () => {
  const settings = { assets: { server: 'https://cdn.example/', bundleVers: { plant: 'v9' } } };
  assert.equal(finder.bundleConfigUrl(settings, 'plant'), 'https://cdn.example/remote/plant/config.v9.json');
  assert.throws(() => finder.bundleConfigUrl({ assets: { server: 'https://x' } }, 'plant'));
});

test('remoteBundleNames filters builtin bundles and requires a version', () => {
  const settings = {
    assets: {
      remoteBundles: ['a', 'resources'],
      projectBundles: ['b', 'a', 'internal'],
      bundleVers: { a: '1', b: '2' },
    },
  };
  assert.deepEqual(finder.remoteBundleNames(settings).sort(), ['a', 'b']);
});

test('cacheKey is a deterministic 24-char hex digest', () => {
  const settings = { assets: { server: 'https://cdn', bundleVers: { a: '1' }, remoteBundles: ['a'], projectBundles: [] } };
  const key = finder.cacheKey(settings);
  assert.match(key, /^[0-9a-f]{24}$/);
  assert.equal(key, finder.cacheKey(settings));
});

// ===== activity-update-scanner =====

test('isPlausibleActivityId validates date-shaped ids', () => {
  assert.equal(scanner.isPlausibleActivityId(2026010100), true);
  assert.equal(scanner.isPlausibleActivityId('2026130100'), false); // month 13
  assert.equal(scanner.isPlausibleActivityId('12345'), false);
});

test('scanActivityUpdates reports unavailable when source dirs are missing', () => {
  const missing = path.join(os.tmpdir(), `no-such-qq-src-${Date.now()}`);
  const report = scanner.scanActivityUpdates({ miniappRoot: missing, fsRoot: missing, knownActivityIds: [] });
  assert.equal(report.status, 'unavailable');
  assert.equal(report.source, null);
  assert.ok(report.warnings.length >= 1);
});

// ===== activity-update-monitor =====

test('analyzeReport groups online candidates and flags protocol sample', () => {
  const scanned = { source: { version: 'v2' }, unknownActivityIds: [], detectedActivityIds: [], localScanEnabled: false };
  const online = { available: true, unknownActivityIds: [2026010100, 2026010101] };
  const report = monitor.analyzeReport(scanned, null, online);
  assert.equal(report.status, 'update-found');
  assert.deepEqual(report.unknownActivityIds, [2026010101, 2026010100]);
  assert.equal(report.analysis.candidateGroups.length, 1);
  assert.equal(report.analysis.candidateGroups[0].ids.length, 2);
  assert.equal(report.analysis.requiresProtocolSample, true);
});

test('analyzeReport preserves the previous online snapshot when a scan is unavailable', () => {
  const scanned = { source: null, unknownActivityIds: [] };
  const previous = { online: { available: true, activities: [{ id: 1 }], scannedAt: 5, unknownActivityIds: [] } };
  const report = monitor.analyzeReport(scanned, previous, { available: false, error: 'offline' });
  assert.equal(report.online.stale, true);
  assert.equal(report.online.available, false);
  assert.deepEqual(report.online.activities, [{ id: 1 }]);
  assert.equal(report.online.lastSuccessfulScannedAt, 5);
});

// ===== activity-update-routes (pure helpers) =====

test('collectKnownActivityIds returns static registered numeric ids', () => {
  const ids = routes.collectKnownActivityIds();
  assert.ok(Array.isArray(ids) && ids.length > 0);
  assert.ok(ids.every(id => Number.isFinite(id) && id > 0));
  assert.ok(ids.includes(2026092400));
});

test('flattenDirectoryIds expands group ids and nested activityIds', () => {
  const flat = routes.flattenDirectoryIds([{ id: '2026010100', activityIds: ['2026010101', '2026010102'] }]);
  assert.deepEqual([...new Set(flat)].sort(), [2026010100, 2026010101, 2026010102]);
});

test('findUnknownActivities filters out known ids', () => {
  const activities = [{ id: '2026010100' }, { id: '2026099900' }];
  const unknown = routes.findUnknownActivities(activities, [2026010100]);
  assert.deepEqual(unknown.map(item => Number(item.id)), [2026099900]);
});
