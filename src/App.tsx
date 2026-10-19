import { BrowserRouter, Routes, Route, Navigate, useParams, useLocation } from 'react-router-dom'
import { Suspense, lazy, useEffect } from 'react'
import { useStore } from './store/useStore'
import { API_BASE } from './lib/api/core'
import { PageWrapper } from './components/layout/PageWrapper'
import { ScrollToTop } from './components/layout/ScrollToTop'
import { PageErrorBoundary } from './components/ui/PageErrorBoundary'
import { ToastProvider } from './components/admin/Toast'
import { LocaleContext, VALID_LOCALES } from './lib/locale'
import type { Language } from './types'
const CommandSearch = lazy(() => import('./components/sections/CommandSearch').then(m => ({ default: m.CommandSearch })))

const AuthModal = lazy(() => import('./components/auth/AuthModal').then(m => ({ default: m.AuthModal })))
const CartDrawer = lazy(() => import('./components/cart/CartDrawer').then(m => ({ default: m.CartDrawer })))

const Home = lazy(() => import('./pages/Home'))
const Products = lazy(() => import('./pages/Products'))
const Industries = lazy(() => import('./pages/Industries'))
const Brands = lazy(() => import('./pages/Brands'))
const BrandHub = lazy(() => import('./pages/BrandHub'))
const CategoryHub = lazy(() => import('./pages/CategoryHub'))
const About = lazy(() => import('./pages/About'))
const RFQ = lazy(() => import('./pages/RFQ'))
const Contact = lazy(() => import('./pages/Contact'))
const SearchPage = lazy(() => import('./pages/Search'))
const Emergency = lazy(() => import('./pages/Emergency'))
const Network = lazy(() => import('./pages/Network'))
const Intelligence = lazy(() => import('./pages/Intelligence'))
const NotFound = lazy(() => import('./pages/NotFound'))
const Checkout = lazy(() => import('./pages/Checkout'))
const ProductDetail = lazy(() => import('./pages/ProductDetail'))
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'))
const ResetPassword = lazy(() => import('./pages/ResetPassword'))
const TrackOrder = lazy(() => import('./pages/TrackOrder'))
const OrderHistory = lazy(() => import('./pages/account/OrderHistory'))
const MyOffers = lazy(() => import('./pages/account/MyOffers'))
const OfferCheckout = lazy(() => import('./pages/account/OfferCheckout'))
const ProfileEdit = lazy(() => import('./pages/account/ProfileEdit'))
const PrivacyPolicy = lazy(() => import('./pages/PrivacyPolicy'))
const TermsOfService = lazy(() => import('./pages/TermsOfService'))
const RefundPolicy = lazy(() => import('./pages/RefundPolicy'))
import { CookieConsent } from './components/CookieConsent'
import { StoreAnalytics } from './components/analytics/StoreAnalytics'
import { useStoreSettings } from './hooks/useStoreSettings'
import Maintenance from './pages/Maintenance'
import { PayPalProvider } from './components/PayPalProvider'
import { WhatsAppFloat } from './components/WhatsAppFloat'
import { PageSkeleton } from './components/ui/Skeleton'

// Admin
const AdminLayout = lazy(() => import('./components/admin/AdminLayout').then(m => ({ default: m.AdminLayout })))
const AdminLogin = lazy(() => import('./pages/admin/AdminLogin'))
const AdminGuard = lazy(() => import('./components/admin/AdminGuard').then(m => ({ default: m.AdminGuard })))
import { ErrorBoundary } from './components/admin/ErrorBoundary'
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'))
const AdminProducts = lazy(() => import('./pages/admin/AdminProducts'))
const AdminEbayInventory = lazy(() => import('./pages/admin/AdminEbayInventory'))
const AdminMedia = lazy(() => import('./pages/admin/AdminMedia'))
const AdminBrands = lazy(() => import('./pages/admin/AdminBrands'))
const AdminIndustries = lazy(() => import('./pages/admin/AdminIndustries'))
const AdminOrders = lazy(() => import('./pages/admin/AdminOrders'))
const AdminCustomers = lazy(() => import('./pages/admin/AdminCustomers'))
const AdminCategories = lazy(() => import('./pages/admin/AdminCategories'))
const AdminRFQs = lazy(() => import('./pages/admin/AdminRFQs'))
const AdminOffers = lazy(() => import('./pages/admin/AdminOffers'))
const AdminMessages = lazy(() => import('./pages/admin/AdminMessages'))
const AdminUsers = lazy(() => import('./pages/admin/AdminUsers'))
const AdminAuditLog = lazy(() => import('./pages/admin/AdminAuditLog'))
const AdminSettings = lazy(() => import('./pages/admin/AdminSettings'))
const AdminProductForm = lazy(() => import('./pages/admin/AdminProductForm'))
const AdminInsights = lazy(() => import('./pages/admin/AdminInsights'))

function LoadingFallback() {
  // Skeleton page instead of a bare spinner: the layout (header + product
  // grid shapes) is already painted, so lazy route loads never flash white.
  return <PageSkeleton />
}

/**
 * Validates that `:locale` is one of the supported locales.
 * If not, redirects the legacy /path to /en/path.
 * Sets the store language on valid locale changes.
 * Provides LocaleContext so all child components know the current locale.
 */
function LocaleLayout() {
  const { locale } = useParams<{ locale: string }>()
  const location = useLocation()
  const setLanguage = useStore((s) => s.setLanguage)
  const language = useStore((s) => s.language)
  const adminUser = useStore((s) => s.adminUser)
  const settings = useStoreSettings()

  const isValid = locale !== undefined && VALID_LOCALES.includes(locale as Language)

  // Set language when locale changes. The URL locale is authoritative for
  // language and text direction, including English (LTR), so every page has
  // the correct <html lang> / <html dir> even on first load.
  useEffect(() => {
    if (!isValid) return
    document.documentElement.lang = locale as Language
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr'
    if (locale !== language) {
      setLanguage(locale as Language)
    }
  }, [locale, setLanguage, language, isValid])

  // Redirect legacy non-prefixed URLs like /products → /en/products.
  // Preserve the query string so filter deep links (?category=&brand=&search=)
  // survive the redirect. All hooks must be called before any early returns.
  if (!isValid) {
    return <Navigate to={`/en${location.pathname}${location.search}`} replace />
  }

  // Maintenance mode: gate the storefront for everyone except signed-in admins.
  // Admin routes live outside this layout, so the panel stays reachable.
  if (settings.maintenanceMode && !adminUser) {
    return <Maintenance />
  }

  return (
    <LocaleContext.Provider value={locale as Language}>
      <PageErrorBoundary>
        <PageWrapper>
          <StoreAnalytics />
          <Suspense fallback={null}>
            <CommandSearch />
            <AuthModal />
            <CartDrawer />
          </Suspense>
          <Suspense fallback={<LoadingFallback />}>
            <Routes>
              <Route index element={<Home />} />
              <Route path="shop" element={<Navigate to="products" replace />} />
              <Route path="products" element={<Products />} />
              <Route path="industries" element={<Industries />} />
              <Route path="brands" element={<Brands />} />
              <Route path="brands/:slug" element={<BrandHub />} />
              <Route path="categories/:slug" element={<CategoryHub />} />
              <Route path="about" element={<About />} />
              <Route path="rfq" element={<RFQ />} />
              <Route path="contact" element={<Contact />} />
              <Route path="search" element={<SearchPage />} />
              <Route path="emergency" element={<Emergency />} />
              <Route path="network" element={<Network />} />
              <Route path="intelligence" element={<Intelligence />} />
              <Route path="checkout" element={<Checkout />} />
              <Route path="forgot-password" element={<ForgotPassword />} />
              <Route path="reset-password" element={<ResetPassword />} />
              <Route path="track-order" element={<TrackOrder />} />
              <Route path="account/orders" element={<OrderHistory />} />
              <Route path="account/offers" element={<MyOffers />} />
              <Route path="account/offers/:id/pay" element={<OfferCheckout />} />
              <Route path="account/profile" element={<ProfileEdit />} />
              <Route path="product/:key" element={<ProductDetail />} />
              <Route path="privacy-policy" element={<PrivacyPolicy />} />
              <Route path="terms-of-service" element={<TermsOfService />} />
              <Route path="refund-policy" element={<RefundPolicy />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </PageWrapper>
      </PageErrorBoundary>
    </LocaleContext.Provider>
  )
}

/** Root fallback for client-side navigation; production server redirects / to /en. */
function RootRedirect() {
  return <Navigate to="/en" replace />
}

function AppContent() {
  const isSessionLoading = useStore((s) => s.isSessionLoading)
  const adminSessionLoading = useStore((s) => s.adminSessionLoading)
  const loadAdminSession = useStore((s) => s.loadAdminSession)
  const loadCustomerSession = useStore((s) => s.loadCustomerSession)
  const refreshCartPrices = useStore((s) => s.refreshCartPrices)

  // Neon free-tier cold-start wake. When the database compute has scaled to
  // zero (~5 min idle), the first API request would otherwise be slow or fail.
  // Ping /api/wake on load — and again whenever the tab regains visibility — so
  // the wake is absorbed before the user's first real query. Fire-and-forget:
  // the backend's wake loop waits out the cold start and returns 200 once the
  // compute is back, and the request is a ~50ms no-op when the DB is already up.
  useEffect(() => {
    const wakeUrl = `${API_BASE.replace(/\/api\/v1$/, '')}/api/wake`
    const wake = () => {
      void fetch(wakeUrl, { credentials: 'include' }).catch(() => {})
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') wake()
    }
    wake()
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  useEffect(() => {
    if (localStorage.getItem('alka-admin-auth')) loadAdminSession()
    if (localStorage.getItem('alka-auth')) loadCustomerSession()
    // Refresh any persisted cart against fresh product prices on boot.
    refreshCartPrices()
  }, [loadAdminSession, loadCustomerSession, refreshCartPrices])

  if (isSessionLoading || adminSessionLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[var(--primary-bg)]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 border-[var(--accent-primary)] border-t-transparent animate-spin" />
          <p className="text-[var(--text-muted)] text-sm">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <>
    <ScrollToTop />
    <Routes>
      {/* Admin routes — listed FIRST so they take priority */}
      <Route path="/admin/login" element={<Suspense fallback={<LoadingFallback />}><AdminLogin /></Suspense>} />
      <Route
        path="/admin"
        element={
          <AdminGuard>
            <ErrorBoundary pageName="Admin Panel">
              <AdminLayout />
            </ErrorBoundary>
          </AdminGuard>
        }
      >
        <Route index element={<AdminDashboard />} />
        <Route path="products" element={<AdminProducts />} />
        <Route path="ebay-inventory" element={<AdminEbayInventory />} />
        <Route path="media" element={<AdminMedia />} />
        <Route path="brands" element={<AdminBrands />} />
        <Route path="industries" element={<AdminIndustries />} />
        <Route path="orders" element={<AdminOrders />} />
        <Route path="customers" element={<AdminCustomers />} />
        <Route path="categories" element={<AdminCategories />} />
        <Route path="rfqs" element={<AdminRFQs />} />
        <Route path="offers" element={<AdminOffers />} />
        <Route path="messages" element={<AdminMessages />} />
        <Route path="users" element={<AdminUsers />} />
        <Route path="audit-log" element={<AdminAuditLog />} />
        <Route path="settings" element={<AdminSettings />} />
        <Route path="insights" element={<AdminInsights />} />
        <Route path="products/new" element={<AdminProductForm />} />
        <Route path="products/:id/edit" element={<AdminProductForm />} />
        <Route path="*" element={<NotFound />} />
      </Route>

      {/* Root redirect: / → /en (or detected browser language) */}
      <Route path="/" element={<RootRedirect />} />

      {/* Storefront with locale prefix */}
      <Route path="/:locale/*" element={<LocaleLayout />} />
    </Routes>
    </>
  )
}

export default function App() {
  return (
    <ToastProvider>
    <PayPalProvider>
    <BrowserRouter><AppContent /></BrowserRouter>
    </PayPalProvider>
    <CookieConsent />
    <WhatsAppFloat />
    </ToastProvider>
  )
}
