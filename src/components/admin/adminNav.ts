/**
 * Single source of truth for the admin panel's navigation.
 *
 * The sidebar, the ⌘K palette and the header breadcrumb all read from here so
 * a route can never exist in one place and be missing in another. Role rules
 * mirror `AdminSidebar`'s historical `canView` behaviour and the backend's
 * `requireRole` hierarchy.
 */
import type { LucideIcon } from 'lucide-react'
import {
  Activity,
  Award,
  BarChart3,
  ClipboardList,
  Factory,
  FileText,
  FolderTree,
  HandCoins,
  ImageIcon,
  LayoutDashboard,
  Mail,
  Package,
  Settings,
  Shield,
  ShoppingCart,
  Users,
} from 'lucide-react'

/** Roles allowed to see a nav item. Omitted = every admin role. */
export type AdminRole =
  | 'owner'
  | 'store-manager'
  | 'inventory-manager'
  | 'sales-agent'
  | 'content-manager'
  | 'viewer'

export interface AdminNavItem {
  to: string
  label: string
  icon: LucideIcon
  /** Count source rendered as a pill by the sidebar. */
  badgeKey?: 'orders' | 'rfqs' | 'messages'
  /** Exact pathname match (only the Dashboard needs this). */
  exact?: boolean
  /** Extra search words for the command palette. */
  keywords?: string
  roles?: AdminRole[]
}

export interface AdminNavGroup {
  id: string
  label: string
  items: AdminNavItem[]
}

const OWNER: AdminRole[] = ['owner']
const SETTINGS: AdminRole[] = ['owner', 'store-manager']
const CATALOG_EDITORS: AdminRole[] = ['owner', 'store-manager', 'inventory-manager']

export const ADMIN_NAV_GROUPS: AdminNavGroup[] = [
  {
    id: 'overview',
    label: 'Overview',
    items: [
      { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, exact: true, keywords: 'home overview stats' },
      { to: '/admin/insights', label: 'Insights', icon: BarChart3, keywords: 'analytics revenue reports' },
    ],
  },
  {
    id: 'catalog',
    label: 'Catalog',
    items: [
      { to: '/admin/products', label: 'Products', icon: Package, keywords: 'inventory items sku price stock' },
      { to: '/admin/media', label: 'Media Library', icon: ImageIcon, keywords: 'images photos upload', roles: CATALOG_EDITORS },
      { to: '/admin/categories', label: 'Categories', icon: FolderTree, keywords: 'taxonomy grouping', roles: CATALOG_EDITORS },
      { to: '/admin/brands', label: 'Brands', icon: Award, keywords: 'manufacturers suppliers', roles: CATALOG_EDITORS },
      { to: '/admin/industries', label: 'Industries', icon: Factory, keywords: 'sectors markets', roles: CATALOG_EDITORS },
    ],
  },
  {
    id: 'operations',
    label: 'Operations',
    items: [
      { to: '/admin/orders', label: 'Orders', icon: ShoppingCart, badgeKey: 'orders', keywords: 'purchases sales shipping' },
      { to: '/admin/rfqs', label: 'RFQs', icon: FileText, badgeKey: 'rfqs', keywords: 'quotes requests' },
      { to: '/admin/offers', label: 'Offers', icon: HandCoins, keywords: 'negotiation bids' },
      { to: '/admin/ebay', label: 'eBay Hub', icon: Activity, keywords: 'marketplace sync listings mirror inventory import images quantities' },
    ],
  },
  {
    id: 'people',
    label: 'People',
    items: [
      { to: '/admin/customers', label: 'Customers', icon: Users, keywords: 'clients contacts accounts' },
      { to: '/admin/messages', label: 'Messages', icon: Mail, badgeKey: 'messages', keywords: 'inbox contact email' },
    ],
  },
  {
    id: 'system',
    label: 'System',
    items: [
      { to: '/admin/settings', label: 'Store Settings', icon: Settings, keywords: 'config shipping payments', roles: SETTINGS },
      { to: '/admin/users', label: 'Users & Roles', icon: Shield, keywords: 'team permissions staff', roles: OWNER },
      { to: '/admin/audit-log', label: 'Audit Log', icon: ClipboardList, keywords: 'history activity security', roles: OWNER },
    ],
  },
]

/** True when `role` may see the item (defaults to owner for unknown values). */
export function canSeeAdminNavItem(item: AdminNavItem, role: string | undefined): boolean {
  if (!item.roles) return true
  return item.roles.includes((role || 'owner') as AdminRole)
}

/** Flat list of every visible nav item, in sidebar order. */
export function visibleAdminNavItems(role: string | undefined): AdminNavItem[] {
  return ADMIN_NAV_GROUPS.flatMap((group) => group.items).filter((item) => canSeeAdminNavItem(item, role))
}

/** Section + title for the header breadcrumb. */
export function getAdminBreadcrumb(pathname: string): { section: string; title: string } {
  if (pathname === '/admin/products/new') return { section: 'Catalog', title: 'New Product' }
  if (/^\/admin\/products\/[^/]+\/edit$/.test(pathname)) return { section: 'Catalog', title: 'Edit Product' }
  if (pathname === '/admin') return { section: 'Overview', title: 'Dashboard' }

  for (const group of ADMIN_NAV_GROUPS) {
    for (const item of group.items) {
      if (pathname === item.to) return { section: group.label, title: item.label }
    }
  }
  // Longest prefix wins when several items match a nested admin route.
  const matches = ADMIN_NAV_GROUPS.flatMap((group) =>
    group.items.map((item) => ({ group, item })),
  )
    .filter(({ item }) => pathname.startsWith(`${item.to}/`))
    .sort((a, b) => b.item.to.length - a.item.to.length)
  if (matches.length > 0) {
    const { group, item } = matches[0]
    return { section: group.label, title: item.label }
  }
  return { section: 'Admin', title: 'Dashboard' }
}
