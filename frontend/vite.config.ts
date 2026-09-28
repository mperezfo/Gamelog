import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // The frontend always calls relative paths (`/api/...`). In development
    // Vite proxies them to the Go backend; in production the frontend is a
    // static build served from the same origin as the API.
    // That way the backend needs no CORS and no per-environment base URL.
    proxy: {
      '/api': {
        target: process.env.GAMELOG_API_URL ?? 'http://127.0.0.1:8080',
        changeOrigin: true,
      },
    },
  },
})
