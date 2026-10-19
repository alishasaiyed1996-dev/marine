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
  const localizedUrl = (url: string) => {
    if (url.startsWith('http://') || url.startsWith('https://')) return url
    if (/^\/(en|ar|es)(\/|$)/.test(url)) return url
    return `/${locale}${url === '/' ? '/' : url}`
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
