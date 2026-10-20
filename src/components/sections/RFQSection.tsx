import { useState, useEffect, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { CircleCheck, Mail, Send } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { useStoreSettings } from '../../hooks/useStoreSettings'
import { storefront } from '../../lib/api'
import { WhatsAppIcon } from '../ui/WhatsAppIcon'
import { ResponseCountdown } from '../ui/ResponseCountdown'
import { getRfqResponseDeadline } from '../../lib/rfqSla'
import { usePersistentState } from '../../hooks/usePersistentState'

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
  const [spotlight, setSpotlight] = useState({ x: 0, y: 0 })
  const [isHovering, setIsHovering] = useState(false)
  const [isTouchDevice, setIsTouchDevice] = useState(() => 'ontouchstart' in window || navigator.maxTouchPoints > 0)

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

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isTouchDevice) return
    const rect = e.currentTarget.getBoundingClientRect()
    setSpotlight({ x: e.clientX - rect.left, y: e.clientY - rect.top })
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (submitting) return
    setSubmitError('')
    setSubmitting(true)
    try {
      // Real submission — the visitor must never see a success screen for an
      // RFQ that was only written to a local store flag.
      const result = await storefront.rfq.submit({
        fullName: formData.name,
        company: formData.company || undefined,
        email: formData.email,
        phone: formData.phone || undefined,
        productDescription: formData.productDesc,
        quantity: Math.max(1, Number(formData.quantity) || 1),
        urgency: formData.urgency,
        consent: true,
        source: 'home-rfq-section',
      })
      useStore.setState({ rfqId: result.rfqNumber || rfqId })
      setRfqDeadline(getRfqResponseDeadline(formData.urgency))
      setSubmitted(true)
      // Draft fulfilled — clear it so the next visit starts clean.
      setFormData(INITIAL_RFQ)
    } catch (err) {
      setSubmitError(
        err instanceof Error && err.message
          ? err.message
          : 'Failed to send your RFQ. Please try again or contact us on WhatsApp.'
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
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
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
            Cannot find the ship spare?<br />Send the nameplate.
          </h2>
          <div className="gold-accent-bar mt-4 mb-6" />
          <p className="text-body text-[var(--text-secondary)] leading-relaxed mb-7 max-w-[520px]">
            Upload a part description, model number, maker name, serial plate, or product photo. We will check Alang/Bhavnagar stock, compatible alternatives, condition, packing, and export options before quoting.
          </p>
          <ul className="flex flex-col gap-3.5 mb-7">
            <li className="flex items-center gap-3 text-body-sm text-[var(--text-secondary)]">
              <CircleCheck size={18} className="text-[var(--success)] flex-shrink-0" /> Tested used, refurbished, and new old stock options
            </li>
            <li className="flex items-center gap-3 text-body-sm text-[var(--text-secondary)]">
              <CircleCheck size={18} className="text-[var(--success)] flex-shrink-0" /> Response target within 4 business hours
            </li>
            <li className="flex items-center gap-3 text-body-sm text-[var(--text-secondary)]">
              <CircleCheck size={18} className="text-[var(--success)] flex-shrink-0" /> DHL, FedEx, air freight, and sea freight support
            </li>
          </ul>
          <div className="flex flex-col gap-2.5">
            <a href={`https://wa.me/${settings.whatsappNumber}`} className="flex items-center gap-2.5 text-sm font-semibold no-underline text-[var(--text-primary)] hover:text-[var(--success)] transition-colors">
              <WhatsAppIcon size={18} className="text-[var(--success)]" /> WhatsApp Us Now
            </a>
            <a href={`mailto:${settings.rfqEmail}`} className="flex items-center gap-2.5 text-sm font-semibold no-underline text-[var(--text-primary)] hover:text-[var(--accent-primary)] transition-colors">
              <Mail size={18} className="text-[var(--accent-blue)]" /> {settings.rfqEmail}
            </a>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="card p-6 md:p-9">
          <div className="mb-5">
            <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-2">Full Name *</label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
              placeholder="Your full name"
              className="w-full px-4 py-3.5 rounded-xl bg-[var(--surface-soft)] border border-[var(--border)] text-sm text-[var(--text-primary)] focus:border-[var(--accent-primary)] transition-all"
            />
          </div>
          <div className="mb-5">
            <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-2">Company Name</label>
            <input
              type="text"
              value={formData.company}
              onChange={(e) => setFormData((p) => ({ ...p, company: e.target.value }))}
              placeholder="Company name"
              className="w-full px-4 py-3.5 rounded-xl bg-[var(--surface-soft)] border border-[var(--border)] text-sm text-[var(--text-primary)] focus:border-[var(--accent-primary)] transition-all"
            />
          </div>
          <div className="mb-5">
            <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-2">Email Address *</label>
            <input
              type="email"
              required
              value={formData.email}
              onChange={(e) => setFormData((p) => ({ ...p, email: e.target.value }))}
              placeholder="you@company.com"
              className="w-full px-4 py-3.5 rounded-xl bg-[var(--surface-soft)] border border-[var(--border)] text-sm text-[var(--text-primary)] focus:border-[var(--accent-primary)] transition-all"
            />
          </div>
          <div className="mb-5">
            <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-2">Phone Number</label>
            <input
              type="tel"
              value={formData.phone}
              onChange={(e) => setFormData((p) => ({ ...p, phone: e.target.value }))}
              placeholder={t('rfq.placeholders.phone') || '+1 555 000 0000'}
              className="w-full px-4 py-3.5 rounded-xl bg-[var(--surface-soft)] border border-[var(--border)] text-sm text-[var(--text-primary)] focus:border-[var(--accent-primary)] transition-all"
            />
          </div>
          <div className="mb-5">
            <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-2">Product Name or Description *</label>
            <textarea
              required
              value={formData.productDesc}
              onChange={(e) => setFormData((p) => ({ ...p, productDesc: e.target.value }))}
              rows={3}
              placeholder="Example: Furuno radar display, ABB drive, Parker hydraulic pump, MAN B&W engine spare, or a nameplate photo reference"
              className="w-full px-4 py-3.5 rounded-xl bg-[var(--surface-soft)] border border-[var(--border)] text-sm text-[var(--text-primary)] focus:border-[var(--accent-primary)] transition-all resize-vertical min-h-[80px]"
            />
          </div>
          <div className="mb-5">
            <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-2">Quantity Required</label>
            <input
              type="number"
              value={formData.quantity}
              onChange={(e) => setFormData((p) => ({ ...p, quantity: e.target.value }))}
              min={1}
              className="w-full px-4 py-3.5 rounded-xl bg-[var(--surface-soft)] border border-[var(--border)] text-sm text-[var(--text-primary)] focus:border-[var(--accent-primary)] transition-all"
            />
          </div>
          <div className="mb-7">
            <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-2">Urgency</label>
            <select
              value={formData.urgency}
              onChange={(e) => setFormData((p) => ({ ...p, urgency: e.target.value }))}
              className="w-full px-4 py-3.5 rounded-xl bg-[var(--surface-soft)] border border-[var(--border)] text-sm text-[var(--text-primary)] focus:border-[var(--accent-primary)] transition-all appearance-none"
              style={{
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%2394A3B8' viewBox='0 0 16 16'%3E%3Cpath d='M8 11L3 6h10l-5 5z'/%3E%3C/svg%3E")`,
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'right 12px center',
              }}
            >
              <option value="standard">Standard (7-14 days)</option>
              <option value="urgent">Urgent (24-48 hours)</option>
              <option value="emergency">Emergency (Same day)</option>
            </select>
          </div>
          {submitError && (
            <p className="mb-3 rounded-lg border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-4 py-3 text-xs text-[var(--danger)]" role="alert">
              {submitError}
            </p>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="w-full flex items-center justify-center gap-2.5 btn-primary text-sm maritime-shimmer disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <Send size={14} />
            {submitting ? 'Submitting…' : 'Submit RFQ'}
          </button>
        </form>
      </div>
    </section>
  )
}
