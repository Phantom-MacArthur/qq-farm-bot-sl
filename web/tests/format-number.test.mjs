import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
// This repository runs its tests with Node's built-in runner.
// eslint-disable-next-line test/no-import-node-test
import test from 'node:test'

const require = createRequire(import.meta.url)
const ts = require('typescript')

const source = readFileSync(new URL('../src/utils/format-number.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } })
const module = { exports: {} }
// eslint-disable-next-line no-new-func
new Function('exports', 'module', outputText)(module.exports, module)
const { formatNumber, formatCompactAmount } = module.exports

test('formatNumber keeps the full value with thousands separators', () => {
  assert.equal(formatNumber(0), '0')
  assert.equal(formatNumber(999), '999')
  assert.equal(formatNumber(1000), '1,000')
  assert.equal(formatNumber(12930), '12,930')
  assert.equal(formatNumber(123456789), '123,456,789')
  assert.equal(formatNumber('12345'), '12,345')
  assert.equal(formatNumber('abc'), '0')
  assert.equal(formatNumber(undefined), '0')
})

test('amounts below ten thousand keep the plain thousands separator', () => {
  assert.equal(formatCompactAmount(0), '0')
  assert.equal(formatCompactAmount(1), '1')
  assert.equal(formatCompactAmount(999), '999')
  assert.equal(formatCompactAmount(1000), '1,000')
  assert.equal(formatCompactAmount(9999), '9,999')
})

test('amounts from ten thousand to one hundred million use 万 with at most one decimal', () => {
  assert.equal(formatCompactAmount(10000), '1万')
  assert.equal(formatCompactAmount(12000), '1.2万')
  assert.equal(formatCompactAmount(12500), '1.3万')
  assert.equal(formatCompactAmount(100000), '10万')
  assert.equal(formatCompactAmount(1234567), '123.5万')
  // 99999999 换算成万并四舍五入后已经是 10000 万，必须升级成亿。
  assert.equal(formatCompactAmount(99999999), '1亿')
})

test('integers drop the trailing .0 while fractional values keep one decimal', () => {
  assert.equal(formatCompactAmount(20000), '2万')
  assert.equal(formatCompactAmount(20500), '2.1万')
  assert.equal(formatCompactAmount(200000000), '2亿')
  assert.equal(formatCompactAmount(250000000), '2.5亿')
})

test('rounding that reaches the next unit is promoted instead of showing 10000万', () => {
  // 9999.96万 四舍五入到一位小数后跨过 1 亿。
  assert.equal(formatCompactAmount(99999600), '1亿')
  assert.equal(formatCompactAmount(100000000), '1亿')
})

test('an unknown balance stays unknown and is never rendered as zero', () => {
  assert.equal(formatCompactAmount(null), '--')
})

test('negative amounts keep the sign and are compacted by absolute value', () => {
  assert.equal(formatCompactAmount(-1), '-1')
  assert.equal(formatCompactAmount(-1000), '-1,000')
  assert.equal(formatCompactAmount(-12000), '-1.2万')
  assert.equal(formatCompactAmount(-100000), '-10万')
  assert.equal(formatCompactAmount(-250000000), '-2.5亿')
})
