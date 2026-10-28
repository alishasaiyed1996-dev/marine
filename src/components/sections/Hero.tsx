import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Check, Search, ShoppingCart } from 'lucide-react'
import { Globe } from '@/components/ui/cobe-globe'
import { useLocalizedPath } from '@/lib/locale'
import { useStore } from '@/store/useStore'

const TRUST_BADGES = [
  'badgeShipping',
  'badgeQuality',
  'badgeExport',
  'badgeRfq',
] as const

// Alka Traders global network — major shipping corridors the storefront
// serves. Rendered as markers + arcs on the globe.
const MARKERS = [
  { id: 'dubai', location: [25.2048, 55.2708] as [number, number], label: 'Dubai' },
  { id: 'singapore', location: [1.3521, 103.8198] as [number, number], label: 'Singapore' },
  { id: 'rotterdam', location: [51.9225, 4.4792] as [number, number], label: 'Rotterdam' },
  { id: 'houston', location: [29.7604, -95.3698] as [number, number], label: 'Houston' },
  { id: 'shanghai', location: [31.2304, 121.4737] as [number, number], label: 'Shanghai' },
  { id: 'london', location: [51.5074, -0.1278] as [number, number], label: 'London' },
  { id: 'sydney', location: [-33.8688, 151.2093] as [number, number], label: 'Sydney' },
  { id: 'santos', location: [-23.9535, -46.3339] as [number, number], label: 'Santos' },
]

const ARCS = [
  { id: 'dxb-rtm', from: [25.2048, 55.2708] as [number, number], to: [51.9225, 4.4792] as [number, number], label: 'Dubai → Rotterdam' },
]

export function Hero() {
  const { t } = useTranslation()
  const localizedPath = useLocalizedPath()
  const isDark = useStore((s) => s.theme === 'dark')

  // Brand teal that follows the active theme (light: #00796b, dark: #5dd5bf).
  const teal: [number, number, number] = isDark ? [0.365, 0.835, 0.75] : [0.0, 0.475, 0.42]

  return (
    <section
      aria-label={t('hero.label')}
      className="relative -mt-[var(--hero-header-offset)] flex min-h-[calc(100vh_+_var(--hero-header-offset))] items-center overflow-hidden bg-[var(--hero-bg)] supports-[height:100svh]:min-h-[calc(100svh_+_var(--hero-header-offset))]"
    >
      {/* Minimal ambient gradients — depth without heavy media. */}
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,var(--hero-glow-teal),transparent_55%),radial-gradient(ellipse_at_bottom_right,var(--hero-glow-gold),transparent_50%)]"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[var(--hero-bg)]/60 via-transparent to-[var(--hero-bg)]"
        aria-hidden="true"
      />

      <div className="site-container relative z-10 pt-[var(--hero-header-offset)] pb-8 sm:pb-10 lg:pb-12">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-12 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-16">
          {/* Copy column — text-start keeps Arabic right-aligned on desktop */}
          <div className="mx-auto w-full max-w-xl text-center lg:mx-0 lg:text-start">
            <span className="hero-reveal inline-flex items-center gap-2 rounded-full border border-[var(--hero-border)] bg-[var(--hero-chip-bg)] px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--hero-text-secondary)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--hero-accent)]" aria-hidden="true" />
              {t('hero.label')}
            </span>

            <h1
              className="hero-reveal mt-6 font-manrope text-[clamp(2.5rem,5.2vw,4.25rem)] font-extrabold leading-[1.06] tracking-[-0.03em] text-[var(--hero-text)]"
              style={{ animationDelay: '60ms' }}
            >
              {t('hero.trustedLine')}
              <span className="mt-1 block text-[var(--hero-accent-hover)]">{t('hero.deliveredLine')}</span>
            </h1>

            <p
              className="hero-reveal mx-auto mt-6 max-w-xl text-lg leading-relaxed text-[var(--hero-text-secondary)] lg:mx-0"
              style={{ animationDelay: '120ms' }}
            >
              {t('hero.sub2')}
            </p>

            <div
              className="hero-reveal mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row lg:justify-start"
              style={{ animationDelay: '160ms' }}
            >
              <Link to={localizedPath('/products')} className="hero-btn-primary px-7 py-3.5 no-underline">
                <ShoppingCart size={18} strokeWidth={2} /> {t('hero.ctaProducts')}
              </Link>
              <Link
                to={localizedPath('/products?search=ship%20spares')}
                className="hero-btn-secondary px-7 py-3.5 no-underline"
              >
                <Search size={18} strokeWidth={2} /> {t('hero.ctaSearch')}
              </Link>
            </div>

            <ul
              className="hero-reveal mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2.5 lg:justify-start"
              style={{ animationDelay: '200ms' }}
            >
              {TRUST_BADGES.map((badge) => (
                <li
                  key={badge}
                  className="flex items-center gap-2 text-sm font-medium text-[var(--hero-text-secondary)]"
                >
                  <Check size={15} strokeWidth={2.5} className="shrink-0 text-[var(--hero-accent)]" />
                  {t(`hero.${badge}`)}
                </li>
              ))}
            </ul>
          </div>

          {/* Interactive global-network globe (drag to rotate) */}
          <div className="hero-globe-wrap hero-reveal mx-auto w-full max-w-[540px]" style={{ animationDelay: '140ms' }}>
            <Globe
              markers={MARKERS}
              arcs={ARCS}
              dark={isDark ? 1 : 0}
              mapBrightness={isDark ? 6 : 10}
              markerColor={teal}
              baseColor={[1, 1, 1]}
              arcColor={teal}
              glowColor={isDark ? [0.29, 0.65, 0.61] : [0.0, 0.475, 0.42]}
              markerSize={0.02}
              markerElevation={0.015}
              speed={0.003}
            />
          </div>
        </div>
      </div>
    </section>
  )
}
