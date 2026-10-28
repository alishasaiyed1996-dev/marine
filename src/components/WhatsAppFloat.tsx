import { useTranslation } from 'react-i18next'
import { WhatsAppIcon } from '../components/ui/WhatsAppIcon'
import { useStoreSettings } from '../hooks/useStoreSettings'

export function WhatsAppFloat() {
  const { t } = useTranslation()
  const { whatsappNumber } = useStoreSettings()

  if (!whatsappNumber) return null

  return (
    // z-index scale: content < cart drawer (60) < sticky header (70) < modals (100/110) < toast & cookie consent (200)
    //
    // The float sits ABOVE the sticky mobile add-to-cart bar (z-50). It used
    // to sit below it, so on a product page the CTA covered the WhatsApp
    // button — the channel the business actually uses for emergency RFQs —
    // exactly on the highest-intent mobile page.
    //
    // The mobile offset (6.75rem) clears the sticky buy bar's height; the
    // env() term keeps it out of the home-indicator gesture zone in
    // landscape / installed-PWA mode. Anchored to the inline END so it
    // mirrors to the left edge under dir=rtl.
    <a
      href={`https://wa.me/${whatsappNumber}`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t('a11y.chatWhatsapp')}
      className="group fixed bottom-[calc(6.75rem+env(safe-area-inset-bottom,0px))] end-4 z-[55] flex items-center gap-0 rounded-full bg-[#25D366] text-white shadow-[0_4px_20px_rgba(37,211,102,0.35)] transition-all duration-300 hover:gap-3 hover:pe-5 hover:shadow-xl hover:shadow-[#25D366]/25 animate-[whatsappFloatIn_0.5s_ease-out_both] sm:bottom-[calc(1.5rem+env(safe-area-inset-bottom,0px))] sm:end-6"
    >
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] transition-transform duration-300 group-hover:scale-105">
        <WhatsAppIcon size={26} className="text-white" />
      </span>
      {/* Label reveals on hover; on touch devices (no hover) it stays open —
          an icon-only globe icon was invisible to mobile users. */}
      <span className="max-w-0 overflow-hidden whitespace-nowrap text-sm font-semibold transition-all duration-300 group-hover:max-w-[120px] [@media(hover:none)]:max-w-[120px] [@media(hover:none)]:pe-5">
        {t('a11y.chatWhatsapp')}
      </span>
    </a>
  )
}
