/**
 * Single source of truth for hub indexability.
 *
 * The sitemap builder and the storefront hub service both call this function,
 * and server.js trusts the `indexable` flag returned by the API instead of
 * re-implementing the rule. A hidden hub returns 404 from the service, so it
 * can never appear in the sitemap either.
 */

export interface HubSeoInput {
  description?: string | null
  seoTitle?: string | null
  seoDescription?: string | null
  productCount?: number
  isVisible?: boolean
}

export function getHubSeoBlockers(input: HubSeoInput): string[] {
  const blockers: string[] = []
  const description = String(input.description || '').trim()
  const seoTitle = String(input.seoTitle || '').trim()
  const seoDescription = String(input.seoDescription || '').trim()

  if (description.length < 120) blockers.push('Description is shorter than 120 characters')
  if (!seoTitle) blockers.push('Missing SEO title')
  if (seoDescription.length < 80) blockers.push('SEO description is shorter than 80 characters')
  if ((input.productCount || 0) < 1) blockers.push('No published products')
  if (!input.isVisible) blockers.push('Hidden from the storefront')

  return blockers
}

export function isHubIndexable(input: HubSeoInput): boolean {
  return getHubSeoBlockers(input).length === 0
}
