import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin, type ProxyOptions } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), serviceWorkerPlugin()],
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
