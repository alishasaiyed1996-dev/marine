import { useTranslation } from 'react-i18next'
import { SectionLabel } from '../ui/SectionLabel'
import { EBayIcon } from '../ui/EBayIcon'
import { Star } from 'lucide-react'
import { testimonials } from '../../data/testimonials'

/**
 * Marketplace feedback — verified reviews from our eBay store.
 *
 * These are buyers of the industrial tooling and surplus equipment we also
 * sell on eBay, not marine procurement references. The copy says so explicitly
 * so the section cannot be mistaken for marine customer proof (C-5/U-14);
 * real marine references are still a manual task (MT-16).
 *
 * Pure static data (src/data/testimonials.ts): nothing is read from or
 * written to the database for this section.
 */
export function Testimonials() {
  const { t } = useTranslation()

  if (testimonials.length === 0) return null

  return (
    <section className="section-y bg-[var(--secondary-bg)]" id="testimonials">
      <div className="site-container">
        <div className="section-header">
          <SectionLabel>{t('testimonials.label')}</SectionLabel>
          <h2 className="font-display font-bold text-section tracking-tight">{t('testimonials.title')}</h2>
          <div className="gold-accent-bar mt-4" />
          <p className="mt-4 max-w-2xl text-body-sm text-[var(--text-secondary)]">
            {t('testimonials.note')}
          </p>
        </div>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {testimonials.map((review, i) => (
            <div key={review.id} className="card equal-card border-s-[4px] border-s-transparent p-6 hover:border-s-[var(--accent-primary)] md:p-8" style={{ animationDelay: `${i * 100}ms` }}>
              <div className="flex gap-1 mb-5">
                {Array.from({ length: review.rating }).map((_, j) => (
                  <Star key={j} size={16} className="fill-[var(--accent-gold)] text-[var(--accent-gold)]" />
                ))}
              </div>
              <p className="text-body-sm text-[var(--text-secondary)] leading-relaxed italic mb-6">&ldquo;{review.text}&rdquo;</p>
              <div className="flex items-center gap-3.5">
                <div className="w-12 h-12 rounded-xl bg-white border border-black/10 dark:border-white/15 shadow-sm flex items-center justify-center p-1.5 flex-shrink-0" role="img" aria-label={t('a11y.reviewedOnEbay')} title={t('a11y.reviewedOnEbay')}>
                  <EBayIcon className="w-full h-full" />
                </div>
                <div className="min-w-0">
                  {review.name && (
                    <strong className="text-label block text-[var(--text-primary)]">{review.name}</strong>
                  )}
                  {review.verified && (
                    <span className="text-xs font-semibold text-[var(--success)] block mt-0.5">
                      ✓ {review.verified}
                    </span>
                  )}
                  <span className="text-xs text-[var(--text-secondary)] block">
                    {t('testimonials.soldBy', { seller: 'Alka Traders' })}
                  </span>
                  {review.productName && (
                    review.productLink ? (
                      <a
                        href={review.productLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-[var(--accent-primary)] block mt-0.5 font-medium line-clamp-2 hover:underline"
                        title={review.productName}
                      >
                        {t('testimonials.reviewed', { product: review.productName })}
                      </a>
                    ) : (
                      // No listing URL recorded for this review — render plain
                      // text instead of a dead href="#".
                      <span
                        className="text-xs text-[var(--text-muted)] block mt-0.5 font-medium line-clamp-2"
                        title={review.productName}
                      >
                        {t('testimonials.reviewed', { product: review.productName })}
                      </span>
                    )
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
