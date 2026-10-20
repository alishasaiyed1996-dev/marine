type ProductCategory =
  | 'marine'
  | 'electrical'
  | 'hydraulic'
  | 'pneumatic'
  | 'spares'
  | 'surplus'
  | 'lifting-handling'
  | 'tools-equipment'
  | 'safety'
  | 'hand-tools'
  | 'ship-navigation'
  | 'marine-pumps'
  | 'engine-spare'
  | 'engine-parts'
  | 'motor-components'
  | 'ship-machinery'
  | 'hydraulic-pumps'
  | 'rigging'
  | 'other-business'

type Availability = 'in-stock' | 'sourced' | 'emergency' | 'out-of-stock'

type Urgency = 'standard' | 'urgent' | 'emergency'

export type Language = 'en' | 'ar' | 'es'

interface ProductImage {
  url: string
  alt: string
  label?: string
}

export interface Product {
  id: string
  slug?: string
  filename: string
  name: string
  brand: string
  /** Canonical brand slug for the brand hub (/en/brands/{slug}/). */
  brandSlug?: string
  sku: string
  category: ProductCategory
  /** Human-readable category name for breadcrumbs and schema. */
  categoryName?: string
  /** False when the category hub is hidden and therefore 404s. */
  categoryVisible?: boolean
  industry: string[]
  availability: Availability
  specs: Record<string, string>
  // New fields
  description: string
  condition: 'new' | 'refurbished' | 'used' | 'reconditioned' | 'unused'
  price: number
  currency?: string
  ogImageUrl?: string | null
  regularPrice?: number
  salePrice?: number
  onSale?: boolean
  saleStartsAt?: string
  saleEndsAt?: string
  inStock: boolean
  stockCount: number
  customLabel?: string
  customLabelColor?: string
  images: ProductImage[]
  isNewArrival?: boolean
  dateAdded?: string
  makeOffer?: boolean
  seoKeywords?: string[]
  seoTitle?: string | null
  seoDescription?: string | null
  // Structured, verified identity (admin-entered; NULL = unknown, never guessed).
  manufacturer?: string | null
  modelNumber?: string | null
  mpn?: string | null
  gtin?: string | null
  impaCode?: string | null
  sourceUrl?: string | null
  lastVerifiedAt?: string | null
}

export interface Brand {
  id: string
  name: string
  slug: string
  sectors: string[]
  productCount: number
  logo?: string
}

export interface Industry {
  id: string
  name: string
  icon: string
  description: string
  painPoints: string[]
  productCount: number
}

export interface Testimonial {
  id: string
  name: string
  role: string
  company: string
  avatar: string
  text: string
  rating: number
  productName?: string
  productLink?: string
  /** eBay header meta line, e.g. "Past 6 months • Verified purchase". */
  verified?: string
}

export interface Office {
  city: string
  country: string
  address: string
  timezone: string
  phone: string
  email: string
  coordinates: [number, number]
}

export interface TimelineEvent {
  year: string
  title: string
  description: string
}

export interface RFQFormData {
  // Step 1
  fullName: string
  company: string
  email: string
  phone: string
  country: string
  role: string
  // Step 2
  productDesc: string
  partNumber: string
  brand: string
  quantity: number
  deliveryLocation: string
  // Step 3
  urgency: Urgency
  notes: string
  source: string
  consent: boolean
}

export interface FAQItem {
  question: string
  answer: string
}

export interface CartItem {
  product: Product
  quantity: number
}

export interface User {
  id: string
  name: string
  email: string
  phone?: string
  company?: string
  country?: string
}

export interface PriceRange {
  min: number
  max: number
}
