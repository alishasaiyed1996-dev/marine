import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useLocalizedPath } from '../../lib/locale'
import { applyCloudinaryTransform } from '../../lib/utils'

const categories = [
  { name: 'Electrical & Automation', slug: 'electrical', file: 'Electrical and automation.jpeg' },
  { name: 'Engine Parts', slug: 'engine-parts', file: 'Engine parts.jpeg' },
  { name: 'Engine Spare', slug: 'engine-spare', file: 'Engine spare.jpeg' },
  { name: 'Equipment & Tools', slug: 'tools-equipment', file: 'Equipments and tools.jpeg' },
  { name: 'Hand Tools', slug: 'hand-tools', file: 'Hand tools.jpeg' },
  { name: 'Hydraulic Pumps & Motors', slug: 'hydraulic-pumps', file: 'Hydraulic pumps and motor.jpeg' },
  { name: 'Hydraulics', slug: 'hydraulic', file: 'Hydraulics.jpeg' },
  { name: 'Lifting & Handling', slug: 'lifting-handling', file: 'Lifting and handling.jpeg' },
  { name: 'Marine Pumps', slug: 'marine-pumps', file: 'Marine pumps.jpeg' },
  { name: 'Motors & Components', slug: 'motor-components', file: 'Motor and components.jpeg' },
  { name: 'Other Business & Industrial', slug: 'other-business', file: 'Other businesss and industrial.jpeg' },
  { name: 'Pneumatics', slug: 'pneumatic', file: 'Pneumatics.jpeg' },
  { name: 'Rigging', slug: 'rigging', file: 'Rigging.jpeg' },
  { name: 'Safety', slug: 'safety', file: 'Safety.jpeg' },
  { name: 'Ship Machinery', slug: 'ship-machinery', file: 'Ship machinery.jpeg' },
  { name: 'Ship Navigation', slug: 'ship-navigation', file: 'Ship navigation.jpeg' },
]

function encodePath(name: string) {
  // Serve category images from Cloudinary CDN
  const slug = name.replace(/\.\w+$/, '').toLowerCase().replace(/\s+/g, '-')
  return `https://res.cloudinary.com/y7up4zti/image/upload/v1/alka/categories/${slug}`
}

export function ShopByCategory() {
  const { t } = useTranslation()
  const lp = useLocalizedPath()
  return (
    <section className="section-y bg-[var(--secondary-bg)]" aria-label={t('shop.shopByCategory')}>
      <div className="site-container">
        {/* ── Header ── */}
        <div className="section-header-center">
          <span className="inline-block text-xs font-black uppercase tracking-[0.22em] text-[var(--accent-primary)] mb-4">
            {t('categories.eyebrow')}
          </span>
          <h2 className="font-display text-section-lg font-bold tracking-tight text-[var(--text-primary)]">
            {t('categories.findTitle')}
          </h2>
          <p className="mt-4 text-base leading-relaxed text-[var(--text-secondary)] max-w-2xl mx-auto">
            {t('categories.findSub')}
          </p>
          <div className="mt-5 mx-auto w-16 h-1 bg-[var(--accent-primary)] rounded-full" />
        </div>

        {/* ── Category Grid ── */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 lg:gap-5">
          {categories.map((cat) => (
            <Link
              key={cat.name}
              to={lp(`/products?category=${cat.slug}`)}
              className="group relative flex h-full flex-col overflow-hidden rounded-xl bg-[var(--surface)] border border-[var(--border)] shadow-[var(--shadow-card)] hover:border-[var(--accent-primary)] hover:shadow-lg transition-all duration-500 no-underline"
            >
              {/* Image */}
              <div className="relative aspect-[4/3] overflow-hidden">
                <img
                  src={applyCloudinaryTransform(encodePath(cat.file), 400)}
                  /* Tiles render ~165px wide on phones and ~285px on desktop;
                     requesting the 800px rendition for every tile was ~700KB of
                     waste. srcSet lets the browser pick 400w or 800w by DPR. */
                  srcSet={`${applyCloudinaryTransform(encodePath(cat.file), 400)} 400w, ${applyCloudinaryTransform(encodePath(cat.file), 800)} 800w`}
                  sizes="(min-width: 1024px) 285px, (min-width: 640px) 30vw, 45vw"
                  alt={t(`categories.${cat.slug}`)}
                  className="h-full w-full object-cover transition-all duration-700 group-hover:scale-110"
                  loading="lazy"
                  decoding="async"
                  onError={(e) => {
                    const img = e.currentTarget
                    // Cloudinary can be slow/unreachable; every category tile
                    // also ships as a local JPEG under /images/categories, so
                    // fall back to that before hiding the image entirely.
                    if (img.dataset.fallback !== 'local') {
                      img.dataset.fallback = 'local'
                      img.src = `/images/categories/${encodeURIComponent(cat.file)}`
                      return
                    }
                    img.style.display = 'none'
                    const parent = img.parentElement
                    if (parent) {
                      parent.style.background = 'linear-gradient(135deg, var(--surface-soft) 0%, var(--secondary-bg) 100%)'
                    }
                  }}
                />
                {/* Hover overlay */}
                <div className="absolute inset-0 bg-gradient-to-t from-[var(--navy-deep)]/65 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
              </div>

              {/* Label */}
              <div className="flex min-h-[70px] items-center px-4 py-4">
                <h3 className="text-sm font-bold text-[var(--text-primary)] group-hover:text-[var(--accent-primary)] transition-colors duration-300 leading-tight">
                  {t(`categories.${cat.slug}`)}
                </h3>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}
