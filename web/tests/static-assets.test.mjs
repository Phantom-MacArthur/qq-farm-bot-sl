import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- This project uses the Node.js test runner.
import test from 'node:test'

test('every icon reference uses the single PNG source with a cache-busting version', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8')
  const favicon = html.match(/<link[^>]*\srel="icon"[^>]*>/i)
  assert.ok(favicon, 'index.html 必须声明标签页图标')
  assert.match(favicon[0], /href="\/icon\.png\?v=\d+"/)

  const header = await readFile(new URL('../src/components/PageHeader.vue', import.meta.url), 'utf8')
  assert.match(header, /src="\/icon\.png\?v=\d+"/, 'PageHeader.vue 必须引用 icon.png')
  assert.equal(header.match(/\?v=(\d+)/)[1], favicon[0].match(/\?v=(\d+)/)[1], '页头与标签页的图标版本号必须一致')

  // 引用的图必须真实存在，且确实是 PNG（防止再把 JPEG 改个扩展名放进来）
  await stat(new URL('../public/icon.png', import.meta.url))
  const png = await readFile(new URL('../public/icon.png', import.meta.url))
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'icon.png 必须是真正的 PNG')

  // 旧的 svg/ico/icns 必须删除：留着只会造成「换了图但某些位置还是旧图标」的假象
  for (const stale of ['icon.svg', 'icon.ico', 'icon.icns'])
    await assert.rejects(stat(new URL(`../public/${stale}`, import.meta.url)), `${stale} 应已删除`)
})

test('the entry page does not load embedded documents or remote scripts', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8')
  assert.doesNotMatch(html, /<\s*(?:iframe|object|embed)\b/i)
  for (const script of html.matchAll(/<script\b[^>]+\bsrc\s*=\s*(['"])(.*?)\1/gi))
    assert.match(script[2], /^\/(?!\/)/)
})
