import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Shield, Clock, Globe, Mail, ChevronDown, Phone, Calendar, Zap, TriangleAlert, Loader2 } from 'lucide-react'
import { useStore } from '../store/useStore'
import { useStoreSettings } from '../hooks/useStoreSettings'
import { usePersistentState } from '../hooks/usePersistentState'
import { countries } from '../data/countries'
import { storefront } from '../lib/api'
import { useLocalizedPath } from '../lib/locale'
import { trackRfqSubmit } from '../lib/analytics'
import { readLeadAttribution } from '../lib/leadAttribution'
import { SEO } from '../components/seo/SEO'
import { useStaticPageSeo } from '../lib/seo/staticPageSeo'
import { WhatsAppIcon } from '../components/ui/WhatsAppIcon'
import { ResponseCountdown } from '../components/ui/ResponseCountdown'
import { getRfqResponseDeadline } from '../lib/rfqSla'
import type { RFQFormData } from '../types'

// Role options — labels resolve through i18n (rfq.role*) so the RFQ page
// renders in the visitor's language.
const roles = [
  { value: 'chief-engineer', labelKey: 'rfq.roleChiefEngineer' },
  { value: 'procurement-manager', labelKey: 'rfq.roleProcurementManager' },
  { value: 'plant-manager', labelKey: 'rfq.rolePlantManager' },
  { value: 'fleet-manager', labelKey: 'rfq.roleFleetManager' },
  { value: 'sourcing-head', labelKey: 'rfq.roleSourcingHead' },
  { value: 'owner', labelKey: 'rfq.roleOwner' },
  { value: 'other', labelKey: 'rfq.roleOther' },
]

const INITIAL_RFQ_FORM: RFQFormData = {
  fullName: '',
  company: '',
  email: '',
  phone: '',
  country: 'IN',
  role: '',
  productDesc: '',
  partNumber: '',
  brand: '',
  quantity: 1,
  deliveryLocation: '',
  urgency: 'standard',
  notes: '',
  source: '',
  consent: false,
}

export default function RFQ() {
  const { t } = useTranslation()
  const lp = useLocalizedPath()
  const seo = useStaticPageSeo('rfq')
  const { rfqStep, setRfqStep, rfqSubmitted, rfqId, setRfqSubmitted, generateRfqId, rfqDeadline, setRfqDeadline } = useStore()
  const { whatsappNumber, phoneNumber, rfqEmail } = useStoreSettings()
  // Draft persists across hard refresh — a multi-step inquiry is never lost.
  const [formData, setFormData] = usePersistentState<RFQFormData>('alka-rfq-page-draft', INITIAL_RFQ_FORM)
  const [errors, setErrors] = useState<Record<string, boolean>>({})
  const [openFaq, setOpenFaq] = useState<number | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  const update = (field: keyof RFQFormData, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
    setErrors((prev) => ({ ...prev, [field]: false }))
  }

  const validateStep = (step: number): boolean => {
    const newErrors: Record<string, boolean> = {}
    if (step === 1) {
      if (!formData.fullName.trim()) newErrors.fullName = true
      if (!formData.company.trim()) newErrors.company = true
      if (!formData.email.trim()) newErrors.email = true
      if (!formData.country) newErrors.country = true
    } else if (step === 2) {
      if (!formData.productDesc.trim()) newErrors.productDesc = true
      if (!formData.quantity || formData.quantity < 1) newErrors.quantity = true
      if (!formData.deliveryLocation.trim()) newErrors.deliveryLocation = true
    } else if (step === 3) {
      if (!formData.consent) newErrors.consent = true
    }
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const goToStep = (step: number) => {
    if (step > rfqStep && !validateStep(rfqStep)) return
    setRfqStep(step)
    const el = document.getElementById('rfq-form')
    if (el) {
      window.scrollTo({ top: el.offsetTop - 100, behavior: 'smooth' })
    }
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!validateStep(3)) return
    setSubmitting(true)
    setSubmitError('')
    try {
      // Machine attribution (UTM / referrer) fills the source only when the
      // visitor did not choose one themselves — a self-declared source always
      // wins, and `direct` carries no signal worth recording.
      const attribution = readLeadAttribution()
      const result = await storefront.rfq.submit({
        fullName: formData.fullName,
        company: formData.company,
        email: formData.email,
        phone: formData.phone || undefined,
        country: formData.country,
        role: formData.role || undefined,
        productDescription: formData.productDesc,
        partNumber: formData.partNumber || undefined,
        brand: formData.brand || undefined,
        quantity: formData.quantity,
        deliveryLocation: formData.deliveryLocation,
        urgency: formData.urgency,
        notes: formData.notes || undefined,
        source: formData.source || (attribution.origin !== 'direct' ? attribution.origin : undefined),
        consent: formData.consent,
      })
      // Use the server-assigned RFQ number if available
      if (result.rfqNumber) {
        useStore.setState({ rfqId: result.rfqNumber })
      } else {
        generateRfqId()
      }
      setRfqDeadline(getRfqResponseDeadline(formData.urgency))
      setRfqSubmitted(true)
      setRfqStep(1) // Reset step for next submission
      setFormData(INITIAL_RFQ_FORM) // Draft fulfilled — start clean next time.
      // Non-PII lead conversion for GA4 (fires only with analytics consent).
      trackRfqSubmit({
        rfqNumber: result.rfqNumber,
        page: window.location.pathname,
        urgency: formData.urgency,
        hasPartNumber: Boolean(formData.partNumber.trim()),
        country: formData.country,
        origin: formData.source || attribution.origin,
        utmSource: attribution.utmSource,
        utmMedium: attribution.utmMedium,
        utmCampaign: attribution.utmCampaign,
        referrerHost: attribution.referrerHost,
      })
    } catch (err: any) {
      setSubmitError(err.message || t('rfq.submitFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  if (rfqSubmitted) {
    return (
      <div className="py-24">
        <div className="max-w-[640px] mx-auto px-4 sm:px-6 text-center">
          <div className="w-20 h-20 mx-auto relative mb-6">
            <div className="w-20 h-20 rounded-full border-[3px] border-success" />
            <div className="absolute top-6 left-[30px] w-4 h-9 border-r-[3px] border-b-[3px] border-success"
              style={{ transform: 'rotate(45deg)' }} />
          </div>
          <h2 className="heading-xl mb-2">{t('rfq.success')}</h2>
          <p className="font-mono text-lg text-accent-gold mb-2">{t('rfq.rfqId')}{rfqId}</p>
          <p className="text-body-sm text-[var(--text-secondary)] max-w-[480px] mx-auto">
            {t('rfq.successSub')}
          </p>
          <div className="flex justify-center mt-6">
            <ResponseCountdown deadline={rfqDeadline} />
          </div>
          <div className="flex gap-4 flex-wrap justify-center mt-8">
            <Link to={lp('/rfq')} onClick={() => { setRfqSubmitted(false); setRfqStep(1) }} className="inline-flex items-center gap-2 text-xs font-semibold border border-[var(--accent-primary)] text-[var(--accent-primary)] px-[18px] py-[10px] hover:bg-[var(--accent-primary)]/10 transition-all no-underline rounded-xl">
              {t('rfq.submitAnother')}
            </Link>
            <Link to={lp('/products')} className="inline-flex items-center gap-2 text-xs font-semibold border border-[var(--accent-primary)] text-[var(--accent-primary)] px-[18px] py-[10px] hover:bg-[var(--accent-primary)]/10 transition-all no-underline rounded-xl">
              {t('rfq.browseProducts')}
            </Link>
            <a href={`https://wa.me/${whatsappNumber}`} className="inline-flex items-center gap-2 text-xs font-semibold border border-[var(--success)] text-[var(--success)] px-[18px] py-[10px] hover:bg-[var(--success)]/10 transition-all no-underline rounded-xl">
              <WhatsAppIcon size={14} /> {t('rfq.whatsappUsNow')}
            </a>
          </div>
        </div>
      </div>
    )
  }  return (
    <div>
      <SEO
        title={seo.title}
        description={seo.description}
        canonical="/rfq"
      />
      <section className="py-20 text-center" style={{
        background: 'radial-gradient(ellipse at 50% 0%, rgba(14,165,233,0.06) 0%, transparent 70%), var(--primary-bg)'
      }}>
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6">
          <span className="inline-block font-body font-medium text-xs tracking-[3px] uppercase text-[var(--text-muted)] mb-4">
            {t('rfq.label')}
          </span>
          <h1 className="font-display font-bold text-display-xl tracking-tight">
            {t('rfq.title')}
          </h1>
          <p className="text-body text-[var(--text-secondary)] max-w-[640px] mx-auto mt-4">
            {t('rfq.sub')}
          </p>
          <div className="flex justify-center gap-6 mt-7 flex-wrap">
            <span className="inline-flex items-center gap-1.5 font-mono text-xs px-3 py-1.5 border border-[var(--info-border)] text-[var(--accent-primary)] bg-[var(--surface)]">
              <Shield size={12} /> {t('rfq.verifiedSuppliers')}
            </span>
            <span className="inline-flex items-center gap-1.5 font-mono text-xs px-3 py-1.5 border border-[var(--warning-border)] text-[var(--accent-gold)] bg-[var(--surface)]">
              <Clock size={12} /> {t('rfq.hourResponse')}
            </span>
            <span className="inline-flex items-center gap-1.5 font-mono text-xs px-3 py-1.5 border border-[var(--success-border)] text-[var(--success)] bg-[var(--surface)]">
              <Globe size={12} /> {t('rfq.countries')}
            </span>
          </div>
        </div>
      </section>

      <section className="py-12" id="rfq-form">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-10 items-start">
            {/* Form */}
            <div>
              {/* Progress */}
              <div className="flex items-center justify-center gap-0 mb-10">
                {[1, 2, 3].map((step) => (
                  <div key={step} className="flex items-center">
                    <div className="flex items-center gap-2.5">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center font-display font-bold text-sm border-2 transition-all ${
                        step === rfqStep
                          ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)] text-[var(--btn-blue-text)]'
                          : step < rfqStep
                          ? 'border-[var(--success)] bg-[var(--success)] text-[var(--btn-success-text)]'
                          : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)]'
                      }`}>
                        {step}
                      </div>
                      <span className={`text-xs font-medium hidden sm:block ${
                        step === rfqStep ? 'text-[var(--accent-primary)]' : step < rfqStep ? 'text-[var(--success)]' : 'text-[var(--text-muted)]'
                      }`}>
                        {step === 1 ? t('rfq.contactStep') : step === 2 ? t('rfq.productStep') : t('rfq.urgencyStep')}
                      </span>
                    </div>
                    {step < 3 && (
                      // Connector shrinks below 360px: at 280px (Galaxy Fold
                      // cover screen) 3×40px circles + 2×80px connectors +
                      // margins = 312px, wider than the viewport.
                      <div className={`w-20 max-[359px]:w-10 h-0.5 mx-2 transition-colors ${
                        step < rfqStep ? 'bg-success' : 'bg-[var(--border)]'
                      }`} />
                    )}
                  </div>
                ))}
              </div>

              <form onSubmit={handleSubmit} className="bg-surface border border-[var(--border)] p-6 sm:p-10">
                {/* Step 1 */}
                {rfqStep === 1 && (
                  <div>
                    <h3 className="text-lg font-semibold mb-6">{t('rfq.formContact')}</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                      <div className="mb-5">
                        <label htmlFor="rfq-name" className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">{t('rfq.name')} *</label>
                        <input id="rfq-name" type="text" value={formData.fullName} onChange={(e) => update('fullName', e.target.value)}
                          autoComplete="name"
                          className={`w-full px-4 py-3 bg-[var(--surface-soft)] border border-[var(--border)] text-sm text-[var(--text-primary)] focus:border-accent-gold focus:shadow-focus-gold transition-all outline-none ${errors.fullName ? 'border-danger' : 'border-[var(--border)]'}`}
                          placeholder={t("rfq.placeholders.fullName")} />
                      </div>
                      <div className="mb-5">
                        <label htmlFor="rfq-company" className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">{t('rfq.company')} *</label>
                        <input id="rfq-company" type="text" value={formData.company} onChange={(e) => update('company', e.target.value)}
                          autoComplete="organization"
                          className={`w-full px-4 py-3 bg-[var(--surface-soft)] border border-[var(--border)] text-sm text-[var(--text-primary)] focus:border-accent-gold focus:shadow-focus-gold transition-all outline-none ${errors.company ? 'border-danger' : 'border-[var(--border)]'}`}
                          placeholder={t("rfq.placeholders.company")} />
                      </div>
                      <div className="mb-5">
                        <label htmlFor="rfq-email" className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">{t('rfq.email')} *</label>
                        <input id="rfq-email" type="email" value={formData.email} onChange={(e) => update('email', e.target.value)}
                          autoComplete="email"
                          className={`w-full px-4 py-3 bg-[var(--surface-soft)] border border-[var(--border)] text-sm text-[var(--text-primary)] focus:border-accent-gold focus:shadow-focus-gold transition-all outline-none ${errors.email ? 'border-danger' : 'border-[var(--border)]'}`}
                          placeholder={t("rfq.placeholders.email")} />
                      </div>
                      <div className="mb-5">
                        <label htmlFor="rfq-phone" className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">{t('rfq.phone')}</label>
                        <input id="rfq-phone" type="tel" value={formData.phone} onChange={(e) => update('phone', e.target.value)}
                          autoComplete="tel"
                          className="w-full px-4 py-3 bg-[var(--surface-soft)] border border-[var(--border)] text-sm text-[var(--text-primary)] focus:border-accent-gold focus:shadow-focus-gold transition-all outline-none"
                          placeholder={t("rfq.placeholders.phone")} />
                      </div>
                      <div className="mb-5">
                        <label htmlFor="rfq-country" className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">{t('rfq.country')} *</label>
                        <select id="rfq-country" value={formData.country} onChange={(e) => update('country', e.target.value)}
                          className={`select-chevron w-full px-4 py-3 bg-[var(--surface-soft)] border border-[var(--border)] text-sm text-[var(--text-primary)] focus:border-accent-gold focus:shadow-focus-gold transition-all outline-none ${errors.country ? 'border-danger' : 'border-[var(--border)]'}`}>
                          {countries.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                        </select>
                      </div>
                      <div className="mb-5">
                        <label htmlFor="rfq-role" className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">{t('rfq.role')}</label>
                        <select id="rfq-role" value={formData.role} onChange={(e) => update('role', e.target.value)}
                          className="select-chevron w-full px-4 py-3 bg-[var(--surface-soft)] border border-[var(--border)] text-sm text-[var(--text-primary)] focus:border-accent-gold focus:shadow-focus-gold transition-all outline-none">
                          <option value="">{t('rfq.placeholders.selectRole')}</option>
                          {roles.map((r) => <option key={r.value} value={r.value}>{t(r.labelKey)}</option>)}
                        </select>
                      </div>
                    </div>
                    <button type="button" onClick={() => goToStep(2)}
                      className="w-full flex items-center justify-center gap-2 px-7 py-3.5 bg-[var(--accent-primary)] text-[var(--btn-blue-text)] font-semibold text-sm border border-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] transition-all mt-2 rounded-xl">
                      {t('rfq.nextProduct')}
                    </button>
                  </div>
                )}

                {/* Step 2 */}
                {rfqStep === 2 && (
                  <div>
                    <h3 className="text-lg font-semibold mb-6">{t('rfq.formProduct')}</h3>
                    <div className="mb-5">
                      <label htmlFor="rfq-product-desc" className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">{t('rfq.productDesc')} *</label>
                      <textarea id="rfq-product-desc" value={formData.productDesc} onChange={(e) => update('productDesc', e.target.value)} rows={4}
                        className={`w-full px-4 py-3 bg-[var(--surface-soft)] border border-[var(--border)] text-sm text-[var(--text-primary)] focus:border-accent-gold focus:shadow-focus-gold transition-all outline-none resize-vertical min-h-[80px] ${errors.productDesc ? 'border-danger' : 'border-[var(--border)]'}`}
                        placeholder={t('rfq.placeholders.productDesc')} />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                      <div className="mb-5">
                        <label htmlFor="rfq-part-number" className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">{t('rfq.partNumber')}</label>
                        <input id="rfq-part-number" type="text" autoComplete="off" value={formData.partNumber} onChange={(e) => update('partNumber', e.target.value)}
                          className="w-full px-4 py-3 bg-[var(--surface-soft)] border border-[var(--border)] text-sm font-mono text-[var(--text-primary)] focus:border-accent-gold focus:shadow-focus-gold transition-all outline-none"
                          placeholder={t('rfq.placeholders.partNumber')} />
                      </div>
                      <div className="mb-5">
                        <label htmlFor="rfq-brand" className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">{t('rfq.brand')}</label>
                        <input id="rfq-brand" type="text" autoComplete="off" value={formData.brand} onChange={(e) => update('brand', e.target.value)}
                          className="w-full px-4 py-3 bg-[var(--surface-soft)] border border-[var(--border)] text-sm text-[var(--text-primary)] focus:border-accent-gold focus:shadow-focus-gold transition-all outline-none"
                          placeholder={t('rfq.placeholders.brand')} />
                      </div>
                      <div className="mb-5">
                        <label htmlFor="rfq-qty" className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">{t('rfq.quantity')} *</label>
                        <input id="rfq-qty" type="number" inputMode="numeric" value={formData.quantity} onChange={(e) => update('quantity', parseInt(e.target.value) || 1)} min={1}
                          className={`w-full px-4 py-3 bg-[var(--surface-soft)] border border-[var(--border)] text-sm text-[var(--text-primary)] focus:border-accent-gold focus:shadow-focus-gold transition-all outline-none ${errors.quantity ? 'border-danger' : 'border-[var(--border)]'}`} />
                      </div>
                      <div className="mb-5">
                        <label htmlFor="rfq-delivery-location" className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">{t('rfq.deliveryLocation')} *</label>
                        <input id="rfq-delivery-location" type="text" value={formData.deliveryLocation} onChange={(e) => update('deliveryLocation', e.target.value)}
                          className={`w-full px-4 py-3 bg-[var(--surface-soft)] border border-[var(--border)] text-sm text-[var(--text-primary)] focus:border-accent-gold focus:shadow-focus-gold transition-all outline-none ${errors.deliveryLocation ? 'border-danger' : 'border-[var(--border)]'}`}
                          placeholder={t('rfq.placeholders.deliveryLocation')} />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mt-2">
                      <button type="button" onClick={() => goToStep(1)}
                        className="flex items-center justify-center gap-2 px-3 sm:px-7 py-3.5 bg-transparent text-[var(--accent-primary)] font-semibold text-sm border border-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/10 transition-all rounded-xl">
                        {t('rfq.back')}
                      </button>
                      <button type="button" onClick={() => goToStep(3)}
                        className="flex items-center justify-center gap-2 px-3 sm:px-7 py-3.5 bg-[var(--accent-primary)] text-[var(--btn-blue-text)] font-semibold text-sm border border-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] transition-all rounded-xl">
                        {t('rfq.nextUrgency')}
                      </button>
                    </div>
                  </div>
                )}

                {/* Step 3 */}
                {rfqStep === 3 && (
                  <div>
                    <h3 className="text-lg font-semibold mb-6">{t('rfq.formUrgency')}</h3>
                    <div className="mb-5">
                      <label className="block text-xs font-medium text-[var(--text-secondary)] mb-3">{t('rfq.urgencyLabel')}</label>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        {(['standard', 'urgent', 'emergency'] as const).map((u) => (
                          <label key={u} className="cursor-pointer">
                            <input type="radio" name="urgency" checked={formData.urgency === u}
                              onChange={() => update('urgency', u)} className="sr-only peer" />
                            <div className={`peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--accent-primary)] flex flex-col items-center gap-1.5 p-5 bg-[var(--primary-bg)] border-2 text-center transition-all ${
                              formData.urgency === u
                                ? u === 'urgent' ? 'border-[var(--accent-gold)] bg-[var(--warning-subtle)]'
                                  : u === 'emergency' ? 'border-[var(--danger)] bg-[var(--danger-glow)]'
                                  : 'border-[var(--accent-primary)] bg-[var(--info-subtle)]'
                                : u === 'urgent' ? 'border-[var(--warning-border)]'
                                  : u === 'emergency' ? 'border-[var(--danger-border)]'
                                  : 'border-[var(--border)]'
                            }`}>
                              <span className={`flex items-center justify-center ${
                                u === 'urgent' ? 'text-[var(--accent-gold)]' : u === 'emergency' ? 'text-[var(--danger)]' : 'text-[var(--accent-primary)]'
                              }`}>
                                {u === 'standard' ? <Calendar size={24} /> : u === 'urgent' ? <Zap size={24} /> : <TriangleAlert size={24} />}
                              </span>
                              <strong className="text-sm capitalize">{u === 'standard' ? t('rfq.urgencyStandard') : u === 'urgent' ? t('rfq.urgencyUrgent') : t('rfq.urgencyEmergency')}</strong>
                              <span className="font-mono text-xs text-[var(--text-muted)]">
                                {u === 'standard' ? t('rfq.urgencyStandardDesc') : u === 'urgent' ? t('rfq.urgencyUrgentDesc') : t('rfq.urgencyEmergencyDesc')}
                              </span>
                            </div>
                          </label>
                        ))}
                      </div>
                    </div>
                    <div className="mb-5">
                      <label htmlFor="rfq-notes" className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">{t('rfq.notes')}</label>
                      <textarea id="rfq-notes" value={formData.notes} onChange={(e) => update('notes', e.target.value)} rows={3}
                        className="w-full px-4 py-3 bg-[var(--surface-soft)] border border-[var(--border)] text-sm text-[var(--text-primary)] focus:border-accent-gold focus:shadow-focus-gold transition-all outline-none resize-vertical min-h-[80px]"
                        placeholder={t('rfq.placeholders.notes')} />
                    </div>
                    <div className="mb-5">
                      <label htmlFor="rfq-source" className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">{t('rfq.source')}</label>
                      <select id="rfq-source" value={formData.source} onChange={(e) => update('source', e.target.value)}
                        className="select-chevron w-full px-4 py-3 bg-[var(--surface-soft)] border border-[var(--border)] text-sm text-[var(--text-primary)] focus:border-accent-gold focus:shadow-focus-gold transition-all outline-none">
                        <option value="">{t('rfq.sourceOptionSelect')}</option>
                        <option value="google">{t('rfq.sourceOptionGoogle')}</option>
                        <option value="linkedin">{t('rfq.sourceOptionLinkedin')}</option>
                        <option value="referral">{t('rfq.sourceOptionReferral')}</option>
                        <option value="other">{t('rfq.sourceOptionOther')}</option>
                      </select>
                    </div>
                    <label className="flex items-center gap-2 mb-5 cursor-pointer">
                      <input type="checkbox" checked={formData.consent}
                        onChange={(e) => update('consent', e.target.checked)}
                        className="accent-[var(--accent-primary)] w-4 h-4 cursor-pointer" />
                      <span className={`text-xs ${errors.consent ? 'text-danger' : 'text-[var(--text-secondary)]'}`}>
                        {t('rfq.consent')}
                      </span>
                    </label>
                    {submitError && <p className="text-xs text-[var(--danger)] mb-4">{submitError}</p>}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                      <button type="button" onClick={() => goToStep(2)}
                        className="flex items-center justify-center gap-2 px-3 sm:px-7 py-3.5 bg-transparent text-[var(--accent-primary)] font-semibold text-sm border border-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/10 transition-all rounded-xl">
                        {t('rfq.back')}
                      </button>
                      <button type="submit" disabled={submitting}
                        className="flex items-center justify-center gap-2 px-3 sm:px-7 py-3.5 bg-[var(--accent-primary)] text-[var(--btn-blue-text)] font-semibold text-sm border border-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] transition-all relative overflow-hidden disabled:opacity-50 rounded-xl">
                        {submitting ? <><Loader2 size={16} className="animate-spin" /> {t('rfq.submitting')}</> : t('rfq.submit')}
                      </button>
                    </div>
                  </div>
                )}
              </form>
            </div>

            {/* Sidebar */}
            <aside className="lg:sticky lg:top-20">
              <div className="bg-[var(--surface)] border border-[var(--border)] p-6">
                <h4 className="text-sm font-semibold mb-4">{t('rfq.whyChoose')}</h4>
                <div className="flex flex-col">
                  {([1, 2, 3, 4] as const).map((i) => (
                    <div key={i} className="border-b border-[var(--border)] last:border-b-0">
                      <button onClick={() => setOpenFaq(openFaq === i - 1 ? null : i - 1)}
                        className="flex justify-between items-center w-full py-4 text-sm font-semibold text-left text-[var(--text-primary)] hover:text-[var(--accent-primary)] transition-colors bg-transparent border-none cursor-pointer">
                        <span>{t(`rfq.faq${i}q`)}</span>
                        <ChevronDown size={14} className={`text-[var(--text-muted)] transition-transform ${openFaq === i - 1 ? 'rotate-180' : ''}`} />
                      </button>
                      {openFaq === i - 1 && (
                        <p className="text-xs text-[var(--text-secondary)] pb-4 leading-relaxed">{t(`rfq.faq${i}a`)}</p>
                      )}
                    </div>
                  ))}
                </div>
                <div className="mt-6 p-5 bg-[var(--surface)] border border-[var(--border)]">
                  <p className="text-sm font-semibold mb-3">{t('rfq.questionsContact')}</p>
                  <a href={`mailto:${rfqEmail}`} className="flex items-center gap-2 text-xs text-[var(--text-secondary)] no-underline hover:text-[var(--accent-primary)] mb-2">
                    <Mail size={14} className="text-[var(--accent-primary)]" /> {rfqEmail}
                  </a>
                  <a href={`tel:${phoneNumber}`} className="flex items-center gap-2 text-xs text-[var(--text-secondary)] no-underline hover:text-[var(--accent-primary)] mb-2">
                    <Phone size={14} className="text-[var(--accent-primary)]" /> {phoneNumber}
                  </a>
                  <a href={`https://wa.me/${whatsappNumber}`}
                    className="flex items-center justify-center gap-2 text-xs font-semibold border border-[var(--accent-primary)] text-[var(--accent-primary)] px-[18px] py-[10px] mt-3 hover:bg-[var(--accent-primary)]/10 transition-all no-underline rounded-xl">
                    <WhatsAppIcon size={14} className="text-[var(--success)]" /> {t('contact.whatsapp')}
                  </a>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </section>
    </div>
  )
}

