import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { SectionLabel } from '../ui/SectionLabel'
import { useIndustries } from '../../hooks/useApiQuery'
import { useLocalizedPath } from '../../lib/locale'
import { Ship, Anchor, Flame, Zap, Factory, FlaskConical, ArrowRight } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

const iconMap: Record<string, LucideIcon> = {
  Ship, Anchor, Flame, Zap, Factory, FlaskConical,
}

interface IndustryItem { id: string; name: string; icon: string; description: string; painPoints: string[] }

export function IndustriesTabs() {
  const { t } = useTranslation()
  const lp = useLocalizedPath()

  // Shared react-query cache (same key as the /industries page): API data with
  // a built-in static fallback, so the section always renders real content.
  const { data } = useIndustries()
  const industries: IndustryItem[] = (data || []) as IndustryItem[]
  const [active, setActive] = useState('')
  const currentActive = active || industries[0]?.id || ''

  const current = industries.find((i) => i.id === currentActive) || industries[0]
  const Icon = current ? (iconMap[current.icon] || Ship) : Ship

  return (
    <section className="section-y bg-[var(--primary-bg)]" id="industries">
      <div className="site-container">
        <div className="section-header">
          <SectionLabel>{t('industries.label')}</SectionLabel>
          <h2 className="font-display font-bold text-section tracking-tight">
            {t('industries.title')}
          </h2>
          <div className="gold-accent-bar mt-4" />
        </div>

        {industries.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-sm text-[var(--text-muted)]">Loading industries...</p>
          </div>
        ) : (
        <>
        {/* Tab buttons */}
        <div className="flex gap-2.5 overflow-x-auto flex-nowrap md:flex-wrap mb-8 -mx-4 px-4 md:mx-0 md:px-0 pb-2 scrollbar-none">
          {industries.map((ind) => {
            const isActive = currentActive === ind.id
            return (
              <button
                key={ind.id}
                onClick={() => setActive(ind.id)}
                className={`flex-shrink-0 px-6 py-3 rounded-xl font-body font-semibold text-xs tracking-wide transition-all duration-300 border ${
                  isActive
                    ? 'bg-[var(--accent-primary)] border-[var(--accent-primary)] text-[var(--btn-blue-text)] shadow-[0_4px_16px_var(--focus-ring)]'
                    : 'bg-[var(--surface)] border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent-primary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {ind.name}
              </button>
            )
          })}
        </div>

        {/* Active panel */}
        <div className="flex gap-6 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[var(--shadow-card)] md:gap-10 md:p-9">
          <div className="hidden md:flex items-start text-[var(--accent-primary)] flex-shrink-0 mt-1">
            <div className="w-16 h-16 rounded-2xl bg-[var(--accent-primary)]/[0.1] flex items-center justify-center">
              <Icon size={32} />
            </div>
          </div>
          <div className="flex-1">
            <h3 className="heading-xl mb-3 text-[var(--text-primary)]">{current.name}</h3>
            <p className="text-body-sm text-[var(--text-secondary)] leading-relaxed mb-5">{current.description}</p>
            <div className="flex gap-2.5 flex-wrap mb-6">
              {current.painPoints.slice(0, 3).map((pp, i) => (
                <span key={i} className="px-3.5 py-1.5 text-xs font-mono border border-[var(--border)] text-[var(--text-muted)] bg-[var(--surface-soft)] rounded-lg">
                  {pp.split(' ').slice(0, 3).join(' ')}…
                </span>
              ))}
            </div>
            <Link
              to={lp(`/products?industry=${current.id}`)}
              className="inline-flex items-center gap-2 text-xs font-bold border-2 border-[var(--accent-primary)] text-[var(--accent-primary)] px-5 py-2.5 rounded-xl hover:bg-[var(--accent-primary)] hover:text-[var(--btn-blue-text)] transition-all duration-300 no-underline"
            >
              {t('industries.viewProducts')} <ArrowRight size={14} />
            </Link>
          </div>
        </div>
        </>
        )}
      </div>
    </section>
  )
}
