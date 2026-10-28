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
  // Vite inlines every VITE_* value into the public JavaScript bundle. Fail the
  // build rather than accidentally publishing a server-side credential.
  const secretLikeViteVars = Object.keys(env).filter((key) =>
    /(SECRET|PASSWORD|PASSWD|PRIVATE|DATABASE|CLIENT_SECRET|SERVICE_ROLE|ACCESS_TOKEN|REFRESH_TOKEN)/i.test(key),
  )
  if (secretLikeViteVars.length > 0) {
    throw new Error(
      `Refusing to build: secret-looking VITE_* variable(s) would be exposed in the frontend bundle: ` +
      secretLikeViteVars.join(', '),
    )
  }
  process.env.VITE_DEFAULT_THEME ??= env.VITE_DEFAULT_THEME || 'light'

  return {
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // registerSW.js is a render-blocking script by default ('autoInject' +
      // inline). 'script-defer' keeps it as a same-origin file (the CSP hash
      // server.js computes still matches) but stops it competing with the
      // first paint — Lighthouse flagged it under render-blocking-insight.
      injectRegister: 'script-defer',
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
      // Chunk assignment via rolldown's NATIVE advancedChunks, NOT the
      // manualChunks shim. With vite 8 / rolldown the manualChunks shim
      // demonstrably mis-merges modules: react core + react/jsx-runtime ended
      // up inside the framer-motion `anim` manual chunk (its exported {a, i}
      // bindings were the lazy loaders for react and the JSX runtime), so
      // every chunk that renders JSX statically imported `anim` and the entry
      // emitted <link rel="modulepreload"> for ~130 KB of framer-motion on
      // every page — the same disease the forced admin/three chunks had before
      // they were removed. Relying on purely automatic chunking instead is no
      // better: it inlines react-dom + framer-motion into the entry (506 KB)
      // and duplicates framer into per-consumer chunks. advancedChunks groups
      // keep library bytes in long-lived cached chunks while the entry and
      // every lazy route chunk stay free of manual-chunk static edges.
      //
      // Library chunks (each only loaded where actually used):
      //   vendor — react core/jsx/scheduler + react-dom + react-router (eager)
      //   anim   — framer-motion (only the auth/cart overlays + Emergency/About)
      //   icons  — lucide-react (tree-shaken)
      // NOTE: i18next is NOT grouped: main.tsx initializes it synchronously at
      // boot, so it stays in the entry chunk on the critical path.
      output: {
        advancedChunks: {
          // includeDependenciesRecursively must stay OFF: with it on (the
          // default) each group pulls its members' imported dependency
          // loaders — framer-motion's group dragged react/jsx-runtime into
          // the `anim` chunk, and then every JSX-rendering chunk statically
          // imported `anim` just to reach the JSX namespace. Groups are
          // evaluated in array order, so `vendor` (which explicitly matches
          // react core / jsx-runtime / scheduler via its test) wins first.
          includeDependenciesRecursively: false,
          groups: [
            {
              name: 'vendor',
              test: /node_modules[\\/](react$|react[\\/]|react-dom|react-router|scheduler)/,
            },
            { name: 'anim', test: /node_modules[\\/]framer-motion([\\/]|$)/ },
            { name: 'icons', test: /node_modules[\\/]lucide-react([\\/]|$)/ },
          ],
        },
      },
    },
    chunkSizeWarningLimit: 1000,
  },
  }
})
