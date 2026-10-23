import { useTranslation } from 'react-i18next'
import { TrendingUp, Globe, Clock, ChartBar } from 'lucide-react'
import { SEO } from '../components/seo/SEO'
import { useStaticPageSeo } from '../lib/seo/staticPageSeo'

const insights = [
  {
    icon: TrendingUp,
    title: '2024 Sourcing Trends in Marine Procurement',
    summary: 'Lead times for OEM marine spares have extended by 18% year-over-year as supply chains diversify away from single-region dependency. Early procurement planning now yields 23% cost savings vs. emergency sourcing.',
    tags: ['Sourcing', 'Trends', 'Cost Optimization'],
  },
  {
    icon: Globe,
    title: 'Regional Availability: Asia-Pacific vs. EMEA',
    summary: 'APAC hubs (Singapore, Mumbai) maintain 40% shorter lead times for hydraulic and pneumatic components compared to EMEA. However, EMEA offers broader ATEX-certified inventory for oil & gas applications.',
    tags: ['Regional', 'Lead Time', 'Availability'],
  },
  {
    icon: Clock,
    title: 'Emergency Procurement: The 18-Hour Standard',
    summary: 'Industry data shows that procurement teams with pre-vetted emergency supplier networks reduce vessel downtime by 67%. Alka Traders\' 18-hour delivery record is built on 24/7 hub coverage and pre-positioned inventory.',
    tags: ['Emergency', 'Downtime', 'Logistics'],
  },
  {
    icon: ChartBar,
    title: 'Obsolescence Management for Aging Equipment',
    summary: 'With 40% of industrial automation installed base now beyond manufacturer support lifecycle, proactive obsolescence planning is critical. Cross-referencing and alternative sourcing can extend equipment life by 5-8 years.',
    tags: ['Obsolescence', 'Lifecycle', 'Planning'],
  },
]

export default function Intelligence() {
  const { t } = useTranslation()
  const seo = useStaticPageSeo('intelligence')
  return (
    <div>
      <SEO
        title={seo.title}
        description={seo.description}
        canonical="/intelligence"
      />
      <section className="py-20 bg-[var(--secondary-bg)] text-center">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6">
          <span className="inline-block font-body font-medium text-xs tracking-[3px] uppercase text-[var(--text-muted)] mb-4">
            Sourcing Insights
          </span>
          <h1 className="font-display font-bold text-display-xl tracking-tight">
            {t('intelligence.title')}
          </h1>
          <p className="text-body text-[var(--text-secondary)] max-w-[640px] mx-auto mt-4">
            {t('intelligence.sub')}
          </p>
        </div>
      </section>

      {/* Quick stats */}
      <section className="py-12 border-b border-[var(--border)]">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {[
              { label: t('intelligence.globalSuppliers'), value: '200+' },
              { label: t('intelligence.countriesServed'), value: '50+' },
              { label: t('intelligence.avgResponseTime'), value: '4 hrs' },
              { label: t('intelligence.productsSourced'), value: '10,000+' },
            ].map((stat) => (
              <div key={stat.label} className="text-center">
                <div className="font-display font-bold text-3xl text-[var(--accent-gold)] tabular-nums">{stat.value}</div>
                <div className="text-xs text-[var(--text-muted)] mt-1">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Insights */}
      <section className="py-16">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6">
          <span className="inline-block font-body font-medium text-xs tracking-[3px] uppercase text-[var(--text-muted)] mb-4">
            {t('intelligence.insightsTitle')}
          </span>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {insights.map((insight) => {
              const Icon = insight.icon
              return (
                <div key={insight.title} className="bg-[var(--secondary-bg)] border border-[var(--border)] border-l-[3px] border-l-transparent p-6 transition-all duration-300 hover:border-l-[var(--accent-primary)] hover:-translate-y-1">
                  <Icon size={24} className="text-[var(--accent-primary)] mb-3" />
                  <h3 className="text-sm font-semibold mb-2">{insight.title}</h3>
                  <p className="text-body-sm text-[var(--text-secondary)] leading-relaxed mb-4">{insight.summary}</p>
                  <div className="flex gap-1.5 flex-wrap">
                    {insight.tags.map((tag) => (
                      <span key={tag} className="px-2 py-0.5 text-xs font-mono border border-[var(--border)] text-[var(--text-muted)] bg-[var(--surface)]">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </section>
    </div>
  )
}
