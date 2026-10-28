import { memo } from 'react'
import { Link } from 'react-router-dom'
import { Mail, Phone, MapPin } from 'lucide-react'
import { WhatsAppIcon } from '../ui/WhatsAppIcon'

function LinkedInIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 1 1 0-4.124 2.062 2.062 0 0 1 0 4.124zM7.119 20.452H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  )
}
import { useTranslation } from 'react-i18next'
import { useStoreSettings } from '../../hooks/useStoreSettings'
import { useLocalizedPath } from '../../lib/locale'

// Memoized: Footer reads no route state, so it must not re-render on every
// navigation — only when its props/settings/i18n actually change.
export const Footer = memo(function Footer() {
  const { t } = useTranslation()
  const settings = useStoreSettings()
  const lp = useLocalizedPath()
  return (
    <footer className="bg-navy-deep text-white border-t border-white/10 pt-16 pb-[calc(2rem+env(safe-area-inset-bottom))]">
      <div className="max-w-[1280px] mx-auto px-4 sm:px-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-[1.5fr_1fr_1fr_1.2fr] gap-10">
          {/* Brand */}
          <div>
            <Link to={lp('/')} className="flex items-center gap-3 no-underline mb-4 text-white">
              <img
                src="/images/alka-traders-logo-128.png"
                alt="Alka Traders Logo"
                width={48}
                height={48}
                className="h-12 w-12 shrink-0 rounded-lg object-cover"
              />
              <span className="flex flex-col leading-none">
                <span className="font-display text-xl lg:text-[28px] font-bold tracking-tight">Alka Traders</span>
                <span className="mt-1 text-xs font-bold uppercase tracking-[2px] text-white/70">Marine and industrial store</span>
              </span>
            </Link>
            <p className="text-body-sm text-white/78 leading-relaxed mb-5">
              {t('footer.desc')}
            </p>
            <div className="flex gap-3">
              <a href="https://www.linkedin.com/company/alka-traders" target="_blank" rel="noopener noreferrer" aria-label="LinkedIn" className="flex items-center justify-center w-11 h-11 min-h-[44px] min-w-[44px] rounded-lg bg-white/8 border border-white/12 text-white/80 hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)] transition-all">
                <LinkedInIcon size={16} />
              </a>
              <a href={`https://wa.me/${settings.whatsappNumber}`} aria-label="WhatsApp" className="flex items-center justify-center w-11 h-11 min-h-[44px] min-w-[44px] rounded-lg bg-white/8 border border-white/12 text-[#4ade80] hover:border-[var(--accent-primary)] transition-all">
                <WhatsAppIcon size={16} />
              </a>
              <a href={`mailto:${settings.rfqEmail}`} aria-label="Email" className="flex items-center justify-center w-11 h-11 min-h-[44px] min-w-[44px] rounded-lg bg-white/8 border border-white/12 text-white/80 hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)] transition-all">
                <Mail size={16} />
              </a>
            </div>
          </div>

          {/* Quick Links */}
          <div className="flex flex-col gap-2.5">
            <span className="font-body font-bold text-xs tracking-[3px] uppercase text-white/65 mb-2">{t('footer.quickLinks')}</span>
            <Link to={lp('/')} className="inline-flex items-center min-h-[44px] py-2 text-sm text-white/78 no-underline hover:text-[var(--accent-primary)] transition-colors">{t('footer.linkHome')}</Link>
            <Link to={lp('/products')} className="inline-flex items-center min-h-[44px] py-2 text-sm text-white/78 no-underline hover:text-[var(--accent-primary)] transition-colors">{t('footer.linkProducts')}</Link>
            <Link to={lp('/brands')} className="inline-flex items-center min-h-[44px] py-2 text-sm text-white/78 no-underline hover:text-[var(--accent-primary)] transition-colors">{t('footer.linkBrands')}</Link>
            <Link to={lp('/industries')} className="inline-flex items-center min-h-[44px] py-2 text-sm text-white/78 no-underline hover:text-[var(--accent-primary)] transition-colors">{t('footer.linkIndustries')}</Link>
            <Link to={lp('/rfq')} className="inline-flex items-center min-h-[44px] py-2 text-sm text-white/78 no-underline hover:text-[var(--accent-primary)] transition-colors">{t('footer.linkRfq')}</Link>
          </div>

          {/* Categories */}
          <div className="flex flex-col gap-2.5">
            <span className="font-body font-bold text-xs tracking-[3px] uppercase text-white/65 mb-2">{t('footer.productCategories')}</span>
            <Link to={lp('/products?category=marine')} className="inline-flex items-center min-h-[44px] py-2 text-sm text-white/78 no-underline hover:text-[var(--accent-primary)] transition-colors">{t('footer.catMarine')}</Link>
            <Link to={lp('/products?category=electrical')} className="inline-flex items-center min-h-[44px] py-2 text-sm text-white/78 no-underline hover:text-[var(--accent-primary)] transition-colors">{t('footer.catElectrical')}</Link>
            <Link to={lp('/products?category=hydraulic')} className="inline-flex items-center min-h-[44px] py-2 text-sm text-white/78 no-underline hover:text-[var(--accent-primary)] transition-colors">{t('footer.catHydraulic')}</Link>
            <Link to={lp('/products?category=pneumatic')} className="inline-flex items-center min-h-[44px] py-2 text-sm text-white/78 no-underline hover:text-[var(--accent-primary)] transition-colors">{t('footer.catPneumatic')}</Link>
            <Link to={lp('/products?category=spares')} className="inline-flex items-center min-h-[44px] py-2 text-sm text-white/78 no-underline hover:text-[var(--accent-primary)] transition-colors">{t('footer.catSpares')}</Link>
            <Link to={lp('/products?category=surplus')} className="inline-flex items-center min-h-[44px] py-2 text-sm text-white/78 no-underline hover:text-[var(--accent-primary)] transition-colors">{t('footer.catSurplus')}</Link>
          </div>

          {/* Contact */}
          <div className="flex flex-col gap-2.5">
            <span className="font-body font-bold text-xs tracking-[3px] uppercase text-white/65 mb-2">{t('footer.contactUs')}</span>
            <a href={`mailto:${settings.rfqEmail}`} className="inline-flex items-center min-h-[44px] py-2 text-sm text-white/78 no-underline hover:text-[var(--accent-primary)] transition-colors gap-2">
              <Mail size={14} /> {settings.rfqEmail}
            </a>
            <a href={`tel:${settings.phoneNumber}`} className="inline-flex items-center min-h-[44px] py-2 text-sm text-white/78 no-underline hover:text-[var(--accent-primary)] transition-colors gap-2">
              <Phone size={14} /> {settings.phoneNumber}
            </a>
            <p className="text-sm text-white/78 flex items-start gap-2">
              <MapPin size={14} className="mt-0.5 flex-shrink-0" />              PLOT - 7 ALANG HOUSE, MOTITALAV ROAD, KHUMBHARWADA, BHAVNAGAR-364001, GUJARAT, INDIA
            </p>
            <a href={`https://wa.me/${settings.whatsappNumber}`} className="inline-flex items-center gap-2 rounded-lg text-xs font-bold border border-white/12 bg-white/8 text-white px-[18px] py-[10px] mt-3 hover:border-[var(--accent-primary)] transition-all no-underline">
              <WhatsAppIcon size={14} className="text-success" /> {t('contact.whatsapp')}
            </a>
          </div>
        </div>

        <div className="mt-12 py-6 border-t border-white/10 flex flex-wrap justify-between items-center gap-3 text-xs text-white/65">
          <span>&copy; 2026 {t('footer.copyright')}</span>
          <div className="flex items-center gap-4">
            <Link to={lp('/privacy-policy')} className="hover:text-white/90 transition-colors no-underline text-white/65">Privacy Policy</Link>
            <Link to={lp('/terms-of-service')} className="hover:text-white/90 transition-colors no-underline text-white/65">Terms of Service</Link>
            <Link to={lp('/refund-policy')} className="hover:text-white/90 transition-colors no-underline text-white/65">Refund Policy</Link>
          </div>
          <span>{t('footer.tagline')}</span>
        </div>
      </div>
    </footer>
  )
})
