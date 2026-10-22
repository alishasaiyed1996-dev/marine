import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Guarantee VITE_DEFAULT_THEME always resolves for the index.html
  // %VITE_DEFAULT_THEME% replacement (and import.meta.env). .env files are
  // gitignored, so production builds have no env file — without this seed,
  // Vite leaves the literal %VAR% token in the shipped HTML and warns.
  // A real env var (Hostinger dashboard) or local .env still takes priority.
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  process.env.VITE_DEFAULT_THEME ??= env.VITE_DEFAULT_THEME || 'light'

  return {
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Only the favicon is precached. The old `images/*.png|avif` globs pulled
      // ~9 MB of images into the install step, so Workbox downloaded them in the
      // background on every first visit / after every deploy — saturating the
      // connection and starving the visible page images (they loaded seconds
      // late). Runtime image caching still happens via the Cloudinary route.
      includeAssets: ['favicon.ico'],
      manifest: {
        name: 'Alka Traders — Marine Equipment Supplier',
        short_name: 'Alka Traders',
        description: 'Global marine and industrial equipment supplier',
        theme_color: '#111827',
        background_color: '#f8f9fb',
        display: 'standalone',
        scope: '/',
        start_url: '/',
        icons: [
          { src: '/images/alka-traders-logo-400.png', sizes: '400x400', type: 'image/png' },
        ],
      },
      workbox: {
        // NOTE: HTML is deliberately NOT precached. The old config precached
        // index.html and served it from the cache for every navigation
        // (navigateFallback). After a deploy that was a stale-shell trap: the
        // SW kept serving OLD index.html → OLD chunk hashes, while
        // skipWaiting + cleanupOutdatedCaches had already deleted the old
        // chunks — producing "Failed to fetch dynamically imported module"
        // white screens on refresh, worst on lazy routes (admin, network,
        // checkout). Only immutable, hashed assets belong in the precache.
        // Hashed JS/CSS/fonts only — never png/avif. See includeAssets note:
        // precaching dist/images (9.2 MB, 323 files → ~22 MB) made the service
        // worker install compete with page loading for bandwidth.
        globPatterns: ['**/*.{js,css,woff2,svg,ico,webmanifest}'],
        cleanupOutdatedCaches: true,
        // vite-plugin-pwa defaults navigateFallback to 'index.html' — that
        // regenerates the stale-shell NavigationRoute we just removed. Null it
        // out so navigations are handled ONLY by the NetworkFirst route below.
        navigateFallback: null,
        runtimeCaching: [
          {
            // Navigations hit the network first, so a refresh after any
            // deploy always gets the NEW index.html (with the new chunk
            // hashes). The last successfully-loaded page is cached as the
            // offline fallback (7 days / 32 entries).
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'pages',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 32, maxAgeSeconds: 7 * 24 * 60 * 60 },
            },
          },
          {
            // Cross-origin images are fetched by the service worker, which is
            // governed by the page's CSP `connect-src` (NOT `img-src`). Keep
            // https://res.cloudinary.com in server.js connect-src, otherwise
            // every cached image request fails with Workbox `no-response` and
            // the gallery loses its images once the SW takes control.
            urlPattern: /^https?:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'cloudinary-images',
              expiration: { maxEntries: 50, maxAgeSeconds: 30 * 24 * 60 * 60 },
            },
          },
          {
            urlPattern: /^https?:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts' },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@shared': path.resolve(__dirname, 'shared'),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'frontend/dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // NOTE: admin + three are deliberately NOT forced into manual chunks
          // any more. Forcing every file under components/admin/** into one
          // `admin` chunk (and three into `three`) created static edges from the
          // entry/vendor chunks into those chunks, so Vite emitted
          // `<link rel="modulepreload">` for ~420 KB gz of admin panel + 3D
          // globe code on EVERY public page. Lazy routes already code-split
          // naturally, so /admin and /network still download only what they use.

          // Vendor chunk for heavy libraries
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react-router')) {
            return 'vendor'
          }
          // Animation library — big, and shared by many pages; own chunk = one
          // long-lived cached file instead of re-fetching per page bundle.
          if (id.includes('node_modules/framer-motion')) {
            return 'anim'
          }
          // Icon library — huge source, tree-shaken at build; isolated so its
          // cache never invalidates other app code.
          if (id.includes('node_modules/lucide-react')) {
            return 'icons'
          }
          // NOTE: i18next stays in the entry chunk on purpose — main.tsx
          // initializes it synchronously at boot, so it's on the critical path.
        },
      },
    },
    chunkSizeWarningLimit: 1000,
  },
  }
})
