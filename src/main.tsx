import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HelmetProvider } from 'react-helmet-async'
import { QueryClientProvider } from '@tanstack/react-query'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { initSentry } from './lib/sentry'
import { queryClient } from './lib/queryClient'
import { TickerProvider } from './components/TickerProvider'
initSentry()

import './index.css'
import App from './App.tsx'

import en from './locales/en.json'
import ar from './locales/ar.json'
import es from './locales/es.json'
import { resolveInitialTheme, syncThemeColor } from './lib/theme'

// Apply the saved theme (or the VITE_DEFAULT_THEME env default, light unless
// configured otherwise). Runs after the inline script in index.html, which
// already painted the right theme — this keeps store/classes in sync.
//
// Guarded exactly like the inline script: when storage is blocked (Safari
// private mode, strict privacy settings) localStorage access THROWS a
// SecurityError. Unguarded, that would kill this module before
// createRoot().render() — a blank page with the bundle loaded. The inline
// script already painted the correct theme, so on failure we simply skip the
// store sync and keep rendering.
try {
  const initialTheme = resolveInitialTheme()
  if (initialTheme === 'dark') {
    document.documentElement.classList.remove('light')
    document.documentElement.classList.add('dark')
  } else {
    document.documentElement.classList.add('light')
    document.documentElement.classList.remove('dark')
  }
  localStorage.setItem('alka-theme', initialTheme)
  syncThemeColor(initialTheme)
} catch {
  // Storage unavailable — inline script default already applied. Never throw
  // during bootstrap.
}

// Set lang/dir before React mounts, based on the URL locale (the storefront is
// always served under /en, /ar, or /es). This avoids a flash of the wrong
// direction on first paint, especially for Arabic.
const pathLocale = window.location.pathname.split('/')[1]
const initialLocale = pathLocale === 'ar' || pathLocale === 'es' || pathLocale === 'en'
  ? pathLocale
  : navigator.language?.startsWith('ar') ? 'ar' : navigator.language?.startsWith('es') ? 'es' : 'en'
document.documentElement.dir = initialLocale === 'ar' ? 'rtl' : 'ltr'
document.documentElement.lang = initialLocale

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ar: { translation: ar },
    es: { translation: es },
  },
  // Boot in the URL/served document's locale, the same one `initialLocale`
  // just applied to <html lang/dir>. With lng hardcoded to 'en' every
  // non-English page mounted with English strings and then re-rendered all
  // visible text when the locale effect fired — on /ar/ that repaints the
  // whole document (and the prerendered consent banner mirror) Latin-for-Arabic
  // between two paints, which Lighthouse attributed as a layout shift and
  // readers saw as a language flash. Components must hydrate in the language
  // the server already painted.
  lng: initialLocale,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <HelmetProvider>
        <TickerProvider>
          <App />
        </TickerProvider>
      </HelmetProvider>
    </QueryClientProvider>
  </StrictMode>,
)
