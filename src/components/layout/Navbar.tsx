import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  Clock, Globe, HandCoins, Lock, LogIn, LogOut, Mail, Menu, Package,
  Phone, ShoppingCart, Truck, User, UserCircle2, X,
} from 'lucide-react'
import { useStore } from '../../store/useStore'
import { useStoreSettings } from '../../hooks/useStoreSettings'
import { prefetchNavData } from '../../hooks/useApiQuery'
import { ThemeToggle } from '../ui/ThemeToggle'
import { WhatsAppIcon } from '../ui/WhatsAppIcon'
import { useLocale, useLocalizedPath, switchLocalePath } from '../../lib/locale'
import type { Language } from '../../types'

const STATIC_NAV_LINKS = [
  { path: '/', labelKey: 'home' },
  { path: '/products', labelKey: 'products' },
  { path: '/industries', labelKey: 'industries' },
  { path: '/brands', labelKey: 'brands' },
  { path: '/about', labelKey: 'about' },
  { path: '/contact', labelKey: 'contact' },
]

const LANGUAGES: { code: Language; label: string }[] = [
  { code: 'en', label: 'EN' },
  { code: 'ar', label: 'AR' },
  { code: 'es', label: 'ES' },
]

const TRUST_ITEMS = [
  { icon: Truck, labelKey: 'freeShipping' },
  { icon: Clock, labelKey: 'timelyDelivery' },
  { icon: Lock, labelKey: 'securePayment' },
]

/** Shared style for the compact icon buttons in the action cluster. */
const ICON_BTN =
  'nav-icon-btn flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--nav-btn-border)] bg-[var(--nav-btn-bg)] text-[var(--nav-text-muted)] transition-colors hover:border-[var(--nav-btn-hover-border)] hover:text-[var(--nav-text)] focus-visible:outline-2 focus-visible:outline-[var(--accent-primary)]'

function BrandLockup() {
  const locale = useLocale()
  return (
    <Link
      to={`/${locale}/`}
      className="flex items-center gap-3 no-underline transition-opacity hover:opacity-90"
    >
      <img
        src="/images/alka-traders-logo.png"
        alt="Alka Traders Logo"
        width={40}
        height={40}
        className="h-10 w-10 shrink-0 rounded-lg object-cover ring-1 ring-[var(--nav-btn-border)]"
      />
      <span className="flex flex-col leading-none">
        {/* Wordmark hidden below sm: the logo alone + 5 icon buttons (48px
            touch targets) must fit a 320px viewport without overlap. */}
        <span className="hidden font-manrope text-lg font-bold tracking-tight text-[var(--nav-text)] sm:block sm:text-xl">
          Alka Traders
        </span>
        <span className="mt-1 hidden text-[9px] font-semibold uppercase tracking-[2px] text-[var(--nav-text-muted)] sm:block">
          Marine & Industrial Equipment
        </span>
      </span>
    </Link>
  )
}

export function Navbar() {
  const { t } = useTranslation()
  const { pathname, search, hash } = useLocation()
  const navigate = useNavigate()
  const locale = useLocale()
  const localizedPath = useLocalizedPath()
  const [scrolled, setScrolled] = useState(false)
  const [topBarHidden, setTopBarHidden] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [langOpen, setLangOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const setShowCartDrawer = useStore((s) => s.setShowCartDrawer)
  const cartCount = useStore((s) => s.cartCount)
  const language = useStore((s) => s.language)
  const isLoggedIn = useStore((s) => s.isLoggedIn)
  const user = useStore((s) => s.user)
  const logout = useStore((s) => s.logout)
  const setShowAuthModal = useStore((s) => s.setShowAuthModal)
  const settings = useStoreSettings()

  // ── Scroll tracking: shadow + mobile top-bar hide ──────────────
  const lastScrollY = useRef(0)
  const ticking = useRef(false)

  useEffect(() => {
    const handleScroll = () => {
      if (ticking.current) return
      ticking.current = true
      requestAnimationFrame(() => {
        const scrollY = window.scrollY
        setScrolled(scrollY > 32)

        // On mobile: hide the utility bar when scrolling down past the
        // threshold, show it again when scrolling back up. Only kicks in
        // after the user has scrolled enough that the top bar is off-screen
        // anyway — no visible flicker.
        if (window.innerWidth < 1024) {
          const THRESHOLD = 80
          if (scrollY > lastScrollY.current && scrollY > THRESHOLD) {
            setTopBarHidden(true)
          } else if (scrollY < lastScrollY.current) {
            setTopBarHidden(false)
          }
        } else {
          setTopBarHidden(false)
        }

        lastScrollY.current = scrollY
        ticking.current = false
      })
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  useEffect(() => {
    setMobileOpen(false)
    setLangOpen(false)
    setProfileOpen(false)
  }, [pathname])

  // Lock page scroll when the mobile menu is open. Lock the <html> element,
  // NOT <body>: overflow:hidden on body makes body a scroll/clip container,
  // which breaks position:sticky on the header (it would jump to its natural
  // position and scroll out of view). Locking html freezes the viewport
  // without creating a nested scroll container, so the sticky header stays put.
  useEffect(() => {
    if (mobileOpen) {
      document.documentElement.style.overflow = 'hidden'
    } else {
      document.documentElement.style.overflow = ''
    }
    return () => { document.documentElement.style.overflow = '' }
  }, [mobileOpen])

  // Close language and profile dropdowns on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('[data-lang-switcher]')) setLangOpen(false)
      if (!target.closest('[data-profile-menu]')) setProfileOpen(false)
    }
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [])

  // NOTE: this returns ONE sticky <header> wrapper (not a bare nav) on
  // purpose. The wrapper must be a DIRECT child of the page layout's
  // full-height container so position:sticky is constrained to the whole
  // page, not to a short header wrapper — otherwise the header scrolls out
  // of view after ~100px. The wrapper sticks BOTH the utility bar and the
  // main nav, so the email/phone/trust texts stay visible while scrolling.
  return (
    <header className="sticky top-0 z-50">
      {/* ── TOP UTILITY BAR: email/phone · trust indicators ── */}
      <div
        className={`navbar-top-bar border-b border-[var(--header-utility-border)] bg-[var(--header-utility-bg)] pt-[env(safe-area-inset-top)] text-[var(--header-utility-text)]${
          topBarHidden ? ' navbar-top-bar-hidden' : ''
        }`}
      >
        <div className="mx-auto max-w-[1280px] px-4 sm:px-6">
          {/* Desktop / tablet: single 40px row */}
          <div className="hidden h-10 items-center justify-between text-[13px] font-medium sm:flex">
            <div className="flex items-center gap-6 max-[899px]:gap-4">
              <a
                href={`mailto:${settings.rfqEmail}`}
                className="utility-link flex items-center gap-1.5 font-medium text-[var(--header-utility-text)] no-underline transition-colors hover:text-[var(--accent-primary)] max-[899px]:text-xs"
              >
                <Mail size={13} className="shrink-0 text-[var(--accent-primary)]" />
                {settings.rfqEmail}
              </a>
              <a
                href={`tel:${settings.phoneNumber}`}
                className="utility-link flex items-center gap-1.5 font-medium text-[var(--header-utility-text)] no-underline transition-colors hover:text-[var(--accent-primary)] max-[899px]:text-xs"
              >
                <Phone size={13} className="shrink-0 text-[var(--accent-primary)]" />
                {settings.phoneNumber}
              </a>
              {/* 640-767px is too narrow for the full trust row alongside
                  email+phone, but the free-shipping promise always fits and
                  is the headline of this bar — keep it visible at every width. */}
              <span className="hidden min-[640px]:max-[767px]:flex items-center gap-1.5 text-xs whitespace-nowrap">
                <Truck size={12} className="shrink-0 text-[var(--accent-primary)]" />
                {t('topbar.freeShipping')}
              </span>
            </div>
            {/* Trust items compact from 768px — measured minimum width for the
                email+phone row alongside all three trust texts is ~700px in
                every language, so 768px+ fits comfortably. 640-767px keeps
                email+phone only; phones (<640px) get the trust row in the
                compact two-line layout instead. */}
            <div className="hidden min-[768px]:flex items-center gap-5 max-[899px]:gap-1.5">
              {TRUST_ITEMS.map((item, i) => (
                <div key={item.labelKey} className="flex items-center gap-5 max-[899px]:gap-1.5">
                  {i > 0 && <span className="h-3.5 w-px bg-[var(--header-utility-border)] max-[899px]:hidden" aria-hidden="true" />}
                  <span className="flex items-center gap-1.5 whitespace-nowrap max-[899px]:text-[11px]">
                    <item.icon size={13} className="shrink-0 text-[var(--accent-primary)]" />
                    {t(`topbar.${item.labelKey}`)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Mobile: two centered rows */}
          <div className="flex flex-col items-center gap-1 py-2 text-xs font-medium sm:hidden">
            <div className="flex items-center gap-4">
              <a
                href={`mailto:${settings.rfqEmail}`}
                className="utility-link flex items-center gap-1.5 font-medium text-[var(--header-utility-text)] no-underline transition-colors hover:text-[var(--accent-primary)]"
              >
                <Mail size={12} className="shrink-0 text-[var(--accent-primary)]" />
                {settings.rfqEmail}
              </a>
              <a
                href={`tel:${settings.phoneNumber}`}
                className="utility-link flex items-center gap-1.5 font-medium text-[var(--header-utility-text)] no-underline transition-colors hover:text-[var(--accent-primary)]"
              >
                <Phone size={12} className="shrink-0 text-[var(--accent-primary)]" />
                {settings.phoneNumber}
              </a>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 text-[11px]">
              {TRUST_ITEMS.map((item, i) => (
                <span key={item.labelKey} className="flex items-center gap-2.5">
                  {i > 0 && <span className="opacity-40" aria-hidden="true">•</span>}
                  <span className="flex items-center gap-1 whitespace-nowrap">
                    <item.icon size={12} className="shrink-0 text-[var(--accent-primary)]" />
                    {t(`topbar.${item.labelKey}`)}
                  </span>
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── MAIN NAVIGATION ── */}
      <nav
        className={`site-header relative border-b border-[var(--header-border)] bg-[var(--header-bg)] backdrop-blur-[24px] backdrop-saturate-150 transition-shadow duration-300 ${
          scrolled ? 'shadow-[0_6px_24px_rgba(0,0,0,0.16)]' : 'shadow-[0_1px_3px_rgba(0,0,0,0.04)]'
        }${
          topBarHidden ? ' border-t border-t-[var(--header-utility-border)]' : ''
        }`}
      >
        <div className="mx-auto flex max-w-[1280px] items-center justify-between gap-5 px-4 py-3 sm:px-6">
          <BrandLockup />

          {/* Centered desktop links */}
          <div className="hidden items-center gap-7 lg:flex">
            {STATIC_NAV_LINKS.map((link) => {
              const localizedTo = localizedPath(link.path)
              const isActive =
                pathname === localizedTo ||
                (localizedTo !== `/${locale}` && pathname.startsWith(localizedTo))
              return (
                <Link
                  key={link.path}
                  to={localizedTo}
                  onMouseEnter={() => prefetchNavData(link.path)}
                  className={`group relative text-sm font-semibold no-underline transition-colors ${
                    isActive ? 'text-[var(--accent-primary)]' : 'text-[var(--nav-text-muted)] hover:text-[var(--nav-text)]'
                  }`}
                >
                  {/* Rounded hover pill — absolutely positioned, so hovering
                      never shifts the layout. It hugs the link (8px each side)
                      instead of painting an oversized rectangle. */}
                  <span
                    className="absolute inset-y-0 -left-2 -right-2 rounded-lg bg-[var(--surface-soft)] opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100"
                    aria-hidden="true"
                  />
                  <span className="relative">{t(`nav.${link.labelKey}`)}</span>
                  {isActive && (
                    <span className="absolute -bottom-1.5 left-0 right-0 h-0.5 rounded-full bg-[var(--accent-primary)]" aria-hidden="true" />
                  )}
                </Link>
              )
            })}
          </div>

          {/* Right action cluster */}
          <div className="flex items-center gap-2">
            {/* Language switcher (hidden on <380px so the action cluster fits
                a 320px viewport; still reachable inside the mobile menu) */}
            <div className="relative max-[380px]:hidden" data-lang-switcher>
              <button
                onClick={() => setLangOpen((v) => !v)}
                className={ICON_BTN}
                aria-label="Switch language"
              >
                <Globe size={16} />
              </button>
              {langOpen && (
                <div className="absolute right-0 top-full mt-2 w-28 overflow-hidden rounded-xl border border-[var(--nav-dropdown-border)] bg-[var(--nav-dropdown-bg)] shadow-2xl z-50">
                  {LANGUAGES.map((lang) => (
                    <button
                      key={lang.code}
                      onClick={() => {
                        navigate(switchLocalePath(pathname, lang.code, search, hash))
                        setLangOpen(false)
                      }}
                      className={`flex w-full items-center gap-2 px-4 py-2.5 text-left text-xs font-bold transition-colors hover:bg-[var(--surface-soft)] ${
                        language === lang.code ? 'text-[var(--accent-primary)]' : 'text-[var(--nav-text-muted)]'
                      }`}
                    >
                      {language === lang.code && (
                        <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-primary)]" />
                      )}
                      {lang.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <ThemeToggle />

            {/* Cart */}
            <button
              onClick={() => setShowCartDrawer(true)}
              className={`${ICON_BTN} relative`}
              aria-label="Cart"
            >
              <ShoppingCart size={18} />
              {cartCount > 0 && (
                <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[var(--accent-primary)] px-1 text-xs font-bold leading-none text-[var(--btn-blue-text)]">
                  {cartCount > 99 ? '99+' : cartCount}
                </span>
              )}
            </button>

            {/* WhatsApp — hidden below xl: at 1024-1279px the cluster (lang +
                theme + cart + whatsapp + RFQ CTA + profile) is ~13px wider than
                the viewport, clipping the profile button (iPad Pro portrait).
                WhatsApp stays reachable in the mobile menu and utility bar. */}
            <a
              href={`https://wa.me/${settings.whatsappNumber}`}
              target="_blank"
              rel="noopener noreferrer"
              className={`${ICON_BTN} hidden xl:flex`}
              aria-label={`WhatsApp ${settings.phoneNumber}`}
            >
              <WhatsAppIcon size={18} />
            </a>

            {/* Request Quote (primary CTA) */}
            <Link
              to={localizedPath('/rfq')}
              className="hidden items-center rounded-lg bg-[var(--accent-primary)] px-5 py-2.5 text-sm font-semibold text-[var(--btn-blue-text)] no-underline transition-colors hover:bg-[var(--accent-primary-hover)] focus-visible:outline-2 focus-visible:outline-[var(--accent-primary)] lg:inline-flex"
            >
              {t('nav.requestQuote')}
            </Link>

            {/* Profile / Auth */}
            <div className="relative" data-profile-menu>
              <button
                onClick={() => setProfileOpen((v) => !v)}
                className={`${ICON_BTN} ${
                  isLoggedIn
                    ? 'nav-icon-btn-accent border-[var(--accent-primary)]/40 bg-[var(--accent-primary)]/10 text-[var(--accent-primary)] hover:text-[var(--accent-primary-hover)]'
                    : ''
                }`}
                aria-label="Profile"
              >
                <UserCircle2 size={20} />
              </button>
              {profileOpen && (
                <div className="absolute right-0 top-full mt-2 w-52 overflow-hidden rounded-xl border border-[var(--nav-dropdown-border)] bg-[var(--nav-dropdown-bg)] shadow-2xl z-50">
                  {isLoggedIn ? (
                    <>
                      <div className="border-b border-[var(--border)] bg-[var(--surface-soft)] px-4 py-3">
                        <p className="truncate text-xs font-bold text-[var(--text-primary)]">{user?.name || 'My Account'}</p>
                        <p className="mt-0.5 truncate text-[11px] text-[var(--text-muted)]">{user?.email || ''}</p>
                      </div>
                      <Link
                        to={localizedPath('/account/profile')}
                        onClick={() => setProfileOpen(false)}
                        className="flex items-center gap-3 px-4 py-2.5 text-xs font-semibold text-[var(--nav-text-muted)] no-underline transition-colors hover:bg-[var(--surface-soft)] hover:text-[var(--nav-text)]"
                      >
                        <User size={14} className="text-[var(--text-muted)]" /> My Profile
                      </Link>
                      <Link
                        to={localizedPath('/account/orders')}
                        onClick={() => setProfileOpen(false)}
                        className="flex items-center gap-3 px-4 py-2.5 text-xs font-semibold text-[var(--nav-text-muted)] no-underline transition-colors hover:bg-[var(--surface-soft)] hover:text-[var(--nav-text)]"
                      >
                        <Package size={14} className="text-[var(--text-muted)]" /> My Orders
                      </Link>
                      <Link
                        to={localizedPath('/account/offers')}
                        onClick={() => setProfileOpen(false)}
                        className="flex items-center gap-3 px-4 py-2.5 text-xs font-semibold text-[var(--nav-text-muted)] no-underline transition-colors hover:bg-[var(--surface-soft)] hover:text-[var(--nav-text)]"
                      >
                        <HandCoins size={14} className="text-[var(--text-muted)]" /> My Offers
                      </Link>
                      <div className="border-t border-[var(--border)]">
                        <button
                          onClick={() => { logout(); setProfileOpen(false) }}
                          className="flex w-full items-center gap-3 px-4 py-2.5 text-xs font-semibold text-[var(--danger)] transition-colors hover:bg-[var(--surface-soft)]"
                        >
                          <LogOut size={14} /> Sign Out
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="border-b border-[var(--border)] bg-[var(--surface-soft)] px-4 py-3">
                        <p className="text-xs font-bold text-[var(--text-primary)]">Welcome</p>
                        <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">Sign in to access your account</p>
                      </div>
                      <button
                        onClick={() => { setShowAuthModal(true); setProfileOpen(false) }}
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-xs font-semibold text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-soft)]"
                      >
                        <LogIn size={14} className="text-[var(--accent-primary)]" /> Sign In
                      </button>
                      <button
                        onClick={() => { setShowAuthModal(true); setProfileOpen(false) }}
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-xs font-semibold text-[var(--accent-primary)] transition-colors hover:bg-[var(--surface-soft)]"
                      >
                        <UserCircle2 size={14} /> Create Account
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Mobile menu toggle */}
            <button
              onClick={() => setMobileOpen((value) => !value)}
              className={`${ICON_BTN} lg:hidden`}
              aria-label="Toggle menu"
              aria-expanded={mobileOpen}
            >
              {mobileOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        <div
          className={`absolute left-0 right-0 top-full z-50 border-b border-[var(--header-border)] bg-[var(--header-bg)] px-5 py-4 shadow-2xl backdrop-blur-[24px] backdrop-saturate-150 transition-all duration-300 ease-in-out lg:hidden ${
            mobileOpen ? 'translate-y-0 opacity-100' : 'pointer-events-none -translate-y-2 opacity-0'
          }`}
          style={{
            // The menu drops below the FULL sticky header (utility bar + nav),
            // so keep a comfortable bottom margin and reserve room for the iOS
            // home indicator — otherwise the last items sit under it.
            maxHeight: mobileOpen
              ? (topBarHidden
                  ? 'calc(100dvh - 52px - 2.5rem - env(safe-area-inset-bottom, 0px))'
                  : 'calc(100dvh - var(--hero-header-offset) - 2.5rem - env(safe-area-inset-bottom, 0px))')
              : '0',
            overflowY: mobileOpen ? 'auto' : 'hidden',
            overscrollBehavior: 'contain',
          }}
        >
          <div className="mx-auto flex max-w-[1280px] flex-col gap-3">
            {STATIC_NAV_LINKS.map((link) => {
              const localizedTo = localizedPath(link.path)
              const isActive = pathname === localizedTo
              return (
                <Link
                  key={link.path}
                  to={localizedTo}
                  className={`rounded-lg px-3 py-2 text-sm font-bold no-underline transition-colors ${
                    isActive ? 'bg-[var(--surface-soft)] text-[var(--accent-primary)]' : 'text-[var(--nav-text-muted)] hover:bg-[var(--surface-soft)] hover:text-[var(--nav-text)]'
                  }`}
                >
                  {t(`nav.${link.labelKey}`)}
                </Link>
              )
            })}
            <div className="mt-1 border-t border-[var(--border)] pt-3">
              <span className="mb-2 block text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                {t('nav.language')}
              </span>
              <div className="flex gap-2">
                {LANGUAGES.map((lang) => (
                  <button
                    key={lang.code}
                    onClick={() => navigate(switchLocalePath(pathname, lang.code, search, hash))}
                    className={`rounded-lg border px-3 py-2 text-xs font-bold transition-colors ${
                      language === lang.code
                        ? 'border-[var(--accent-primary)]/50 bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]'
                        : 'border-[var(--border)] text-[var(--nav-text-muted)] hover:border-[var(--accent-primary)]'
                    }`}
                  >
                    {lang.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 pt-2">
              <a
                href={`https://wa.me/${settings.whatsappNumber}`}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-4 py-3 text-xs font-bold text-[var(--text-primary)] no-underline transition-colors hover:border-[var(--accent-primary)]"
              >
                <WhatsAppIcon size={14} /> WhatsApp
              </a>
              <a
                href={`tel:${settings.phoneNumber}`}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-4 py-3 text-xs font-bold text-[var(--text-primary)] no-underline transition-colors hover:border-[var(--accent-primary)]"
              >
                <Phone size={14} /> Call
              </a>
            </div>
            <div className="mt-1 border-t border-[var(--border)] pt-3">
              {isLoggedIn ? (
                <div className="flex flex-col gap-1">
                  <div className="rounded-lg bg-[var(--surface-soft)] px-3 py-2">
                    <p className="truncate text-xs font-bold text-[var(--text-primary)]">{user?.name || 'My Account'}</p>
                    <p className="truncate text-[11px] text-[var(--text-muted)]">{user?.email || ''}</p>
                  </div>
                  <Link
                    to={localizedPath('/account/profile')}
                    onClick={() => setMobileOpen(false)}
                    className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold text-[var(--nav-text-muted)] no-underline transition-colors hover:bg-[var(--surface-soft)] hover:text-[var(--nav-text)]"
                  >
                    <User size={13} /> My Profile
                  </Link>
                  <Link
                    to={localizedPath('/account/orders')}
                    onClick={() => setMobileOpen(false)}
                    className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold text-[var(--nav-text-muted)] no-underline transition-colors hover:bg-[var(--surface-soft)] hover:text-[var(--nav-text)]"
                  >
                    <Package size={13} /> My Orders
                  </Link>
                  <button
                    onClick={() => { logout(); setMobileOpen(false) }}
                    className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold text-[var(--danger)] transition-colors hover:bg-[var(--surface-soft)]"
                  >
                    <LogOut size={13} /> Sign Out
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => { setShowAuthModal(true); setMobileOpen(false) }}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--accent-primary)]/40 bg-[var(--accent-primary)]/10 px-4 py-3 text-xs font-bold text-[var(--accent-primary)] transition-colors hover:bg-[var(--accent-primary)]/20"
                >
                  <UserCircle2 size={15} /> Sign In / Create Account
                </button>
              )}
            </div>
            <Link
              to={localizedPath('/rfq')}
              onClick={() => setMobileOpen(false)}
              className="inline-flex items-center justify-center rounded-lg bg-[var(--accent-primary)] px-5 py-3 text-xs font-bold text-[var(--btn-blue-text)] no-underline transition-colors hover:bg-[var(--accent-primary-hover)]"
            >
              {t('nav.requestQuote')}
            </Link>
          </div>
        </div>
      </nav>
    </header>
  )
}
