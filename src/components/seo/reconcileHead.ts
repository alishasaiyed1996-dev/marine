/**
 * The production HTML is prerendered with a complete SEO head so crawlers that
 * do not execute JavaScript still get titles, canonicals, social tags, and
 * JSON-LD. React 19 + react-helmet-async 3 render those tags natively instead
 * of reconciling server tags by `data-rh`, which leaves duplicate titles and
 * canonicals in the DOM after hydration.
 *
 * Remove only the prerendered tag when React has already emitted a live
 * equivalent for the same key (or JSON-LD type). Server-only schemas such as
 * WebSite or a breadcrumb block are left in place.
 */
export function reconcilePrerenderedHead() {
  if (typeof document === 'undefined') return

  const prerendered = Array.from(document.querySelectorAll('[data-rh="true"]'))
  if (prerendered.length === 0) return

  const liveTags = Array.from(document.querySelectorAll(
    'title, meta, link, script[type="application/ld+json"]',
  )).filter((node) => node.getAttribute('data-rh') !== 'true')

  const hasLive = (selector: string) => liveTags.some((node) => node.matches(selector))
  const metaKey = (node: Element) =>
    node.getAttribute('name')?.toLowerCase()
    || node.getAttribute('property')?.toLowerCase()
    || node.getAttribute('http-equiv')?.toLowerCase()
    || ''

  const liveMetaKeys = new Set(
    liveTags
      .filter((node) => node.tagName === 'META')
      .map(metaKey)
      .filter(Boolean),
  )

  const jsonLdTypes = (node: Element) => {
    try {
      const parsed = JSON.parse(node.textContent || '')
      const entries = Array.isArray(parsed) ? parsed : [parsed]
      return new Set(
        entries
          .map((entry) => entry?.['@type'])
          .filter((type): type is string => typeof type === 'string'),
      )
    } catch {
      return new Set<string>()
    }
  }

  const liveJsonLdTypes = new Set<string>()
  for (const node of liveTags) {
    if (node.tagName === 'SCRIPT') {
      for (const type of jsonLdTypes(node)) liveJsonLdTypes.add(type)
    }
  }

  for (const node of prerendered) {
    const tag = node.tagName
    const key = metaKey(node)

    if (tag === 'TITLE') {
      if (hasLive('title')) node.remove()
      continue
    }

    if (tag === 'LINK' && node.getAttribute('rel')?.toLowerCase() === 'canonical') {
      if (hasLive('link[rel="canonical"]')) node.remove()
      continue
    }

    if (tag === 'META' && key && liveMetaKeys.has(key)) {
      node.remove()
      continue
    }

    if (tag === 'SCRIPT' && node.getAttribute('type') === 'application/ld+json') {
      const types = jsonLdTypes(node)
      if ([...types].some((type) => liveJsonLdTypes.has(type))) node.remove()
    }
  }
}
