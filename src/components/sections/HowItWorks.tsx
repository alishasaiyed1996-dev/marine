import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { SectionLabel } from '../ui/SectionLabel'
import { useLocalizedPath } from '../../lib/locale'

/**
 * HowItWorks used <motion.li> + useInView from framer-motion. The section is
 * lazy but its framer-motion import chained the ~40 KB gz `anim` chunk into
 * every home-page load. The same stagger is now a CSS transition triggered by
 * a tiny IntersectionObserver — transform/opacity only, so the browser stays
 * on the compositor and Lighthouse's mainthread-work budget is untouched.
 */
function useInViewOnce(threshold = 0.15) {
  const ref = useRef<HTMLElement | null>(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const node = ref.current
    if (!node) return
    // Old browsers / exotic embeddings: show content immediately instead of
    // leaving the whole section at opacity: 0.
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true)
      return
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setInView(true)
        io.disconnect()
      }
    }, { threshold })
    io.observe(node)
    return () => io.disconnect()
  }, [threshold])
  return { ref, inView }
}

export function HowItWorks() {
  const { t } = useTranslation()
  const lp = useLocalizedPath()
  const { ref, inView } = useInViewOnce()

  const steps = [
    { num: '01', title: t('process.step1Title'), desc: t('process.step1Desc') },
    { num: '02', title: t('process.step2Title'), desc: t('process.step2Desc') },
    { num: '03', title: t('process.step3Title'), desc: t('process.step3Desc') },
    { num: '04', title: t('process.step4Title'), desc: t('process.step4Desc') },
    { num: '05', title: t('process.step5Title'), desc: t('process.step5Desc') },
  ]

  return (
    <section
      className="section-y bg-[var(--secondary-bg)]"
      id="process"
      ref={(node) => { ref.current = node }}
    >
      <div className="site-container grid items-start gap-10 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-16">
        {/* Left: intro + CTA (sticky on desktop) */}
        <div className="lg:sticky lg:top-24">
          <SectionLabel>{t('process.label')}</SectionLabel>
          <h2 className="font-display font-bold text-section-lg tracking-tight text-[var(--text-primary)]">
            {t('process.title')}
          </h2>
          <p className="mt-4 max-w-md text-body-sm leading-relaxed text-[var(--text-secondary)]">
            {t('process.desc')}
          </p>
          <div className="gold-accent-bar mt-5" />
          <Link
            to={lp('/rfq')}
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-[var(--accent-primary)] px-5 py-3 text-sm font-bold text-[var(--btn-blue-text)] no-underline hover:bg-[var(--accent-primary-hover)] hover:text-[var(--btn-blue-text)]"
          >
            {t('process.cta')} <ArrowRight size={16} />
          </Link>
        </div>

        {/* Right: vertical stepper */}
        <ol className="relative">
          <div
            aria-hidden
            className="absolute start-7 top-4 bottom-4 w-[2px] bg-gradient-to-b from-[var(--accent-primary)]/30 via-[var(--accent-gold)]/35 to-[var(--accent-primary)]/30"
          />
          {steps.map((step, i) => (
            <li
              key={step.num}
              className={`hiw-step relative pb-7 ps-16 last:pb-0 lg:ps-20${inView ? ' is-in' : ''}`}
              style={{ transitionDelay: inView ? `${i * 100}ms` : '0ms' }}
            >
              <div
                className="hiw-step-badge absolute start-0 top-0 z-10 flex h-14 w-14 items-center justify-center rounded-xl border border-[var(--accent-primary)]/35 bg-[var(--surface)] font-display text-lg font-extrabold text-[var(--accent-primary)] shadow-[0_4px_20px_var(--focus-ring)]"
                style={{ transitionDelay: inView ? `${i * 120}ms` : '0ms' }}
              >
                {step.num}
              </div>
              {/* h3: the section already has an h2 above; LH heading-order */}
              <h3 className="text-label font-bold text-[var(--text-primary)]">{step.title}</h3>
              <p className="mt-1 text-body-sm leading-relaxed text-[var(--text-secondary)]">{step.desc}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
