import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { cp, readdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve, sep } from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin, type ProxyOptions } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), emojiPlugin(), fontPreloadPlugin(), serviceWorkerPlugin()],
  define: {
    // Identifies the build, so that the offline copy of the query cache an
    // older one wrote can be told apart and dropped (src/lib/offlineCache.ts).
    __BUILD_ID__: JSON.stringify(Date.now().toString(36)),
  },
  server: {
    // The frontend always calls relative paths (`/api/...`). In development
    // Vite proxies them to the Go backend; in production the frontend is a
    // static build served from the same origin as the API.
    // That way the backend needs no CORS and no per-environment base URL.
    proxy: { '/api': apiProxy() },
  },
  preview: {
    // The same proxy, so that a production build can be tried locally
    // against the backend, service worker and offline mode included.
    proxy: { '/api': apiProxy() },
  },
})

function apiProxy(): ProxyOptions {
  return {
    target: process.env.GAMELOG_API_URL ?? 'http://127.0.0.1:8080',
    changeOrigin: true,
    // With the backend stopped, answer 502 as Caddy does in production
    // rather than Vite's default 500, so that stopping `air` is a faithful
    // way to try the offline mode.
    configure: (proxy) => {
      proxy.on('error', (_error, _request, response) => {
        if (!('writeHead' in response) || response.headersSent) return
        response.writeHead(502, { 'Content-Type': 'text/plain' }).end('The backend is not running.')
      })
    },
  }
}

/**
 * Emits src/sw.js as the build's /sw.js, filled in with the list of files to
 * keep as the offline app shell and a version derived from their contents.
 *
 * It runs once the whole build, public/ included, is on disk, so the list is
 * exactly what gets deployed. A build with the same contents gets the same
 * version, and the browser leaves the installed worker alone.
 */
function serviceWorkerPlugin(): Plugin {
  let root = ''
  let outDir = ''

  return {
    name: 'gamelog-service-worker',
    apply: 'build',
    configResolved(config) {
      root = config.root
      outDir = resolve(config.root, config.build.outDir)
    },
    async closeBundle() {
      const files = (await readdir(outDir, { recursive: true, withFileTypes: true }))
        .filter((entry) => entry.isFile())
        .map((entry) => '/' + relative(outDir, join(entry.parentPath, entry.name)).split(sep).join('/'))
        .filter((path) => path !== '/sw.js')
        // Close to four thousand of them, so the worker keeps each one as
        // it is first shown instead (see emojiPlugin).
        .filter((path) => !path.startsWith(EMOJI_PATH))
        .sort()

      const hash = createHash('sha256')
      for (const path of files) {
        hash.update(path)
        hash.update(await readFile(join(outDir, path)))
      }

      // index.html is precached as `/`, which serves the same file and is
      // what the worker's page-load fallback looks up.
      const shell = files.map((path) => (path === '/index.html' ? '/' : path))
      const source = await readFile(resolve(root, 'src/sw.js'), 'utf8')
      const output = source
        .replace('__SHELL_VERSION__', hash.digest('hex').slice(0, 12))
        .replace("['__SHELL_FILES__']", JSON.stringify(shell))
      await writeFile(join(outDir, 'sw.js'), output)
    },
  }
}

/** Where the emoji images are served from, by the dev server and the build. */
const EMOJI_PATH = '/emoji/'

/**
 * Serves Google's Noto emoji as images under /emoji/, one PNG per emoji named
 * after its code points (see src/components/Emoji.tsx), so that an icon
 * looks the same on every system instead of in whichever emoji font it
 * ships. A font was tried first, but the only self-hostable Noto colour font
 * is drawn with SVG glyphs, which Chromium does not render.
 *
 * Also provides `virtual:emoji-aliases`: the few hundred emoji commonly typed
 * without their U+FE0F (a bare heart, say), mapped to the image of the full
 * sequence, which is the only one the set has a file for.
 */
function emojiPlugin(): Plugin {
  const require = createRequire(import.meta.url)
  const packageDir = dirname(require.resolve('emoji-datasource-google/package.json'))
  const imagesDir = join(packageDir, 'img/google/64')
  const aliasesId = 'virtual:emoji-aliases'
  let outDir = ''

  return {
    name: 'gamelog-emoji',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    resolveId(id) {
      return id === aliasesId ? '\0' + aliasesId : undefined
    },
    async load(id) {
      if (id !== '\0' + aliasesId) return undefined
      const emoji: { unified: string; non_qualified: string | null }[] = JSON.parse(
        await readFile(join(packageDir, 'emoji.json'), 'utf8'),
      )
      const aliases = Object.fromEntries(
        emoji.filter((e) => e.non_qualified).map((e) => [e.non_qualified!.toLowerCase(), e.unified.toLowerCase()]),
      )
      return `export default ${JSON.stringify(aliases)}`
    },
    configureServer(server) {
      server.middlewares.use(EMOJI_PATH, (request, response, next) => {
        const name = (request.url ?? '').split('?')[0].slice(1)
        if (!/^[0-9a-f-]+\.png$/.test(name)) return next()
        const stream = createReadStream(join(imagesDir, name))
        stream.on('error', () => next())
        stream.once('open', () => {
          response.setHeader('Content-Type', 'image/png')
          stream.pipe(response)
        })
      })
    },
    async writeBundle() {
      await cp(imagesDir, join(outDir, EMOJI_PATH), { recursive: true })
    },
  }
}

/**
 * Preloads the Latin face of the interface font from index.html, so that the
 * browser asks for it alongside the stylesheet instead of only once the
 * stylesheet has been read, and the first visit spends as little time as
 * possible in the fallback font.
 */
function fontPreloadPlugin(): Plugin {
  return {
    name: 'gamelog-font-preload',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, context) {
        const font = Object.keys(context.bundle ?? {}).find((name) =>
          /figtree-latin-wght-normal-[\w-]+\.woff2$/.test(name),
        )
        if (!font) return []
        return [
          {
            tag: 'link',
            attrs: { rel: 'preload', href: `/${font}`, as: 'font', type: 'font/woff2', crossorigin: '' },
            injectTo: 'head',
          },
        ]
      },
    },
  }
}
