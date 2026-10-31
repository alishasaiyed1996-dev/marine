import { useTranslation } from 'react-i18next'
import { StatCounter } from '../ui/StatCounter'

export function StatsBar() {
  const { t } = useTranslation()
  return (
    <section className="section-y-sm border-b border-[var(--border)] bg-[var(--secondary-bg)]">
      <div className="site-container">
        <div className="stats-gradient flex justify-center items-center flex-wrap p-5 md:p-7 rounded-2xl border border-[var(--border)] shadow-[var(--shadow-card)]">
          <StatCounter end={10000} label={t('hero.statsProducts')} />
          <div className="w-px h-14 bg-[var(--border)] hidden md:block" />
          <StatCounter end={200} label={t('hero.statsBrands')} />
          <div className="w-px h-14 bg-[var(--border)] hidden md:block" />
          <StatCounter end={50} label={t('hero.statsCountries')} />
          <div className="w-px h-14 bg-[var(--border)] hidden md:block" />
          <StatCounter end={15} label={t('hero.statsYears')} />
        </div>
      </div>
    </section>
  )
}
