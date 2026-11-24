import crypto from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { visualizer } from 'rollup-plugin-visualizer'
import UnoCSS from 'unocss/vite'
import { defineConfig } from 'vite'
import viteCompression from 'vite-plugin-compression'

const webPackageJson = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'))
const publicDir = fileURLToPath(new URL('./public', import.meta.url))

// https://vitejs.dev/config/
export default defineConfig(({ command, mode }) => {
  const analyzeBuild = mode === 'analyze'
  const compressedBuild = mode === 'compressed'
  const builtAt = Date.now()
  const webBuildId = command === 'build'
    ? `${webPackageJson.version}-${builtAt.toString(36)}-${crypto.randomBytes(4).toString('hex')}`
    : 'dev'

  return {
    plugins: [
      UnoCSS() as any,
      // public 目录下的静态资源（如 /game-config）在模板里按纯 URL 引用；
      // 若不关掉 includeAbsolute，Vue 会把绝对路径改写成 import "xxx?import"，
      // 而该请求被 /game-config 代理接管、返回 image/png，浏览器 MIME 校验失败导致路由白屏。
      vue({ template: { transformAssetUrls: { includeAbsolute: false } } }),
      {
        name: 'panel-version-manifest',
        apply: 'build' as const,
        generateBundle() {
          this.emitFile({
            type: 'asset',
            fileName: 'version.json',
            source: JSON.stringify({
              buildId: webBuildId,
              inputHash: process.env.TURBO_HASH,
              appVersion: webPackageJson.version,
              builtAt,
            }, null, 2),
          })
        },
      },
      ...(compressedBuild
        ? [viteCompression({
            verbose: true,
            threshold: 10240,
            algorithm: 'gzip',
            ext: '.gz',
          })]
        : []),
      ...(analyzeBuild
        ? [visualizer({
            open: false,
            gzipSize: true,
            brotliSize: true,
          })]
        : []),
    ],
    build: {
      // Compressed-size reporting and bundle analysis are useful on demand,
      // but add avoidable CPU work to every Linux/Docker startup build.
      reportCompressedSize: analyzeBuild,
      rollupOptions: {
        output: {
          manualChunks(id) {
            const normalizedId = id.replace(/\\/g, '/')
            if (!normalizedId.includes('/node_modules/'))
              return undefined

            const matchesPackage = (name: string) => normalizedId.includes(`/node_modules/${name}/`)

            if (['vue', 'vue-router', 'pinia', '@vueuse/core'].some(matchesPackage))
              return 'vendor-vue'

            if ([
              'naive-ui',
              'vueuc',
              'vdirs',
              'vooks',
              'css-render',
              '@css-render/vue3-ssr',
              '@css-render/plugin-bem',
              'seemly',
              'treemate',
              'evtd',
              'date-fns',
              'date-fns-tz',
              'lodash-es',
              'async-validator',
            ].some(matchesPackage)) {
              return 'vendor-ui'
            }

            if (matchesPackage('axios'))
              return 'vendor-axios'

            return 'vendor'
          },
        },
      },
      chunkSizeWarningLimit: 1000,
    },
    define: {
      __APP_VERSION__: JSON.stringify(webPackageJson.version),
      __WEB_BUILD_ID__: JSON.stringify(webBuildId),
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      proxy: {
        '/socket.io': {
          target: 'http://localhost:3007',
          changeOrigin: true,
          ws: true,
        },
        '/api': {
          target: 'http://localhost:3007',
          changeOrigin: true,
        },
        '/game-config': {
          target: 'http://localhost:3007',
          changeOrigin: true,
          // public/game-config 已有的文件直接本地伺服（dev 不启后端也能用），
          // 只有本地不存在的路径（运行时动态下载的配置）才透传给后端。
          bypass(req) {
            const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname)
            if (pathname.startsWith('/game-config/') && existsSync(path.join(publicDir, pathname)))
              return pathname
          },
        },
      },
    },
  }
})
