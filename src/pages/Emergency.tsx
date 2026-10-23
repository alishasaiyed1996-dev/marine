import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, useInView } from 'framer-motion'
import { Clock, Phone, Mail, TriangleAlert, Check, Loader2 } from 'lucide-react'
import { useStoreSettings } from '../hooks/useStoreSettings'
import { usePersistentState } from '../hooks/usePersistentState'
import { WhatsAppIcon } from '../components/ui/WhatsAppIcon'
import { storefront } from '../lib/api'
import { useStaticPageSeo } from '../lib/seo/staticPageSeo'
import { SEO } from '../components/seo/SEO'

const INITIAL_EMERGENCY_FORM = { name: '', phone: '', partDescription: '', vesselName: '' }

export default function Emergency() {
  const { t } = useTranslation()
  const seo = useStaticPageSeo('emergency')
  const clockSectionRef = useRef<HTMLDivElement>(null!)
  const clockInView = useInView(clockSectionRef, { once: true, amount: 0.3 })
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const { whatsappNumber, phoneNumber, emergencyEmail } = useStoreSettings()
  // Draft survives hard refresh — critical for an emergency form.
  const [form, setForm] = usePersistentState('alka-emergency-draft', INITIAL_EMERGENCY_FORM)

  return (
    <div className="relative">
      <SEO
        title={seo.title}
        description={seo.description}
        canonical="/emergency"
      />
      {/* Dark red gradient overlay */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: 'radial-gradient(ellipse at 50% 0%, var(--danger-glow) 0%, transparent 70%)',
      }} />

      <section className="py-24 text-center relative">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6">
          <span className="inline-flex items-center gap-2 font-mono text-xs px-3 py-1.5 border border-danger text-danger bg-[var(--surface)] mb-4">
            <TriangleAlert size={12} /> {t('emergency.label')}
          </span>
          <h1 className="font-display font-bold text-display-2xl tracking-tight text-danger mb-4">
            {t('emergency.title')}
          </h1>
          <p className="text-body-lg text-[var(--text-primary)] font-semibold mb-8">
            {t('emergency.sub')}
          </p>
          <div className="flex gap-4 justify-center flex-wrap">
            <a href={`https://wa.me/${whatsappNumber}`}
              className="inline-flex items-center gap-2 px-7 py-3.5 bg-danger text-[var(--btn-danger-text)] font-semibold text-sm border border-danger hover:bg-danger hover:border-danger hover:-translate-y-0.5 transition-all shadow-[0_0_20px_var(--danger-border)] rounded-xl">
              <WhatsAppIcon size={16} /> {t('emergency.ctaWhatsapp')}
            </a>
            <a href={`tel:${phoneNumber}`}
              className="inline-flex items-center gap-2 px-7 py-3.5 bg-transparent text-danger font-semibold text-sm border border-danger hover:bg-danger/10 hover:-translate-y-0.5 transition-all rounded-xl">
              <Phone size={16} /> {t('emergency.ctaCall')}
            </a>
          </div>
        </div>
      </section>

      {/* Emergency clock demo */}
      <section className="py-16" ref={clockSectionRef}>
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
            <motion.div
              className="bg-[var(--secondary-bg)] border border-[var(--border)] p-6 sm:p-10 text-center"
              animate={clockInView ? {
                boxShadow: ['0 0 0px 0px var(--danger-subtle)', '0 0 40px 15px var(--danger-subtle)', '0 0 0px 0px var(--danger-subtle)'],
                scale: [1, 1.02, 1],
              } : {}}
              transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
            >
              <motion.div
                className="inline-flex"
                animate={clockInView ? { rotate: 360 } : { rotate: 0 }}
                transition={{ duration: 10, repeat: Infinity, ease: 'linear' }}
              >
                <Clock size={48} className="text-danger mb-4" />
              </motion.div>
              <h2 className="text-lg font-semibold mb-2">{t('emergency.responseClock')}</h2>
              <p className="text-sm text-[var(--text-secondary)] mb-4">{t('emergency.responseRecord')}</p>
              <motion.div
                className="font-mono text-4xl text-danger"
                animate={clockInView ? { scale: [0.8, 1, 0.8], opacity: [0.5, 1, 0.5] } : {}}
                transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
              >
                24/7
              </motion.div>
              <p className="text-xs text-[var(--text-muted)] mt-2">{t('emergency.alwaysOperational')}</p>
            </motion.div>

            <div className="bg-[var(--secondary-bg)] border border-[var(--border)] border-l-[3px] border-l-danger p-5 sm:p-8">
              <h3 className="text-base font-semibold mb-4">{t('emergency.emergencyContacts')}</h3>
              <div className="flex flex-col gap-3">
                {[
                  { Icon: WhatsAppIcon, href: `https://wa.me/${whatsappNumber}`, label: t('emergency.whatsappLabel'), text: t('emergency.emergencyText') },
                  { Icon: Phone, href: `tel:${phoneNumber}`, label: t('emergency.phoneLabel'), text: phoneNumber },
                  { Icon: Mail, href: `mailto:${emergencyEmail}`, label: t('emergency.emailLabel'), text: emergencyEmail },
                ].map((item, i) => (
                  <motion.a
                    key={item.label}
                    href={item.href}
                    className="flex items-center gap-3 text-sm text-[var(--text-secondary)] no-underline hover:text-danger transition-colors p-3 bg-[var(--surface)] border border-[var(--border)]"
                    initial={{ x: 30, opacity: 0 }}
                    animate={clockInView ? { x: 0, opacity: 1 } : { x: 30, opacity: 0 }}
                    transition={{ delay: i * 0.15, duration: 0.4, ease: 'easeOut' }}
                    whileHover={{ x: 4 }}
                  >
                    <item.Icon size={18} className="text-danger flex-shrink-0" />
                    <div>
                      <strong className="text-[var(--text-primary)] block text-xs">{item.label}</strong>
                      {item.text}
                    </div>
                  </motion.a>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Emergency RFQ form */}
      <section className="py-16">
        <div className="max-w-[640px] mx-auto px-4 sm:px-6">
          <form onSubmit={async (e) => {
            e.preventDefault()
            setLoading(true)
            setError('')
            try {
              await storefront.contact.emergency({
                name: form.name,
                phone: form.phone,
                partDescription: form.partDescription,
                vesselName: form.vesselName || undefined,
              })
              setSubmitted(true)
              setForm(INITIAL_EMERGENCY_FORM) // Draft fulfilled — start clean next time.
            } catch (err: any) {
              setError(err.message || 'Failed to submit emergency request. Please call us directly.')
            } finally {
              setLoading(false)
            }
          }} className="bg-[var(--secondary-bg)] border border-[var(--danger)]/30 p-6 sm:p-10">
            <h2 className="text-lg font-semibold mb-6">{t('emergency.formTitle')}</h2>
            {error && <p className="text-xs text-[var(--danger)] mb-4">{error}</p>}
            <div className="mb-4">
              <label htmlFor="emergency-name" className="sr-only">{t('emergency.formName')}</label>
              <input id="emergency-name" type="text" placeholder={t('emergency.formName')} required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-4 py-3 bg-[var(--input-bg)] border border-[var(--input-border)] text-sm text-[var(--input-text)] placeholder:text-[var(--input-placeholder)] rounded-xl focus:border-[var(--danger)] focus:shadow-[0_0_0_3px_var(--danger-border)] transition-all outline-none" />
            </div>
            <div className="mb-4">
              <label htmlFor="emergency-phone" className="sr-only">{t('emergency.formPhone')}</label>
              <input id="emergency-phone" type="tel" placeholder={t('emergency.formPhone')} required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full px-4 py-3 bg-[var(--input-bg)] border border-[var(--input-border)] text-sm text-[var(--input-text)] placeholder:text-[var(--input-placeholder)] rounded-xl focus:border-[var(--danger)] focus:shadow-[0_0_0_3px_var(--danger-border)] transition-all outline-none" />
            </div>
            <div className="mb-4">
              <label htmlFor="emergency-part" className="sr-only">{t('emergency.formPartDesc')}</label>
              <textarea id="emergency-part" rows={3} placeholder={t('emergency.formPartDesc')} required value={form.partDescription} onChange={(e) => setForm({ ...form, partDescription: e.target.value })} className="w-full px-4 py-3 bg-[var(--input-bg)] border border-[var(--input-border)] text-sm text-[var(--input-text)] placeholder:text-[var(--input-placeholder)] rounded-xl focus:border-[var(--danger)] focus:shadow-[0_0_0_3px_var(--danger-border)] transition-all outline-none resize-vertical min-h-[80px]" />
            </div>
            <div className="mb-6">
              <label htmlFor="emergency-vessel" className="sr-only">{t('emergency.formVessel')}</label>
              <input id="emergency-vessel" type="text" placeholder={t('emergency.formVessel')} value={form.vesselName} onChange={(e) => setForm({ ...form, vesselName: e.target.value })} className="w-full px-4 py-3 bg-[var(--input-bg)] border border-[var(--input-border)] text-sm text-[var(--input-text)] placeholder:text-[var(--input-placeholder)] rounded-xl focus:border-[var(--danger)] focus:shadow-[0_0_0_3px_var(--danger-border)] transition-all outline-none" />
            </div>
            <button type={submitted ? 'button' : 'submit'} disabled={loading} onClick={() => submitted && setSubmitted(false)} aria-label={t('emergency.formSubmit')} className={`w-full flex items-center justify-center gap-2 px-7 py-3.5 font-semibold text-sm border transition-all rounded-xl ${submitted ? 'bg-[var(--success)] border-[var(--success)] text-[var(--btn-success-text)]' : 'bg-danger text-[var(--btn-danger-text)] border-danger hover:bg-danger shadow-[0_0_20px_var(--danger-border)]'}`}>
              {loading ? <><Loader2 size={16} className="animate-spin" /> Submitting...</> : submitted ? <><Check size={16} /> Request Submitted!</> : <><TriangleAlert size={16} /> {t('emergency.formSubmit')}</>}
            </button>
          </form>
        </div>
      </section>
    </div>
  )
}
