import { lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { SEO } from '../components/seo/SEO'
import { useStaticPageSeo } from '../lib/seo/staticPageSeo'

const GlobeScene = lazy(() => import('../components/three/GlobeScene'))

const regions = [
  { country: 'India', categories: ['Marine Equipment', 'Electrical', 'Spare Parts'] },
  { country: 'Singapore', categories: ['Marine Equipment', 'Hydraulic', 'Pneumatic'] },
  { country: 'UAE', categories: ['Oil & Gas', 'Electrical', 'Industrial Spares'] },
  { country: 'Netherlands', categories: ['Marine Equipment', 'Hydraulic', 'Automation'] },
  { country: 'Germany', categories: ['Automation', 'Hydraulic', 'Electrical'] },
  { country: 'United Kingdom', categories: ['Marine', 'Automation', 'Spare Parts'] },
  { country: 'United States', categories: ['Industrial', 'Automation', 'Spare Parts'] },
  { country: 'Japan', categories: ['Automation', 'Electrical', 'Robotics'] },
  { country: 'China', categories: ['Industrial', 'Electrical', 'Hydraulic'] },
  { country: 'South Korea', categories: ['Marine', 'Shipbuilding', 'Electrical'] },
  { country: 'Norway', categories: ['Marine', 'Oil & Gas', 'Automation'] },
  { country: 'Denmark', categories: ['Marine', 'Hydraulic', 'Refrigeration'] },
  { country: 'Saudi Arabia', categories: ['Oil & Gas', 'Power Generation'] },
  { country: 'Qatar', categories: ['Oil & Gas', 'Industrial'] },
  { country: 'Nigeria', categories: ['Oil & Gas', 'Marine'] },
  { country: 'South Africa', categories: ['Mining', 'Industrial', 'Power'] },
  { country: 'Brazil', categories: ['Oil & Gas', 'Marine', 'Industrial'] },
  { country: 'Australia', categories: ['Mining', 'Industrial', 'Power Generation'] },
]

export default function Network() {
  const { t } = useTranslation()
  const seo = useStaticPageSeo('network')
  return (
    <div>
      <SEO
        title={seo.title}
        description={seo.description}
        canonical="/network"
      />
      <section className="py-20 bg-[var(--secondary-bg)] text-center relative overflow-hidden">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6 relative z-10">
          <span className="inline-block font-body font-medium text-xs tracking-[3px] uppercase text-[var(--text-muted)] mb-4">
            {t('network.label')}
          </span>
          <h1 className="font-display font-bold text-display-xl tracking-tight">
            {t('network.title')}
          </h1>
          <p className="text-body text-[var(--text-secondary)] max-w-[640px] mx-auto mt-4">
            {t('network.sub')}
          </p>
        </div>
      </section>

      <section className="py-16">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-12 items-start">
            {/* Globe */}
            <div className="h-[300px] sm:h-[500px] bg-[var(--secondary-bg)] border border-[var(--border)] overflow-hidden">
              <Suspense fallback={<div className="flex items-center justify-center h-full text-xs text-[var(--text-muted)]">{t('network.loadingGlobe')}</div>}>
                <GlobeScene />
              </Suspense>
            </div>

            {/* Region list */}
            <div className="bg-[var(--secondary-bg)] border border-[var(--border)] p-6 max-h-[500px] overflow-y-auto">
              <h3 className="text-sm font-semibold mb-4">{t('network.regionsCapabilities')}</h3>
              <div className="space-y-2">
                {regions.map((r) => (
                  <div key={r.country} className="p-3 bg-[var(--surface)] border border-[var(--border)] transition-all hover:border-[var(--accent-primary)]">
                    <div className="flex items-center justify-between mb-1">
                      <strong className="text-xs">{r.country}</strong>
                      <span className="text-xs text-[var(--text-muted)]">{r.categories.length} {t('network.categories')}</span>
                    </div>
                    <div className="flex gap-1 flex-wrap">
                      {r.categories.map((c) => (
                        <span key={c} className="px-1.5 py-0.5 text-xs font-mono border border-[var(--border)] text-[var(--text-muted)] bg-[var(--primary-bg)]">
                          {c}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
