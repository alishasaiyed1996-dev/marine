/**
 * Shared canonical types for Alka Traders.
 *
 * These are the "API contract" types that both frontend and backend agree on.
 * They mirror the Prisma models and are the canonical source of truth for
 * API response shapes. Use these instead of duplicating types.
 *
 * The frontend's own simplified UI types (src/types/index.ts) build on top
 * of these via the adapter layer (src/lib/adapters.ts).
 */

// ─── Product ───────────────────────────────────────────────────

export interface ProductImage {
  id: string
  url: string
  altText?: string | null
  alt?: string | null
  label?: string | null
  isMain: boolean
  sortOrder: number
}

export interface ProductSpec {
  id?: string
  name: string
  value: string
  sortOrder?: number
  isPublic?: boolean
}

export interface Product {
  id: string
  slug: string
  name: string
  sku: string
  brandId?: string | null
  categoryId?: string | null
  industryId?: string | null
  status: string
  availability: string
  condition: string
  shortDescription?: string | null
  description?: string | null
  regularPrice: number
  salePrice?: number | null
  saleStartsAt?: string | null
  saleEndsAt?: string | null
  currency: string
  showPrice: boolean
  makeOfferEnabled: boolean
  makeOffer?: boolean
  minimumOfferPrice?: number | null
  stockCount: number
  lowStockThreshold: number
  warehouseLocation?: string | null
  publicItemLocation?: string | null
  leadTime?: string | null
  isNewArrival: boolean
  isFeatured: boolean
  customLabel?: string | null
  customLabelColor?: string | null
  sortPriority: number
  seoTitle?: string | null
  seoDescription?: string | null
  contentUpdatedAt?: string | null
  ogImageUrl?: string | null
  keyFeatures?: string[]
  compatibilityNotes?: string
  warrantyNotes?: string
  conditionNotes?: string
  includedItems?: string[]
  excludedItems?: string[]
  seoKeywords?: string[]
  searchKeywords?: string[]
  internalNotes?: string
  // ── Product identity (SEO / Merchant Center truth model) ──
  // NULL/undefined = unknown, never guessed. Verified data feeds titles,
  // JSON-LD, and the Merchant feed; unknown fields are simply omitted.
  manufacturer?: string | null
  modelNumber?: string | null
  mpn?: string | null
  gtin?: string | null
  impaCode?: string | null
  sourceUrl?: string | null
  lastVerifiedAt?: string | null
  createdAt?: string | null
  updatedAt?: string | null
  // Relations
  brand?: { id: string; name: string; slug: string } | null
  category?: { id: string; name: string; slug: string } | null
  images: ProductImage[]
  specs: ProductSpec[]
  industries: { industry: { id: string; name: string; slug: string } }[]
  industryIds?: string[]
  // Computed
  price?: number
  onSale?: boolean
  inStock?: boolean
}

// ─── Brand ─────────────────────────────────────────────────────

export interface Brand {
  id: string
  name: string
  slug: string
  logoUrl?: string | null
  sectors?: string[]
  description?: string | null
  website?: string | null
  country?: string | null
  seoTitle?: string | null
  seoDescription?: string | null
  isVisible?: boolean
  sortOrder?: number
  createdAt?: string | null
  _count?: { products: number }
  productCount?: number
}

// ─── Category ──────────────────────────────────────────────────

export interface Category {
  id: string
  name: string
  slug: string
  description?: string | null
  parentId?: string | null
  icon?: string | null
  seoTitle?: string | null
  seoDescription?: string | null
  sortOrder?: number
  isVisible?: boolean
  createdAt?: string | null
  _count?: { products: number }
  productCount?: number
}

// ─── Industry ──────────────────────────────────────────────────

export interface Industry {
  id: string
  name: string
  slug: string
  icon?: string | null
  description?: string | null
  painPoints?: string[]
  seoTitle?: string | null
  seoDescription?: string | null
  sortOrder?: number
  isVisible?: boolean
  createdAt?: string | null
  _count?: { products: number }
  productCount?: number
}

// ─── Order ─────────────────────────────────────────────────────

export interface OrderItem {
  id: string
  productId?: string | null
  productName: string
  productSku?: string | null
  quantity: number
  unitPrice: number
  totalPrice: number
  price?: number
  sku?: string
  product?: { name: string; sku: string } | null
}

export interface OrderTimeline {
  id: string
  status: string
  note?: string | null
  createdBy?: string | null
  createdAt: string
}

export interface Order {
  id: string
  orderNumber: string
  customerId?: string | null
  status: string
  paymentMethod?: string | null
  paymentStatus: string
  subtotal: number
  shippingCost: number
  shipping: { fullName: string; city: string; country: string }
  tax: number
  total: number
  grandTotal: number
  currency: string
  shippingFullName?: string | null
  shippingAddressLine1?: string | null
  shippingAddressLine2?: string | null
  shippingCity?: string | null
  shippingState?: string | null
  shippingPostalCode?: string | null
  shippingCountry?: string | null
  shippingEmail?: string | null
  trackingNumber?: string | null
  courier?: string | null
  customerNotes?: string | null
  cancelRequested?: boolean
  cancelReason?: string | null
  paymentIntentId?: string | null
  // Accepted-offer provenance — null/undefined for regular checkout orders.
  offerId?: string | null
  originalListedPrice?: number | null
  negotiatedPrice?: number | null
  createdAt: string
  updatedAt?: string | null
  // Relations
  items: OrderItem[]
  orderItems?: OrderItem[]
  timeline?: OrderTimeline[]
  customer?: { id: string; name: string; email: string; company?: string | null } | null
}

// ─── RFQ ───────────────────────────────────────────────────────

export interface RfqNote {
  id: string
  note: string
  isInternal: boolean
  createdAt: string
  author?: { id?: string; name: string; email?: string | null } | null
}

export interface Rfq {
  id: string
  rfqNumber: string
  fullName: string
  company?: string | null
  email: string
  phone?: string | null
  country?: string | null
  role?: string | null
  productDescription: string
  partNumber?: string | null
  brand?: string | null
  quantity?: number | null
  deliveryLocation?: string | null
  urgency: string
  subject?: string | null
  // `notes` is a free-text field on the storefront create payload, but the
  // admin GET responses return the RfqNote relation under the same key.
  notes?: string | RfqNote[] | null
  source?: string | null
  consent?: boolean
  status: string
  customer?: { id: string; name: string; email: string; phone?: string | null } | null
  assignedTo?: string | null
  assignee?: { id: string; name: string; email?: string | null } | null
  items?: Array<{ id: string; productName: string; quantity?: number | null; unit?: string | null; notes?: string | null }> | null
  rfqNotes?: RfqNote[] | null
  internalNotes?: string | null
  responseDeadline?: string | null
  firstResponseAt?: string | null
  createdAt: string
  updatedAt?: string | null
}


// ─── Offer ─────────────────────────────────────────────────────

export interface OfferItem {
  id: string
  productId?: string | null
  productName?: string | null
  quantity?: number | null
  unitPrice?: number | null
  price?: number | null
  sku?: string | null
}

export interface Offer {
  id: string
  offerNumber?: string | null
  productId?: string | null
  customerEmail: string
  offeredPrice: number
  counterPrice?: number | null
  /** The negotiated price actually payable (set at acceptance: counter ?? offered). */
  acceptedPrice?: number | null
  message?: string | null
  status: string
  quantity?: number | null
  adminNotes?: string | null
  expiresAt?: string | null
  acceptedAt?: string | null
  respondedAt?: string | null
  createdAt: string
  updatedAt?: string | null
  /** Order created for this offer's payment (accepted-offer PayPal flow). */
  orderId?: string | null
  order?: { id: string; orderNumber: string; status: string; paymentStatus: string; total?: number | null; currency?: string | null } | null
  product?: { id?: string; slug?: string; name: string; sku: string; regularPrice: number; images?: { url: string; altText?: string | null; isMain?: boolean; sortOrder?: number }[] } | null
  customer?: { id: string; name: string; company?: string | null; country?: string | null } | null
  // Relation returned by offerAdminService (nesting lives here, not at the top level).
  rfq?: { id: string; rfqNumber: string } | null
  items?: OfferItem[]
  rfqNumber?: string | null
  rfqId?: string | null
  company?: string | null
  customerCompany?: string | null
  country?: string | null
  customerCountry?: string | null
  subject?: string | null
  subtotal?: number | null
  shipping?: number | null
  total?: number | null
  grandTotal?: number | null
  currency?: string | null
  validUntil?: string | null
  notes?: string | null
  terms?: string | null
}

// ─── Customer ──────────────────────────────────────────────────

export interface Customer {
  id: string
  name: string
  email: string
  phone?: string | null
  company?: string | null
  country?: string | null
  city?: string | null
  address?: string | null
  website?: string | null
  status?: string
  lastLoginAt?: string | null
  lastOrderAt?: string | null
  totalSpent?: number | null
  tags?: string[]
  notes?: string | null
  internalNotes?: string | null
  createdAt: string
  _count?: {
    orders?: number
    rfqs?: number
  }
  orders?: Array<{
    id: string
    orderNumber?: string
    total?: number
    status?: string
    createdAt: string
    _count?: { items?: number }
  }>
}

// ─── Message (Contact Form) ────────────────────────────────────

export interface Message {
  id: string
  name: string
  email: string
  subject?: string | null
  message: string
  status?: string
  from?: string | null
  fromName?: string | null
  fromCompany?: string | null
  source?: string | null
  to?: string | null
  body?: string | null
  isStarred?: boolean | null
  internalNotes?: string | null
  createdAt: string
  updatedAt?: string | null
}

// ─── Media Asset ───────────────────────────────────────────────

export interface MediaAsset {
  id: string
  filename: string
  originalName?: string | null
  url: string
  mimeType?: string | null
  size?: number | null
  fileSize?: number | null
  width?: number | null
  height?: number | null
  altText?: string | null
  label?: string | null
  createdAt: string
}

// ─── Admin User ────────────────────────────────────────────────

export interface AdminUser {
  id: string
  name: string
  email: string
  role: string
  avatarUrl?: string | null
  isActive: boolean
  lastLoginAt?: string | null
  createdAt: string
}

// ─── Audit Log ─────────────────────────────────────────────────

export interface AuditLog {
  id: string
  action: string
  entityType?: string | null
  entityId?: string | null
  entityName?: string | null
  actorId?: string | null
  actorName?: string | null
  actorEmail?: string | null
  ipAddress?: string | null
  userAgent?: string | null
  newValue?: Record<string, unknown>
  oldValue?: Record<string, unknown>
  metadata?: Record<string, unknown>
  createdAt: string
}

// ─── Dashboard ─────────────────────────────────────────────────

export interface DashboardStats {
  totalProducts: number
  publishedProducts: number
  draftProducts: number
  hiddenProducts: number
  outOfStockProducts: number
  emergencyProducts: number
  totalOrders: number
  pendingOrders: number
  totalRevenue: number
  totalCustomers: number
  totalRfqs: number
  newRfqs: number
  urgentRfqs: number
  emergencyRfqs: number
  totalOffers: number
  newOffers: number
  newMessages?: number
  inStockProducts?: number
  saleProducts?: number
  newArrivals?: number
  totalBrands?: number
  totalCategories?: number
  totalIndustries?: number
  totalStockUnits?: number
  /** True totals, not just the length of the sample arrays below. */
  lowStockCount?: number
  missingImageCount?: number
  lowStockProducts?: { id: string; name: string; sku: string; stockCount: number; brand?: string; category?: string; availability?: string; images?: { url: string }[] }[]
  missingImageProducts?: { id: string; name: string; sku: string; brand?: string; category?: string; stockCount?: number; availability?: string; images?: { url: string }[] }[]
  categoryBreakdown?: { name: string; count: number; id?: string; category?: string; _count?: { products: number }; condition?: string }[]
  brandBreakdown?: { name: string; count: number; id?: string; _count?: { products: number } }[]
  conditionBreakdown?: { condition: string; count: number }[]
  outOfStockCount?: number
}

// ─── Settings ──────────────────────────────────────────────────

export interface StoreSettings {
  [key: string]: string | number | boolean
}

// ─── Homepage Section ──────────────────────────────────────────

export interface HomepageSection {
  id: string
  type: string
  title?: string | null
  content?: Record<string, unknown>
  sortOrder?: number
  isVisible?: boolean
}

// ─── Testimonial ───────────────────────────────────────────────

export interface Testimonial {
  id: string
  name: string
  role?: string | null
  company?: string | null
  avatarUrl?: string | null
  text: string
  rating?: number | null
  sortOrder?: number
  isVisible?: boolean
}


// ─── Search ────────────────────────────────────────────────────

export interface SearchResult {
  type: 'product' | 'brand' | 'category' | 'page'
  id: string
  name?: string
  title?: string
  slug?: string
  sku?: string
  brand?: string
  description?: string
  productCount?: number
  /** Relative destination returned by the server search service. */
  path?: string
  price?: number
  imageUrl?: string
}
