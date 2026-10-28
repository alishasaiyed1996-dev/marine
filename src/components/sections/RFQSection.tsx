import { useState, useEffect, useRef, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { CircleCheck, Mail, Send } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { useStoreSettings } from '../../hooks/useStoreSettings'
import { storefront } from '../../lib/api'
import { useLocalizedPath } from '../../lib/locale'
import { WhatsAppIcon } from '../ui/WhatsAppIcon'
import { ResponseCountdown } from '../ui/ResponseCountdown'
import { getRfqResponseDeadline } from '../../lib/rfqSla'
import { usePersistentState } from '../../hooks/usePersistentState'
import { trackRfqSubmit } from '../../lib/analytics'
import { readLeadAttribution } from '../../lib/leadAttribution'

// Stable initial shape so the persisted draft (usePersistentState) and the
// reset-on-submit both reference the same defaults.
const INITIAL_RFQ = {
  name: '',
  company: '',
  email: '',
  phone: '',
  productDesc: '',
  quantity: '1',
  urgency: 'standard',
}

export function RFQSection() {
  const { t } = useTranslation()
  const lp = useLocalizedPath()
  const [spotlight, setSpotlight] = useState({ x: 0, y: 0 })
  const [isHovering, setIsHovering] = useState(false)
  const [isTouchDevice, setIsTouchDevice] = useState(() => 'ontouchstart' in window || navigator.maxTouchPoints > 0)
  // Section rect captured once per hover instead of on every mousemove.
  // Reading layout (getBoundingClientRect) inside a state-driven mousemove
  // handler forced a synchronous reflow after each style write and dominated
  // main-thread time during the audit; the rect only needs re-measuring when
  // the pointer (re)enters the section.
  const sectionRectRef = useRef<DOMRect | null>(null)

  useEffect(() => {
    setIsTouchDevice('ontouchstart' in window || navigator.maxTouchPoints > 0)
  }, [])
  const { rfqId, rfqDeadline, setRfqDeadline } = useStore()
  const settings = useStoreSettings()
  // Track success locally: the shared store flag is the dedicated /rfq page's
  // state, and leaking it made a later /rfq visit show a success screen for a
  // home-page submission.
  const [submitted, setSubmitted] = useState(false)
  // Persisted draft: a customer who hard-refreshes (or fat-fingers F5) keeps
  // every field they already typed instead of losing the whole form.
  const [formData, setFormData] = usePersistentState<typeof INITIAL_RFQ>('alka-rfq-draft', INITIAL_RFQ)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  // Consent is a real, freely-given agreement — never a hardcoded `true`.
  const [consentGiven, setConsentGiven] = useState(false)
  const [consentError, setConsentError] = useState(false)

  const handleMouseEnter = (e: React.MouseEvent<HTMLElement>) => {
    if (isTouchDevice) return
    sectionRectRef.current = e.currentTarget.getBoundingClientRect()
    setIsHovering(true)
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLElement>) => {
    if (isTouchDevice) return
    const rect = sectionRectRef.current
    if (!rect) return
    setSpotlight({ x: e.clientX - rect.left, y: e.clientY - rect.top })
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (submitting) return
    if (!consentGiven) {
      setConsentError(true)
      return
    }
    setConsentError(false)
    setSubmitError('')
    setSubmitting(true)
    try {
      // Real submission — the visitor must never see a success screen for an
      // RFQ that was only written to a local store flag.
      // The placement tag stays when the visitor arrived directly; a tagged
      // or referred visit records its source instead.
      const attribution = readLeadAttribution()
      const source = attribution.origin !== 'direct' ? attribution.origin : 'home-rfq-section'
      const result = await storefront.rfq.submit({
        fullName: formData.name,
        company: formData.company || undefined,
        email: formData.email,
        phone: formData.phone || undefined,
        productDescription: formData.productDesc,
        quantity: Math.max(1, Number(formData.quantity) || 1),
        urgency: formData.urgency,
        consent: true,
        consentAt: new Date().toISOString(),
        source,
      })
      useStore.setState({ rfqId: result.rfqNumber || rfqId })
      setRfqDeadline(getRfqResponseDeadline(formData.urgency))
      setSubmitted(true)
      // Draft fulfilled — clear it so the next visit starts clean.
      setFormData(INITIAL_RFQ)
      // Non-PII lead conversion for GA4 (fires only with analytics consent).
      trackRfqSubmit({
        rfqNumber: result.rfqNumber,
        page: window.location.pathname,
        urgency: formData.urgency,
        hasPartNumber: false,
        origin: source,
        utmSource: attribution.utmSource,
        utmMedium: attribution.utmMedium,
        utmCampaign: attribution.utmCampaign,
        referrerHost: attribution.referrerHost,
      })
    } catch (err) {
      setSubmitError(
        err instanceof Error && err.message
          ? err.message
          : t('rfq.submitFailed')
      )
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <section className="section-y bg-[var(--secondary-bg)]">
        <div className="site-container">
          <div className="text-center py-12">
            <div className="w-24 h-24 mx-auto relative mb-8">
              <div className="w-24 h-24 rounded-full border-[3px] border-[var(--success)]" />
              <div className="absolute top-7 left-[34px] w-4 h-9 border-r-[3px] border-b-[3px] border-[var(--success)] animate-checkmark origin-center"
                style={{ transform: 'rotate(45deg)' }}
              />
            </div>
            <h3 className="text-xl font-bold mb-3 text-[var(--text-primary)]">{t('rfq.success')}</h3>
            <p className="font-mono text-lg text-[var(--accent-primary)] mb-2">{t('rfq.rfqId')}{rfqId}</p>
            <p className="text-sm text-[var(--text-secondary)]">{t('rfq.successSub')}</p>
            <div className="mt-6 flex justify-center">
              <ResponseCountdown deadline={rfqDeadline} />
            </div>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section
      className="section-y bg-[var(--secondary-bg)]"
      style={{
        backgroundImage: `linear-gradient(135deg, var(--teal-soft) 0%, transparent 48%), linear-gradient(180deg, var(--secondary-bg), var(--primary-bg))`,
      }}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => { setIsHovering(false); sectionRectRef.current = null }}
    >
      <div
        className="site-container grid grid-cols-1 items-center gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-12"
        style={{
          background: isTouchDevice
            ? 'radial-gradient(600px at 50% 50%, var(--gold-glow) 0%, transparent 80%)'
            : isHovering
            ? `radial-gradient(600px at ${spotlight.x}px ${spotlight.y}px, var(--gold-glow) 0%, transparent 80%)`
            : undefined,
        }}
      >
        <div>
          <h2 className="font-display font-bold text-section-xl tracking-tight mb-5">
            {t('rfq.homeForm.heading1')}<br />{t('rfq.homeForm.heading2')}
          </h2>
          <div className="gold-accent-bar mt-4 mb-6" />
          <p className="text-body text-[var(--text-secondary)] leading-relaxed mb-7 max-w-[520px]">
            {t('rfq.homeForm.sub')}
          </p>
          <ul className="flex flex-col gap-3.5 mb-7">
            <li className="flex items-center gap-3 text-body-sm text-[var(--text-secondary)]">
              <CircleCheck size={18} className="text-[var(--success)] flex-shrink-0" /> {t('rfq.homeForm.list1')}
            </li>
            <li className="flex items-center gap-3 text-body-sm text-[var(--text-secondary)]">
              <CircleCheck size={18} className="text-[var(--success)] flex-shrink-0" /> {t('rfq.homeForm.list2')}
            </li>
            <li className="flex items-center gap-3 text-body-sm text-[var(--text-secondary)]">
              <CircleCheck size={18} className="text-[var(--success)] flex-shrink-0" /> {t('rfq.homeForm.list3')}
            </li>
          </ul>
          <div className="flex flex-col gap-2.5">
            <a href={`https://wa.me/${settings.whatsappNumber}`} className="flex items-center gap-2.5 text-sm font-semibold no-underline text-[var(--text-primary)] hover:text-[var(--success)] transition-colors">
              <WhatsAppIcon size={18} className="text-[var(--success)]" /> {t('rfq.whatsappUsNow')}
            </a>
            <a href={`mailto:${settings.rfqEmail}`} className="flex items-center gap-2.5 text-sm font-semibold no-underline text-[var(--text-primary)] hover:text-[var(--accent-primary)] transition-colors">
              <Mail size={18} className="text-[var(--accent-blue)]" /> {settings.rfqEmail}
            </a>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="card p-6 md:p-9">
          <div className="mb-5">
            <label htmlFor="rfq-name" className="block text-xs font-semibold text-[var(--text-secondary)] mb-2">{t('rfq.name')} *</label>
            <input
              id="rfq-name"
              type="text"
              autoComplete="name"
              required
              value={formData.name}
              onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
              placeholder={t('rfq.placeholders.fullName')}
              className="w-full px-4 py-3.5 rounded-xl bg-[var(--surface-soft)] border border-[var(--border)] text-sm text-[var(--text-primary)] focus:border-[var(--accent-primary)] transition-all"
            />
          </div>
          <div className="mb-5">
            <label htmlFor="rfq-company" className="block text-xs font-semibold text-[var(--text-secondary)] mb-2">{t('rfq.company')}</label>
            <input
              id="rfq-company"
              type="text"
              autoComplete="organization"
              value={formData.company}
              onChange={(e) => setFormData((p) => ({ ...p, company: e.target.value }))}
              placeholder={t('rfq.placeholders.company')}
              className="w-full px-4 py-3.5 rounded-xl bg-[var(--surface-soft)] border border-[var(--border)] text-sm text-[var(--text-primary)] focus:border-[var(--accent-primary)] transition-all"
            />
          </div>
          <div className="mb-5">
            <label htmlFor="rfq-email" className="block text-xs font-semibold text-[var(--text-secondary)] mb-2">{t('rfq.email')} *</label>
            <input
              id="rfq-email"
              type="email"
              autoComplete="email"
              required
              value={formData.email}
              onChange={(e) => setFormData((p) => ({ ...p, email: e.target.value }))}
              placeholder={t('rfq.placeholders.email')}
              className="w-full px-4 py-3.5 rounded-xl bg-[var(--surface-soft)] border border-[var(--border)] text-sm text-[var(--text-primary)] focus:border-[var(--accent-primary)] transition-all"
            />
          </div>
          <div className="mb-5">
            <label htmlFor="rfq-phone" className="block text-xs font-semibold text-[var(--text-secondary)] mb-2">{t('rfq.phone')}</label>
            <input
              id="rfq-phone"
              type="tel"
              autoComplete="tel"
              value={formData.phone}
              onChange={(e) => setFormData((p) => ({ ...p, phone: e.target.value }))}
              placeholder={t('rfq.placeholders.phone')}
              className="w-full px-4 py-3.5 rounded-xl bg-[var(--surface-soft)] border border-[var(--border)] text-sm text-[var(--text-primary)] focus:border-[var(--accent-primary)] transition-all"
            />
          </div>
          <div className="mb-5">
            <label htmlFor="rfq-product" className="block text-xs font-semibold text-[var(--text-secondary)] mb-2">{t('rfq.productDesc')} *</label>
            <textarea
              id="rfq-product"
              required
              value={formData.productDesc}
              onChange={(e) => setFormData((p) => ({ ...p, productDesc: e.target.value }))}
              rows={3}
              placeholder={t('rfq.placeholders.productDesc')}
              className="w-full px-4 py-3.5 rounded-xl bg-[var(--surface-soft)] border border-[var(--border)] text-sm text-[var(--text-primary)] focus:border-[var(--accent-primary)] transition-all resize-vertical min-h-[80px]"
            />
          </div>
          <div className="mb-5">
            <label htmlFor="rfq-quantity" className="block text-xs font-semibold text-[var(--text-secondary)] mb-2">{t('rfq.quantity')}</label>
            <input
              id="rfq-quantity"
              type="number"
              inputMode="numeric"
              value={formData.quantity}
              onChange={(e) => setFormData((p) => ({ ...p, quantity: e.target.value }))}
              min={1}
              className="w-full px-4 py-3.5 rounded-xl bg-[var(--surface-soft)] border border-[var(--border)] text-sm text-[var(--text-primary)] focus:border-[var(--accent-primary)] transition-all"
            />
          </div>
          <div className="mb-7">
            <label htmlFor="rfq-urgency" className="block text-xs font-semibold text-[var(--text-secondary)] mb-2">{t('rfq.urgency')}</label>
            <select
              id="rfq-urgency"
              value={formData.urgency}
              onChange={(e) => setFormData((p) => ({ ...p, urgency: e.target.value }))}
              className="select-chevron w-full px-4 py-3.5 rounded-xl bg-[var(--surface-soft)] border border-[var(--border)] text-sm text-[var(--text-primary)] focus:border-[var(--accent-primary)] transition-all"
            >
              <option value="standard">{t('rfq.homeForm.optStd')}</option>
              <option value="urgent">{t('rfq.homeForm.optUrgent')}</option>
              <option value="emergency">{t('rfq.homeForm.optEmergency')}</option>
            </select>
          </div>
          {submitError && (
            <p className="mb-3 rounded-lg border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-4 py-3 text-xs text-[var(--danger)]" role="alert">
              {submitError}
            </p>
          )}
          {/* Consent must be freely given: the API used to receive a hardcoded
              `consent: true`, which records no actual agreement and links to no
              policy. */}
          <div className="mb-5 flex items-start gap-3">
            <input
              id="rfq-consent"
              type="checkbox"
              required
              checked={consentGiven}
              onChange={(e) => setConsentGiven(e.target.checked)}
              aria-invalid={consentError || undefined}
              aria-describedby={consentError ? 'rfq-consent-error' : undefined}
              className="mt-0.5 w-4 h-4 accent-[var(--accent-primary)] cursor-pointer shrink-0"
            />
            <label htmlFor="rfq-consent" className="text-xs text-[var(--text-secondary)] leading-relaxed cursor-pointer">
              {t('rfq.consent')}{' '}
              <a href={lp('/privacy-policy')} className="text-[var(--accent-primary)] underline">{t('rfq.consentPrivacy')}</a>
            </label>
          </div>
          {consentError && (
            <p id="rfq-consent-error" className="mb-3 text-xs text-[var(--danger)]" role="alert">
              {t('rfq.consentError')}
            </p>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="w-full flex items-center justify-center gap-2.5 btn-primary text-sm maritime-shimmer disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <Send size={14} />
            {submitting ? t('rfq.submitting') : t('rfq.submit')}
          </button>
        </form>
      </div>
    </section>
  )
}
