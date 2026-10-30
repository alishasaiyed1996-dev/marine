import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Bell,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  FileText,
  HandCoins,
  LogOut,
  Mail,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  ShoppingCart,
  Store,
  Sun,
} from 'lucide-react'
import { useStore } from '../../store/useStore'
import { getAdminBreadcrumb } from './adminNav'
import { useAdminCounts } from './useAdminCounts'

const openCommandPalette = () => {
  window.dispatchEvent(new CustomEvent('admin:open-command'))
}

export function AdminHeader() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const theme = useStore((s) => s.theme)
  const toggleTheme = useStore((s) => s.toggleTheme)
  const adminUser = useStore((s) => s.adminUser)
  const adminLogout = useStore((s) => s.adminLogout)
  const collapsed = useStore((s) => s.adminSidebarCollapsed)
  const toggleSidebar = useStore((s) => s.toggleAdminSidebar)
  const counts = useAdminCounts()

  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const userMenuRef = useRef<HTMLDivElement>(null)
  const notificationsRef = useRef<HTMLDivElement>(null)

  const { section, title } = getAdminBreadcrumb(pathname)
  const role = adminUser?.role || 'owner'
  const canManageSettings = role === 'owner' || role === 'store-manager'

  const notifications = [
    { key: 'orders', label: 'Pending orders', hint: 'Awaiting processing', count: counts.orders, to: '/admin/orders', icon: ShoppingCart },
    { key: 'rfqs', label: 'New RFQs', hint: 'Quotes to answer', count: counts.rfqs, to: '/admin/rfqs', icon: FileText },
    { key: 'offers', label: 'New offers', hint: 'Customer counter-offers', count: counts.offers, to: '/admin/offers', icon: HandCoins },
    { key: 'messages', label: 'Unread messages', hint: 'Contact inbox', count: counts.messages, to: '/admin/messages', icon: Mail },
  ]
  const notificationTotal = notifications.reduce((sum, item) => sum + item.count, 0)

  // Close both popovers on outside click / Escape.
  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (userMenuRef.current && !userMenuRef.current.contains(target)) setUserMenuOpen(false)
      if (notificationsRef.current && !notificationsRef.current.contains(target)) setNotificationsOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setUserMenuOpen(false)
        setNotificationsOpen(false)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  const initials = adminUser?.name
    ?.split(' ')
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || 'AD'

  return (
    <header className="admin-header sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between gap-3 px-3 sm:px-5 lg:px-6">
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <button
          type="button"
          onClick={toggleSidebar}
          className="admin-icon-btn lg:hidden"
          aria-label="Open navigation"
        >
          <Menu size={17} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          onClick={toggleSidebar}
          className="admin-icon-btn hidden lg:inline-flex"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed
            ? <PanelLeftOpen size={17} strokeWidth={1.8} />
            : <PanelLeftClose size={17} strokeWidth={1.8} />}
        </button>

        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm sm:gap-2">
          <span className="hidden text-[var(--text-muted)] sm:inline">Admin</span>
          <ChevronRight size={12} className="hidden shrink-0 text-[var(--text-muted)] opacity-60 sm:block" aria-hidden="true" />
          <span className="hidden text-[var(--text-muted)] md:inline">{section}</span>
          <ChevronRight size={12} className="hidden shrink-0 text-[var(--text-muted)] opacity-60 md:block" aria-hidden="true" />
          <span className="truncate font-bold text-[var(--text-primary)]">{title}</span>
        </nav>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
        <button type="button" onClick={openCommandPalette} className="admin-search-pill" aria-label="Search admin (⌘K)">
          <Search size={14} strokeWidth={1.8} aria-hidden="true" />
          <span className="hidden md:inline">Search admin…</span>
          <kbd className="admin-kbd hidden lg:inline-flex">⌘K</kbd>
        </button>

        <div className="relative" ref={notificationsRef}>
          <button
            type="button"
            onClick={() => {
              setNotificationsOpen((open) => !open)
              setUserMenuOpen(false)
            }}
            className="admin-icon-btn relative"
            aria-label={`Notifications${notificationTotal > 0 ? ` (${notificationTotal} new)` : ''}`}
            aria-expanded={notificationsOpen}
          >
            <Bell size={16} strokeWidth={1.8} />
            {notificationTotal > 0 && (
              <span className="admin-icon-count" aria-hidden="true">
                {notificationTotal > 9 ? '9+' : notificationTotal}
              </span>
            )}
          </button>

          {notificationsOpen && (
            <div className="admin-popover right-0 top-[calc(100%+10px)] w-[min(21rem,calc(100vw-1.5rem))]">
              <div className="admin-popover-head">
                <div>
                  <p className="admin-popover-title">Notifications</p>
                  <p className="admin-popover-sub">
                    {notificationTotal > 0 ? `${notificationTotal} item${notificationTotal === 1 ? '' : 's'} need attention` : 'You are all caught up'}
                  </p>
                </div>
              </div>

              <div className="p-1.5">
                {notificationTotal === 0 ? (
                  <div className="flex flex-col items-center gap-2 px-3 py-6 text-center text-xs text-[var(--text-muted)]">
                    <CheckCircle2 size={20} className="text-[var(--success)]" aria-hidden="true" />
                    No new orders, RFQs, offers or messages.
                  </div>
                ) : notifications.map((item) => {
                  const Icon = item.icon
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => {
                        setNotificationsOpen(false)
                        navigate(item.to)
                      }}
                      className="admin-menu-item justify-between"
                    >
                      <span className="flex min-w-0 items-center gap-2.5">
                        <span className="admin-menu-icon"><Icon size={15} strokeWidth={1.8} /></span>
                        <span className="min-w-0">
                          <span className="block truncate text-xs font-bold text-[var(--text-primary)]">{item.label}</span>
                          <span className="block truncate text-[0.6875rem] text-[var(--text-muted)]">{item.hint}</span>
                        </span>
                      </span>
                      <span className={`admin-nav-badge ${item.key === 'rfqs' ? 'is-danger' : item.key === 'messages' ? 'is-teal' : 'is-gold'} shrink-0`}>
                        {item.count > 99 ? '99+' : item.count}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={toggleTheme}
          className="admin-icon-btn"
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        >
          {theme === 'dark' ? <Sun size={16} strokeWidth={1.8} /> : <Moon size={16} strokeWidth={1.8} />}
        </button>

        <div className="relative" ref={userMenuRef}>
          <button
            type="button"
            onClick={() => {
              setUserMenuOpen((open) => !open)
              setNotificationsOpen(false)
            }}
            className="admin-user-btn"
            aria-expanded={userMenuOpen}
            aria-haspopup="menu"
          >
            <span className="admin-avatar" aria-hidden="true">{initials}</span>
            <span className="hidden min-w-0 flex-col leading-none sm:flex">
              <span className="max-w-[9rem] truncate text-xs font-bold text-[var(--text-primary)]">
                {adminUser?.name || 'Admin'}
              </span>
              <span className="mt-0.5 max-w-[9rem] truncate text-[0.625rem] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
                {role.replace(/-/g, ' ')}
              </span>
            </span>
            <ChevronDown
              size={13}
              className={`hidden shrink-0 text-[var(--text-muted)] transition-transform sm:block ${userMenuOpen ? 'rotate-180' : ''}`}
              aria-hidden="true"
            />
          </button>

          {userMenuOpen && (
            <div className="admin-popover right-0 top-[calc(100%+10px)] w-60" role="menu">
              <div className="admin-popover-head">
                <p className="truncate text-xs font-bold text-[var(--text-primary)]">{adminUser?.name || 'Admin'}</p>
                <p className="truncate text-[0.6875rem] text-[var(--text-muted)]">{adminUser?.email || 'admin@alkatraders.co'}</p>
              </div>
              <div className="p-1.5">
                {canManageSettings && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => { setUserMenuOpen(false); navigate('/admin/settings') }}
                    className="admin-menu-item"
                  >
                    <span className="admin-menu-icon"><Settings size={15} strokeWidth={1.8} /></span>
                    Account settings
                  </button>
                )}
                {role === 'owner' && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => { setUserMenuOpen(false); navigate('/admin/audit-log') }}
                    className="admin-menu-item"
                  >
                    <span className="admin-menu-icon"><ClipboardList size={15} strokeWidth={1.8} /></span>
                    Audit log
                  </button>
                )}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { setUserMenuOpen(false); navigate('/') }}
                  className="admin-menu-item"
                >
                  <span className="admin-menu-icon"><Store size={15} strokeWidth={1.8} /></span>
                  View storefront
                </button>
                <span className="admin-menu-sep" aria-hidden="true" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { setUserMenuOpen(false); adminLogout() }}
                  className="admin-menu-item is-danger"
                >
                  <span className="admin-menu-icon"><LogOut size={15} strokeWidth={1.8} /></span>
                  Sign out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
