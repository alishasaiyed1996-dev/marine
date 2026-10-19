import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { motion, useInView } from 'framer-motion'
import { ArrowRight } from 'lucide-react'
import { SectionLabel } from '../ui/SectionLabel'
import { useLocalizedPath } from '../../lib/locale'

export function HowItWorks() {
  const { t } = useTranslation()
  const lp = useLocalizedPath()
  const sectionRef = useRef<HTMLDivElement>(null!)
  const isInView = useInView(sectionRef, { once: true, amount: 0.15 })

  const steps = [
    { num: '01', title: t('process.step1Title'), desc: t('process.step1Desc') },
    { num: '02', title: t('process.step2Title'), desc: t('process.step2Desc') },
    { num: '03', title: t('process.step3Title'), desc: t('process.step3Desc') },
    { num: '04', title: t('process.step4Title'), desc: t('process.step4Desc') },
    { num: '05', title: t('process.step5Title'), desc: t('process.step5Desc') },
  ]

  return (
    <section className="section-y bg-[var(--secondary-bg)]" id="process" ref={sectionRef}>
      <div className="site-container grid items-start gap-10 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-16">
        {/* Left: intro + CTA (sticky on desktop) */}
        <div className="lg:sticky lg:top-24">
          <SectionLabel>{t('process.label')}</SectionLabel>
          <h2 className="font-display font-bold text-section-lg tracking-tight text-[var(--text-primary)]">
            From inquiry to dispatch
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
            className="absolute left-7 top-4 bottom-4 w-[2px] bg-gradient-to-b from-[var(--accent-primary)]/30 via-[var(--accent-gold)]/35 to-[var(--accent-primary)]/30"
          />
          {steps.map((step, i) => (
            <motion.li
              key={step.num}
              className="relative pb-7 pl-16 last:pb-0 lg:pl-20"
              initial={{ opacity: 0, y: 20 }}
              animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
              transition={{ delay: i * 0.1, duration: 0.4, ease: 'easeOut' }}
            >
              <motion.div
                className="absolute left-0 top-0 z-10 flex h-14 w-14 items-center justify-center rounded-xl border border-[var(--accent-primary)]/35 bg-[var(--surface)] font-display text-lg font-extrabold text-[var(--accent-primary)] shadow-[0_4px_20px_var(--focus-ring)]"
                initial={{ scale: 0.8, opacity: 0 }}
                animate={isInView ? { scale: 1, opacity: 1 } : { scale: 0.8, opacity: 0 }}
                transition={{ delay: i * 0.12, duration: 0.35, ease: 'backOut' }}
              >
                {step.num}
              </motion.div>
              <h4 className="text-label font-bold text-[var(--text-primary)]">{step.title}</h4>
              <p className="mt-1 text-body-sm leading-relaxed text-[var(--text-secondary)]">{step.desc}</p>
            </motion.li>
          ))}
        </ol>
      </div>
    </section>
  )
}
