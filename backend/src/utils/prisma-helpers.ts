import { Prisma } from '@prisma/client'

// ─── Product Include Shape (Storefront) ────────────────────────
export const productInclude = {
  brand: {
    select: { id: true, name: true, slug: true, logoUrl: true },
  },
  category: {
    select: { id: true, name: true, slug: true, icon: true },
  },
  images: {
    orderBy: { sortOrder: 'asc' as const },
    select: { id: true, url: true, altText: true, label: true, isMain: true, sortOrder: true },
  },
  specs: {
    where: { isPublic: true },
    orderBy: { sortOrder: 'asc' as const },
    select: { name: true, value: true },
  },
  industries: {
    select: {
      industry: { select: { id: true, name: true, slug: true } },
    },
  },
} satisfies Prisma.ProductInclude

export type ProductWithRelations = Prisma.ProductGetPayload<{ include: typeof productInclude }>

// ─── Product Include Shape (Admin - more fields) ───────────────
export const productAdminInclude = {
  ...productInclude,
  specs: {
    orderBy: { sortOrder: 'asc' as const },
    select: { id: true, name: true, value: true, isPublic: true, sortOrder: true },
  },
  createdByUser: {
    select: { id: true, name: true, email: true },
  },
  updatedByUser: {
    select: { id: true, name: true, email: true },
  },
  _count: {
    select: { orderItems: true, offers: true },
  },
} satisfies Prisma.ProductInclude

export type ProductAdminWithRelations = Prisma.ProductGetPayload<{ include: typeof productAdminInclude }>

// ─── Brand Include Shape ───────────────────────────────────────
export const brandInclude = {
  _count: {
    select: { products: { where: { status: 'published' } } },
  },
} satisfies Prisma.BrandInclude

// ─── Category Include Shape ────────────────────────────────────
export const categoryInclude = {
  children: {
    orderBy: { sortOrder: 'asc' as const },
    include: {
      _count: { select: { products: { where: { status: 'published' } } } },
    },
  },
  _count: {
    select: { products: { where: { status: 'published' } } },
  },
} satisfies Prisma.CategoryInclude

// ─── Industry Include Shape ────────────────────────────────────
export const industryInclude = {
  _count: {
    select: { products: true },
  },
} satisfies Prisma.IndustryInclude

// ─── Order Include Shape ───────────────────────────────────────
export const orderInclude = {
  customer: {
    select: { id: true, name: true, email: true, phone: true, company: true },
  },
  items: {
    // productId lets admin analytics join order lines back to catalog products
    // (stock, margin and performance widgets) without guessing from SKUs.
    select: { id: true, productId: true, productName: true, productSku: true, quantity: true, unitPrice: true, totalPrice: true },
  },
  timeline: {
    orderBy: { createdAt: 'desc' as const },
    select: { status: true, note: true, createdAt: true },
  },
} satisfies Prisma.OrderInclude

// ─── RFQ Include Shape ─────────────────────────────────────────
export const rfqInclude = {
  customer: {
    select: { id: true, name: true, email: true, phone: true, company: true },
  },
  assignee: {
    select: { id: true, name: true, email: true },
  },
  items: true,
  notes: {
    orderBy: { createdAt: 'desc' as const },
    include: {
      author: { select: { id: true, name: true, email: true } },
    },
  },
} satisfies Prisma.RfqInclude
