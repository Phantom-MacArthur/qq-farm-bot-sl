const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_CONFIG,
  loadConfig,
  normalizeConfig,
  parsePortRange,
  splitList,
} = require('../dist/capture/config');

test('default config exposes expected fields', () => {
  // 独立服务模式已移除，配置里不应再出现 api* 字段
  assert.equal(DEFAULT_CONFIG.apiHost, undefined);
  assert.equal(DEFAULT_CONFIG.apiPort, undefined);
  assert.equal(DEFAULT_CONFIG.apiToken, undefined);
  assert.deepEqual(DEFAULT_CONFIG.proxyBind, ['0.0.0.0']);
  assert.deepEqual(DEFAULT_CONFIG.advertiseIps, ['auto']);
  assert.ok(DEFAULT_CONFIG.captureHosts.length > 0);
  assert.ok(DEFAULT_CONFIG.proxyPortFrom >= 1024);
  assert.equal(DEFAULT_CONFIG.proxyPortFrom, 18000);
  assert.equal(DEFAULT_CONFIG.proxyPortTo, 18000);
});

test('splitList handles arrays and comma strings', () => {
  assert.deepEqual(splitList(['a', 'b']), ['a', 'b']);
  assert.deepEqual(splitList('a, b,,c'), ['a', 'b', 'c']);
  assert.deepEqual(splitList(''), []);
});

test('parsePortRange validates port ranges', () => {
  assert.deepEqual(parsePortRange('18000', 1, 2), { from: 18000, to: 18000 });
  assert.deepEqual(parsePortRange('18000-18999', 1, 2), { from: 18000, to: 18000 });
  assert.deepEqual(parsePortRange('', 100, 200), { from: 100, to: 200 });
  assert.deepEqual(parsePortRange('invalid', 100, 200), { from: 100, to: 200 });
  assert.deepEqual(parsePortRange('30000-1000', 100, 200), { from: 100, to: 200 });
  assert.deepEqual(parsePortRange('80-90', 100, 200), { from: 100, to: 200 });
});

test('normalizeConfig fills defaults and sanitizes values', () => {
  const config = normalizeConfig({ apiPort: '9999', proxyPortFrom: '5000', proxyPortTo: '6000' });
  assert.equal(config.apiPort, undefined);
  assert.equal(config.proxyPortFrom, 5000);
  assert.equal(config.proxyPortTo, 5000);
  assert.equal(config.autoStopSec >= 60, true);
});

test('loadConfig writes default file on first run', () => {
  const { config, configPath } = loadConfig({ dataDir: '/tmp/capture-config-test' });
  const fs = require('node:fs');
  assert.ok(fs.existsSync(configPath));
  assert.deepEqual(config.proxyBind, ['0.0.0.0']);
  assert.equal(config.proxyPortFrom, 18000);
});

test('loadConfig applies env overrides', () => {
  process.env.CAPTURE_AUTOSTOP_SEC = '1200';
  process.env.CAPTURE_ADVERTISE_IPS = '10.0.0.9,100.64.0.9';
  try {
    const { config } = loadConfig({ dataDir: '/tmp/capture-config-test-env' });
    assert.equal(config.autoStopSec, 1200);
    assert.deepEqual(config.advertiseIps, ['10.0.0.9', '100.64.0.9']);
  } finally {
    delete process.env.CAPTURE_AUTOSTOP_SEC;
    delete process.env.CAPTURE_ADVERTISE_IPS;
  }
});
