import { create } from 'zustand'
import i18n from 'i18next'
import type { Language, CartItem, Product, User, PriceRange } from '../types'
import {
  adminAuth,
  customerAuth,
  getAdminToken,
  getCustomerToken,
  refreshAdminSession,
  refreshCustomerSession,
  setAdminToken,
  setCustomerToken,
  storefront,
} from '../lib/api'
import { apiProductToFrontend, apiProductsToFrontend } from '../lib/adapters'
import { queryClient } from '../lib/queryClient'
import { resolveInitialTheme, syncThemeColor } from '../lib/theme'


interface AdminUser {
  name: string
  email: string
  role: 'owner' | 'store-manager' | 'inventory-manager' | 'sales-agent' | 'content-manager' | 'viewer'
  avatar?: string
}

/** Server-authoritative totals for the most recently placed order. */
export interface OrderSummary {
  orderNumber?: string
  subtotal: number
  shippingCost: number
  tax: number
  total: number
  currency: string
  /** Guest email stored with the order (also restored after PayPal redirects). */
  shippingEmail?: string | null
}

/** A cart line the server dropped because its product is no longer in the catalog. */
export interface SkippedCartItem {
  productId: string
  productName: string
  quantity: number
}

interface AppState {
  // Theme
  theme: 'dark' | 'light'
  toggleTheme: () => void

  // Admin Auth
  adminUser: AdminUser | null
  isAdminLoggedIn: boolean
  adminSessionLoading: boolean
  adminLoginError: string | null
  adminLogin: (email: string, password: string) => Promise<boolean>
  adminLogout: () => Promise<void>
  loadAdminSession: () => Promise<void>

  // Language
  language: Language
  setLanguage: (lang: Language) => void

  // Search
  searchQuery: string
  setSearchQuery: (query: string) => void
  recentSearches: string[]
  addRecentSearch: (query: string) => void
  clearRecentSearches: () => void

  // Filters
  selectedCategories: string[]
  selectedBrands: string[]
  selectedIndustry: string
  priceRange: PriceRange
  showOnSale: boolean
  urgencyFilter: 'all' | 'emergency'
  sortBy: 'relevance' | 'name-asc' | 'name-desc' | 'category' | 'price-asc' | 'price-desc'
  setSelectedCategories: (cats: string[]) => void
  setSelectedBrands: (brands: string[]) => void
  setSelectedIndustry: (industry: string) => void
  setPriceRange: (range: PriceRange) => void
  setShowOnSale: (sale: boolean) => void
  setUrgencyFilter: (filter: 'all' | 'emergency') => void
  setSortBy: (sort: 'relevance' | 'name-asc' | 'name-desc' | 'category' | 'price-asc' | 'price-desc') => void
  clearFilters: () => void

  // RFQ Form
  rfqStep: number
  setRfqStep: (step: number) => void
  rfqSubmitted: boolean
  setRfqSubmitted: (submitted: boolean) => void
  rfqId: string
  generateRfqId: () => void
  rfqDeadline: string | null
  setRfqDeadline: (deadline: string | null) => void

  // Cmd+K
  commandOpen: boolean
  setCommandOpen: (open: boolean) => void

  // Auth
  isLoggedIn: boolean
  user: User | null
  isSessionLoading: boolean
  showAuthModal: boolean
  authError: string | null
  /** One-shot flag set after submitting an offer (product page → toast/redirect). */
  offerJustSubmitted: boolean
  login: (email: string, password: string) => Promise<boolean>
  register: (name: string, email: string, password: string, phone?: string, company?: string, country?: string) => Promise<boolean>
  logout: () => Promise<void>
  loadCustomerSession: () => Promise<void>
  setShowAuthModal: (show: boolean) => void
  clearAuthErrors: () => void

  // Admin Sidebar
  adminSidebarCollapsed: boolean
  toggleAdminSidebar: () => void

  // Cart
  cart: CartItem[]
  showCartDrawer: boolean
  setShowCartDrawer: (show: boolean) => void
  addToCart: (product: Product) => void
  removeFromCart: (productId: string) => void
  updateQuantity: (productId: string, qty: number) => void
  clearCart: () => void
  refreshCartPrices: () => Promise<void>
  getCartTotal: () => number
  getCartCount: () => number
  cartTotal: number
  cartCount: number

  // Checkout
  checkoutStep: number
  setCheckoutStep: (step: number) => void
  orderPlaced: boolean
  setOrderPlaced: (placed: boolean) => void
  orderId: string
  generateOrderId: () => void
  cancelRequested: boolean
  setCancelRequested: (req: boolean) => void
  cancelReason: string
  setCancelReason: (reason: string) => void
  orderSummary: OrderSummary | null
  setOrderSummary: (summary: OrderSummary | null) => void
  orderSkippedItems: SkippedCartItem[]
  setOrderSkippedItems: (items: SkippedCartItem[]) => void
}

function loadState<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = localStorage.getItem(`alka-${key}`)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    // Corrupted JSON in localStorage — fall back to default
    console.warn('[store] Corrupted localStorage data for key:', `alka-${key}`)
    return fallback
  }
}

function saveState(key: string, value: unknown) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(`alka-${key}`, JSON.stringify(value))
  } catch { /* quota exceeded, expected behavior for full localStorage */ }
}

function computeCartTotals(cart: CartItem[]) {
  let total = 0
  let count = 0
  for (const item of cart) {
    const price = item.product.onSale && item.product.salePrice
      ? item.product.salePrice
      : item.product.price
    total += price * item.quantity
    count += item.quantity
  }
  return { cartTotal: total, cartCount: count }
}

export const useStore = create<AppState>((set, get) => ({
  toggleTheme: () =>
    set((state) => {
      const newTheme = state.theme === 'dark' ? 'light' : 'dark'
      if (newTheme === 'light') {
        document.documentElement.classList.add('light')
        document.documentElement.classList.remove('dark')
      } else {
        document.documentElement.classList.remove('light')
        document.documentElement.classList.add('dark')
      }
      // Persist so a reload keeps the choice (main.tsx only restores what's stored).
      try {
        localStorage.setItem('alka-theme', newTheme)
      } catch { /* storage unavailable */ }
      syncThemeColor(newTheme)
      return { theme: newTheme }
    }),

  // Admin Auth
  adminUser: null,
  isAdminLoggedIn: false,
  adminSessionLoading: typeof window !== 'undefined' && !!localStorage.getItem('alka-admin-auth'),
  adminLoginError: null,
  adminLogin: async (email: string, password: string) => {
    set({ adminLoginError: null })
    try {
      const { accessToken, user } = await adminAuth.login({ email, password })
      setAdminToken(accessToken)
      set({ adminUser: user as AdminUser, isAdminLoggedIn: true, adminLoginError: null })
      saveState('admin-auth', true)
      return true
    } catch (err: any) {
      set({ adminLoginError: err.message || 'Login failed' })
      return false
    }
  },
  adminLogout: async () => {
    try { await adminAuth.logout() } catch { console.warn('[store] Admin logout API call failed') }
    setAdminToken(null)
    set({ adminUser: null, isAdminLoggedIn: false })
    localStorage.removeItem('alka-admin-auth')
  },
  loadAdminSession: async () => {
    // Don't store admin PII in localStorage — always validate against the API
    if (!localStorage.getItem('alka-admin-auth')) {
      set({ adminSessionLoading: false })
      return
    }
    try {
      // After a page reload the in-memory admin token is gone. Restore it from
      // the httpOnly refresh cookie before calling /admin/auth/me.
      if (!getAdminToken()) {
        const restored = await refreshAdminSession()
        if (restored === 'invalid') {
          localStorage.removeItem('alka-admin-auth')
          set({ adminUser: null, isAdminLoggedIn: false, adminSessionLoading: false })
          return
        }
        if (restored !== 'ok') {
          // API temporarily unreachable (cold start / outage) — keep the
          // marker so the session can be restored on the next page load.
          set({ adminSessionLoading: false })
          return
        }
      }
      const { user } = await adminAuth.me()
      const validRoles = ['owner', 'store-manager', 'inventory-manager', 'sales-agent', 'content-manager', 'viewer']
      if (validRoles.includes(user.role)) {
        set({ adminUser: user as AdminUser, isAdminLoggedIn: true, adminSessionLoading: false })
      } else {
        localStorage.removeItem('alka-admin-auth')
        set({ adminSessionLoading: false })
      }
    } catch {
      console.warn('[store] Admin session token expired or invalid — clearing session')
      localStorage.removeItem('alka-admin-auth')
      set({ adminUser: null, isAdminLoggedIn: false, adminSessionLoading: false })
    }
  },

  // Admin Sidebar
  adminSidebarCollapsed: typeof window !== 'undefined' && window.innerWidth < 1024,
  toggleAdminSidebar: () => set((s) => ({ adminSidebarCollapsed: !s.adminSidebarCollapsed })),

  // Language
  language: 'en',
  setLanguage: (language) => {
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr'
    document.documentElement.lang = language
    i18n.changeLanguage(language)
    set({ language })
  },

  // Search
  searchQuery: '',
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  recentSearches: [],
  addRecentSearch: (query) =>
    set((state) => ({
      recentSearches: [query, ...state.recentSearches.filter((s) => s !== query)].slice(0, 5),
    })),
  clearRecentSearches: () => set({ recentSearches: [] }),

  // Filters
  selectedCategories: [],
  selectedBrands: [],
  selectedIndustry: '',
  priceRange: { min: 0, max: 10000 },
  showOnSale: false,
  urgencyFilter: 'all',
  sortBy: 'relevance',
  setSelectedCategories: (selectedCategories) => set({ selectedCategories }),
  setSelectedBrands: (selectedBrands) => set({ selectedBrands }),
  setSelectedIndustry: (selectedIndustry) => set({ selectedIndustry }),
  setPriceRange: (priceRange) => set({ priceRange }),
  setShowOnSale: (showOnSale) => set({ showOnSale }),
  setUrgencyFilter: (urgencyFilter) => set({ urgencyFilter }),
  setSortBy: (sortBy) => set({ sortBy }),
  clearFilters: () =>
    set({
      selectedCategories: [],
      selectedBrands: [],
      selectedIndustry: '',
      priceRange: { min: 0, max: 10000 },
      showOnSale: false,
      urgencyFilter: 'all',
      sortBy: 'relevance',
      searchQuery: '',
    }),

  // RFQ
  rfqStep: 1,
  setRfqStep: (rfqStep) => set({ rfqStep }),
  rfqSubmitted: false,
  setRfqSubmitted: (rfqSubmitted) => set({ rfqSubmitted }),
  rfqId: '',
  generateRfqId: () =>
    set({ rfqId: `AT-${Math.floor(10000 + Math.random() * 90000)}` }),
  rfqDeadline: null,
  setRfqDeadline: (rfqDeadline) => set({ rfqDeadline }),

  // Cmd+K
  commandOpen: false,
  setCommandOpen: (commandOpen) => set({ commandOpen }),

  // Auth
  // Don't persist user PII in localStorage — always validate against the API on session load
  isLoggedIn: typeof window !== 'undefined' && !!localStorage.getItem('alka-auth'),
  user: null,
  isSessionLoading: typeof window !== 'undefined' && !!localStorage.getItem('alka-auth'),

  // Initial theme honors the stored choice; falls back to VITE_DEFAULT_THEME.
  theme: resolveInitialTheme(),
  showAuthModal: false,
  authError: null,
  login: async (email: string, password: string) => {
    set({ authError: null })
    try {
      const { accessToken, user } = await customerAuth.login({ email, password })
      setCustomerToken(accessToken)
      set({ isLoggedIn: true, user, showAuthModal: false, authError: null })
      saveState('auth', true)
      return true
    } catch (err: any) {
      set({ authError: err.message || 'Login failed' })
      return false
    }
  },
  register: async (name, email, password, phone, company, country) => {
    set({ authError: null })
    try {
      const { accessToken, user } = await customerAuth.register({ name, email, password, phone, company, country })
      setCustomerToken(accessToken)
      set({ isLoggedIn: true, user, showAuthModal: false, authError: null })
      saveState('auth', true)
      return true
    } catch (err: any) {
      set({ authError: err.message || 'Registration failed' })
      return false
    }
  },
  logout: async () => {
    try { await customerAuth.logout() } catch { console.warn('[store] Customer logout API call failed') }
    setCustomerToken(null)
    set({
      isLoggedIn: false,
      user: null,
      cart: [],
      showCartDrawer: false,
      cartTotal: 0,
      cartCount: 0,
      // Never let the next customer see the previous checkout confirmation.
      orderPlaced: false,
      orderId: '',
      orderSummary: null,
      orderSkippedItems: [],
      checkoutStep: 1,
      cancelRequested: false,
      cancelReason: '',
    })
    // Customer-scoped caches (orders, offers) must not survive the session.
    queryClient.clear()
    saveState('auth', false)
    saveState('cart', [])
  },
  loadCustomerSession: async () => {
    set({ isSessionLoading: true })

    if (!localStorage.getItem('alka-auth')) {
      set({ isLoggedIn: false, user: null, isSessionLoading: false })
      return
    }
    // After a page reload the in-memory customer token is gone. Restore it from
    // the httpOnly refresh cookie before calling /auth/me.
    if (!getCustomerToken()) {
      const restored = await refreshCustomerSession()
      if (restored === 'invalid') {
        set({ isLoggedIn: false, user: null, isSessionLoading: false })
        localStorage.removeItem('alka-auth')
        return
      }
      if (restored !== 'ok') {
        // API temporarily unreachable (cold start / outage) — keep the
        // marker so the session can be restored on the next page load.
        set({ isSessionLoading: false })
        return
      }
    }
    try {
      const { user } = await customerAuth.me()
      set({ isLoggedIn: true, user, isSessionLoading: false })
    } catch {
      console.warn('[store] Customer session token expired or invalid — clearing session')
      set({ isLoggedIn: false, user: null, isSessionLoading: false })
      localStorage.removeItem('alka-auth')
    }
  },
  setShowAuthModal: (showAuthModal) => set({ showAuthModal }),
  clearAuthErrors: () => set({ authError: null, adminLoginError: null }),

  // Cart
  cart: loadState<CartItem[]>('cart', []),
  ...computeCartTotals(loadState<CartItem[]>('cart', [])),
  showCartDrawer: false,
  setShowCartDrawer: (showCartDrawer) => set({ showCartDrawer }),
  addToCart: (product) =>
    set((state) => {
      // Never let the cart hold more units than the catalog can fulfil — the
      // server would reject the whole order at checkout. A missing/zero stock
      // count means the product is not buyable.
      const maxQty = Math.max(0, Math.floor(Number(product.stockCount) || 0))
      if (!product.inStock || maxQty === 0) return state

      const existing = state.cart.find((item) => item.product.id === product.id)
      if (existing && existing.quantity >= maxQty) return state

      const newCart = existing
        ? state.cart.map((item) =>
            item.product.id === product.id
              ? { ...item, quantity: Math.min(item.quantity + 1, maxQty) }
              : item
          )
        : [...state.cart, { product, quantity: 1 }]
      saveState('cart', newCart)
      return { cart: newCart, showCartDrawer: true, ...computeCartTotals(newCart) }
    }),
  removeFromCart: (productId) =>
    set((state) => {
      const newCart = state.cart.filter((item) => item.product.id !== productId)
      saveState('cart', newCart)
      return { cart: newCart, ...computeCartTotals(newCart) }
    }),
  updateQuantity: (productId, qty) =>
    set((state) => {
      const newCart = qty <= 0
        ? state.cart.filter((item) => item.product.id !== productId)
        : state.cart.flatMap((item) => {
            if (item.product.id !== productId) return [item]
            // An unavailable line can't be kept at a minimum quantity — the
            // server would reject the entire checkout. Drop it instead.
            const maxQty = Math.floor(Number(item.product.stockCount) || 0)
            if (!item.product.inStock || maxQty <= 0) return []
            return [{ ...item, quantity: Math.min(qty, maxQty) }]
          })
      saveState('cart', newCart)
      return { cart: newCart, ...computeCartTotals(newCart) }
    }),
  clearCart: () => {
    set({ cart: [], cartTotal: 0, cartCount: 0 })
    saveState('cart', [])
  },
  // Re-validate persisted cart prices against fresh storefront data so a price
  // or sale change by an admin propagates to the drawer/checkout estimate.
  // The server recomputes totals on order creation and remains authoritative.
  refreshCartPrices: async () => {
    const { cart } = get()
    if (cart.length === 0) return
    try {
      const ids = [...new Set(cart.map((item) => item.product.id))]
      const res = await storefront.products.list({ limit: '100' })
      const live = new Map(apiProductsToFrontend(res.products).map((p) => [p.id, p]))

      // Carts can exceed the list page size or reference items filtered out of
      // the list — fetch those individually through the existing product API.
      const missing = ids.filter((id) => !live.has(id))
      if (missing.length > 0) {
        const fetched = await Promise.all(
          missing.map((id) =>
            storefront.products.get(id)
              .then((r) => r.product)
              .catch(() => null)
          )
        )
        for (const apiProduct of fetched) {
          if (apiProduct) {
            const frontend = apiProductToFrontend(apiProduct)
            live.set(frontend.id, frontend)
          }
        }
      }

      // Replace each persisted snapshot with the fresh product, dropping items
      // whose product no longer exists or is out of stock, and clamping
      // quantities to the current stock so checkout isn't rejected for an
      // impossible quantity.
      const newCart = cart
        .map((item) => {
          const fresh = live.get(item.product.id)
          if (!fresh || !fresh.inStock) return null
          const maxQty = Math.floor(Number(fresh.stockCount) || 0)
          if (maxQty <= 0) return null
          return { ...item, product: fresh, quantity: Math.min(item.quantity, maxQty) }
        })
        .filter((x): x is CartItem => x !== null)

      saveState('cart', newCart)
      set({ cart: newCart, ...computeCartTotals(newCart) })
    } catch {
      // Never block the app on a refresh — the cached estimate is harmless and
      // the server-side totals stay authoritative.
      console.warn('[store] Cart price refresh failed — keeping cached prices')
    }
  },
  getCartTotal: () => get().cartTotal,
  getCartCount: () => get().cartCount,

  // Checkout
  checkoutStep: 1,
  setCheckoutStep: (checkoutStep) => set({ checkoutStep }),
  orderPlaced: false,
  setOrderPlaced: (orderPlaced) => set({ orderPlaced }),
  orderId: '',
  generateOrderId: () =>
    set({ orderId: `AT-ORD-${Math.floor(10000 + Math.random() * 90000)}` }),
  orderSummary: null,
  setOrderSummary: (orderSummary) => set({ orderSummary }),
  offerJustSubmitted: false,
  orderSkippedItems: [],
  setOrderSkippedItems: (orderSkippedItems) => set({ orderSkippedItems }),
  cancelRequested: false,
  setCancelRequested: (cancelRequested) => set({ cancelRequested }),
  cancelReason: '',
  setCancelReason: (cancelReason) => set({ cancelReason }),
}))
