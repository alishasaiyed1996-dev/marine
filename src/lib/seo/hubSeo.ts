/**
 * Hub/collection SEO readiness for the admin UI.
 *
 * Blocking rules mirror backend/src/utils/hubSeo.ts exactly: description >=
 * 120 characters, SEO title present, SEO description >= 80 characters, at
 * least one published product, and visible on the storefront. Those are the
 * only conditions that decide whether the server emits index,follow.
 *
 * Over-length titles/descriptions are warnings, not blockers. Google may
 * truncate them in the SERP, but the server deliberately does not noindex a
 * hub for being too long. Keep those in getHubSeoWarnings so admin never says
 * "not ready" for something that is actually indexable.
 */

export interface HubSeoInput {
  description?: string | null
  seoTitle?: string | null
  seoDescription?: string | null
  productCount?: number
  isVisible?: boolean
}

export function getHubSeoIssues(input: HubSeoInput): string[] {
  const issues: string[] = []
  const description = String(input.description || '').trim()
  const seoTitle = String(input.seoTitle || '').trim()
  const seoDescription = String(input.seoDescription || '').trim()

  if (description.length < 120) issues.push(`Description is ${description.length}/120 characters`)
  if (!seoTitle) issues.push('Missing SEO title')
  if (seoDescription.length < 80) issues.push(`SEO description is ${seoDescription.length}/80 characters`)
  if ((input.productCount || 0) < 1) issues.push('No published products')
  if (!input.isVisible) issues.push('Hidden from the storefront')

  return issues
}

export function getHubSeoWarnings(input: HubSeoInput): string[] {
  const warnings: string[] = []
  const seoTitle = String(input.seoTitle || '').trim()
  const seoDescription = String(input.seoDescription || '').trim()

  if (seoTitle.length > 60) {
    warnings.push(`SEO title is ${seoTitle.length} characters; Google may truncate it (60 recommended)`)
  }
  if (seoDescription.length > 160) {
    warnings.push(`SEO description is ${seoDescription.length} characters; it may be truncated (160 max recommended)`)
  }

  return warnings
}

export function isHubSeoReady(input: HubSeoInput): boolean {
  return getHubSeoIssues(input).length === 0
}
