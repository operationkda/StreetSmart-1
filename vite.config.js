import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      base: '/StreetSmart-1/',
      registerType: 'autoUpdate',
      // Use the hand-crafted manifest.json rather than letting the plugin generate one.
      manifest: false,
      workbox: {
        // Cache the app shell and all static assets so the app loads offline.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // Network-first for API calls so fresh data is preferred but offline still works.
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 50, maxAgeSeconds: 300 },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(rootDir, 'src'),
    },
  },
})
