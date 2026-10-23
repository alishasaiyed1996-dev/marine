import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, useInView } from 'framer-motion'
import { MapPin, Clock } from 'lucide-react'
import { offices, timelineEvents } from '../data/testimonials'
import { SEO } from '../components/seo/SEO'
import { BreadcrumbJsonLd } from '../components/seo/BreadcrumbJsonLd'
import { useStaticPageSeo } from '../lib/seo/staticPageSeo'

export default function About() {
  const { t } = useTranslation()
  const seo = useStaticPageSeo('about')
  const timelineRef = useRef<HTMLDivElement>(null!)
  const timelineInView = useInView(timelineRef, { once: true, amount: 0.2 })

  return (
    <div>
      <SEO
        title={seo.title}
        description={seo.description}
        canonical="/about"
      />
      <BreadcrumbJsonLd items={[{ name: 'Home', url: '/' }, { name: 'About', url: '/about' }]} />
      {/* Hero */}
      <section className="py-24 bg-[var(--secondary-bg)] text-center relative overflow-hidden">
        <div className="absolute inset-0 dot-grid-bg opacity-40" />
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6 relative z-10">
          <span className="inline-block font-body font-medium text-xs tracking-[3px] uppercase text-[var(--text-muted)] mb-4">
            {t('about.heroLabel')}
          </span>
          <h1 className="font-display font-bold text-display-2xl tracking-tight">
            {t('about.heroTitle')}<br />
            <span className="gradient-text">Globally Connected.</span>
          </h1>
          <p className="text-body text-[var(--text-secondary)] max-w-[640px] mx-auto mt-4">
            {t('about.heroSub')}
          </p>
        </div>
      </section>

      {/* Timeline */}
      <section className="py-24">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6">
          <span className="inline-block font-body font-medium text-xs tracking-[3px] uppercase text-[var(--text-muted)] mb-4">
            {t('about.storyLabel')}
          </span>
          <h2 className="font-display font-bold text-section-lg tracking-tight mb-12">
            {t('about.storyTitle')}
          </h2>
          <div ref={timelineRef} className="relative pl-8">
            {/* Static background line */}
            <div className="absolute left-[3px] top-0 w-[1px] h-full bg-[var(--border)]" />
            {/* Animated accent line */}
            <motion.div
              className="absolute left-[3px] top-0 w-[2px] bg-[var(--accent-primary)]/50"
              initial={{ height: '0%' }}
              animate={timelineInView ? { height: '100%' } : { height: '0%' }}
              transition={{ duration: 1.5, ease: 'easeInOut' }}
            />
            {timelineEvents.map((event, i) => (
              <motion.div
                key={event.year}
                className="relative pb-10 last:pb-0"
                initial={{ x: -30, opacity: 0 }}
                animate={timelineInView ? { x: 0, opacity: 1 } : { x: -30, opacity: 0 }}
                transition={{ delay: i * 0.15, duration: 0.6, ease: 'easeOut' }}
              >
                <motion.div
                  className="absolute -left-[41px] w-8 h-8 rounded-full bg-[var(--surface)] border-2 border-[var(--accent-primary)] flex items-center justify-center font-display font-bold text-xs text-[var(--accent-primary)] z-10"
                  initial={{ scale: 0 }}
                  animate={timelineInView ? { scale: 1 } : { scale: 0 }}
                  transition={{ delay: i * 0.2, duration: 0.4, ease: 'backOut' }}
                >
                  {event.year.slice(2)}
                </motion.div>
                <div className="ml-4">
                  <span className="font-mono text-xs text-[var(--accent-primary)]">{event.year}</span>
                  <h3 className="text-base font-semibold mt-1">{event.title}</h3>
                  <p className="text-sm text-[var(--text-secondary)] mt-1">{event.description}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Offices */}
      <section className="py-24 bg-[var(--secondary-bg)]">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6">
          <span className="inline-block font-body font-medium text-xs tracking-[3px] uppercase text-[var(--text-muted)] mb-4">
            {t('about.hubLabel')}
          </span>
          <h2 className="font-display font-bold text-section-lg tracking-tight mb-10">
            {t('about.hubTitle')}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
            {offices.map((office) => (
              <motion.div
                key={office.city}
                className="bg-[var(--surface)] border border-[var(--border)] border-l-[3px] border-l-transparent p-6 transition-all duration-300 hover:border-l-[var(--accent-primary)] hover:-translate-y-1"
                whileHover={{ y: -4 }}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4 }}
              >
                <h3 className="font-display font-bold text-lg mb-1">{office.city}</h3>
                <p className="text-xs text-[var(--text-muted)] mb-3">{office.country}</p>
                <p className="text-xs text-[var(--text-secondary)] mb-3 flex items-start gap-1.5">
                  <MapPin size={12} className="mt-0.5 flex-shrink-0 text-[var(--accent-primary)]" />
                  {office.address}
                </p>
                <p className="text-xs text-[var(--text-secondary)] mb-1 flex items-center gap-1.5">
                  <Clock size={12} className="text-[var(--accent-primary)] flex-shrink-0" />
                  {office.timezone.split('/')[1]}
                </p>
                <p className="text-xs text-[var(--text-secondary)]">{office.phone}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

    </div>
  )
}
