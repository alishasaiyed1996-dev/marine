import { useLocale } from '../../lib/locale'
import { getCspNonce } from '../../lib/csp'

interface BreadcrumbItem {
  name: string
  url: string
}

interface BreadcrumbJsonLdProps {
  items: BreadcrumbItem[]
}

const BASE_URL = import.meta.env.VITE_SITE_URL || 'https://alkatraders.co'

export function BreadcrumbJsonLd({ items }: BreadcrumbJsonLdProps) {
  const locale = useLocale()
  // Breadcrumb URLs are written as storefront paths ("/products"). Keep them
  // in the locale being viewed unless a locale prefix is already present.
  // Public URLs are canonical with a trailing slash.
  const localizedUrl = (url: string) => {
    if (url.startsWith('http://') || url.startsWith('https://')) return url
    const [pathname, suffix = ''] = url.split(/(?=[?#])/, 2)
    const hasFileExtension = /\.[a-z0-9]{2,8}$/i.test(pathname)
    const normalized = pathname.endsWith('/') || hasFileExtension ? pathname : `${pathname}/`
    if (/^\/(en|ar|es)(\/|$)/.test(normalized)) return `${normalized}${suffix}`
    return `/${locale}${normalized === '/' ? '/' : normalized}${suffix}`
  }
  const breadcrumbs = items.map((item, index) => ({
    '@type': 'ListItem',
    position: index + 1,
    name: item.name,
    item: `${BASE_URL}${localizedUrl(item.url)}`,
  }))

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: breadcrumbs,
  }

  return (
    <script type="application/ld+json" nonce={getCspNonce()}>
      {JSON.stringify(jsonLd)}
    </script>
  )
}
