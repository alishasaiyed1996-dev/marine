import { useEffect, useMemo, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import {
  ChevronDown,
  ChevronRight,
  LogOut,
  Search,
  Store,
} from 'lucide-react'
import { useStore } from '../../store/useStore'
import { useAdminCounts, type AdminCounts } from './useAdminCounts'
import { ADMIN_NAV_GROUPS, canSeeAdminNavItem, type AdminNavGroup, type AdminNavItem } from './adminNav'

const OPEN_GROUPS_KEY = 'admin-nav-open-v1'

type BadgeKey = keyof AdminCounts

/** '/admin/ebay' stays active on its nested routes (/admin/ebay/...). */
function isItemActive(pathname: string, item: AdminNavItem): boolean {
  if (item.exact) return pathname === item.to
  if (item.to === '/admin/ebay') return pathname === '/admin/ebay' || pathname.startsWith('/admin/ebay/')
  return pathname === item.to || pathname.startsWith(`${item.to}/`)
}

function badgeTone(key: BadgeKey): string {
  if (key === 'rfqs') return 'is-danger'
  if (key === 'messages') return 'is-teal'
  return 'is-gold'
}

function readOpenGroups(): Record<string, boolean> {
  const open = Object.fromEntries(ADMIN_NAV_GROUPS.map((group) => [group.id, true]))
  try {
    const raw = window.localStorage.getItem(OPEN_GROUPS_KEY)
    if (!raw) return open
    const parsed = JSON.parse(raw) as Record<string, unknown>
    for (const group of ADMIN_NAV_GROUPS) {
      if (typeof parsed[group.id] === 'boolean') open[group.id] = parsed[group.id] as boolean
    }
  } catch {
    // Storage can be unavailable (private mode / quota) — defaults are fine.
  }
  return open
}

function NavRow({ item, counts, collapsed }: { item: AdminNavItem; counts: AdminCounts; collapsed: boolean }) {
  const { pathname } = useLocation()
  const active = isItemActive(pathname, item)
  const Icon = item.icon
  const count = item.badgeKey ? counts[item.badgeKey] : 0

  return (
    <NavLink
      to={item.to}
      end={item.exact}
      title={collapsed ? item.label : undefined}
      aria-current={active ? 'page' : undefined}
      onClick={() => {
        // On mobile the sidebar is a drawer: navigating closes it.
        if (typeof window !== 'undefined' && window.innerWidth < 1024) {
          useStore.setState({ adminSidebarCollapsed: true })
        }
      }}
      className={`admin-nav-item ${active ? 'is-active' : ''} ${collapsed ? 'is-rail' : ''}`}
    >
      <span className="admin-nav-icon">
        <Icon size={17} strokeWidth={1.8} />
      </span>
      {!collapsed && <span className="admin-nav-label">{item.label}</span>}
      {count > 0 && !collapsed && (
        <span className={`admin-nav-badge ${badgeTone(item.badgeKey as BadgeKey)}`}>
          {count > 99 ? '99+' : count}
        </span>
      )}
      {count > 0 && collapsed && (
        <span className={`admin-nav-dot ${badgeTone(item.badgeKey as BadgeKey)}`} aria-hidden="true" />
      )}
    </NavLink>
  )
}

function NavGroupBlock({ group, counts }: { group: AdminNavGroup; counts: AdminCounts }) {
  const { pathname } = useLocation()
  const [open, setOpen] = useState<Record<string, boolean>>(readOpenGroups)
  const activeHere = group.items.some((item) => isItemActive(pathname, item))
  // The group holding the current page stays open even if it was collapsed
  // earlier — otherwise the active row would be invisible.
  const expanded = open[group.id] !== false || activeHere

  const toggle = () => {
    setOpen((prev) => {
      const next = { ...prev, [group.id]: !(prev[group.id] !== false) }
      try {
        window.localStorage.setItem(OPEN_GROUPS_KEY, JSON.stringify(next))
      } catch {
        // Persisting is a nicety; ignore storage failures.
      }
      return next
    })
  }

  return (
    <div className="admin-nav-group">
      <button type="button" onClick={toggle} className="admin-nav-group-toggle" aria-expanded={expanded}>
        <span>{group.label}</span>
        <ChevronDown
          size={12}
          strokeWidth={2}
          className={`admin-nav-group-chevron ${expanded ? 'is-open' : ''}`}
          aria-hidden="true"
        />
      </button>
      <div className={`admin-nav-group-items ${expanded ? 'is-open' : ''}`}>
        <div className="admin-nav-group-inner">
          {group.items.map((item) => (
            <NavRow key={item.to} item={item} counts={counts} collapsed={false} />
          ))}
        </div>
      </div>
    </div>
  )
}

function BrandCard({ collapsed }: { collapsed: boolean }) {
  const adminUser = useStore((s) => s.adminUser)
  const role = (adminUser?.role || 'owner').replace(/-/g, ' ')

  return (
    <Link to="/admin" className="admin-brand-link" title={collapsed ? 'Alka Traders admin' : undefined}>
      <span className="admin-brand-mark" aria-hidden="true">AT</span>
      {!collapsed && (
        <span className="admin-brand-text">
          <span className="admin-brand-name">Alka Traders</span>
          <span className="admin-brand-role">{role}</span>
        </span>
      )}
      {!collapsed && <ChevronRight size={14} className="admin-brand-chevron" aria-hidden="true" />}
    </Link>
  )
}

export function AdminSidebar() {
  const collapsed = useStore((s) => s.adminSidebarCollapsed)
  const toggleSidebar = useStore((s) => s.toggleAdminSidebar)
  const adminLogout = useStore((s) => s.adminLogout)
  const adminUser = useStore((s) => s.adminUser)
  const counts = useAdminCounts()

  const groups = useMemo(
    () => ADMIN_NAV_GROUPS
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => canSeeAdminNavItem(item, adminUser?.role)),
      }))
      .filter((group) => group.items.length > 0),
    [adminUser?.role],
  )

  // The drawer overlays the page on phones — stop the page behind it scrolling.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.innerWidth >= 1024 || collapsed) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [collapsed])

  return (
    <>
      {!collapsed && (
        <div className="admin-sidebar-overlay lg:hidden" onClick={toggleSidebar} role="presentation" />
      )}

      <aside
        className={`admin-sidebar ${collapsed ? 'is-rail' : ''}`}
        aria-label="Admin navigation"
      >
        <BrandCard collapsed={collapsed} />

        <div className="admin-nav-search">
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('admin:open-command'))}
            className={`admin-search-trigger ${collapsed ? 'is-rail' : ''}`}
            title={collapsed ? 'Search admin (⌘K)' : undefined}
            aria-label="Search admin"
          >
            <Search size={15} strokeWidth={1.8} aria-hidden="true" />
            {!collapsed && (
              <>
                <span className="admin-search-text">Search admin…</span>
                <kbd className="admin-kbd">⌘K</kbd>
              </>
            )}
          </button>
        </div>

        <nav className="admin-nav-scroll">
          {collapsed
            ? groups.map((group) => (
                <div key={group.id} className="admin-nav-rail-group">
                  <span className="admin-nav-rail-sep" aria-hidden="true" />
                  {group.items.map((item) => (
                    <NavRow key={item.to} item={item} counts={counts} collapsed />
                  ))}
                </div>
              ))
            : groups.map((group) => <NavGroupBlock key={group.id} group={group} counts={counts} />)}
        </nav>

        <div className="admin-sidebar-footer">
          <NavLink to="/" title={collapsed ? 'View storefront' : undefined} className="admin-nav-item">
            <span className="admin-nav-icon"><Store size={17} strokeWidth={1.8} /></span>
            {!collapsed && <span className="admin-nav-label">View storefront</span>}
          </NavLink>
          <button
            type="button"
            onClick={adminLogout}
            className="admin-nav-item admin-nav-item-danger"
            title={collapsed ? 'Sign out' : undefined}
          >
            <span className="admin-nav-icon"><LogOut size={17} strokeWidth={1.8} /></span>
            {!collapsed && <span className="admin-nav-label">Sign out</span>}
          </button>
        </div>
      </aside>
    </>
  )
}
