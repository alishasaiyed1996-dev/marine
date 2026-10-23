import { WhatsAppIcon } from '../components/ui/WhatsAppIcon'
import { useStoreSettings } from '../hooks/useStoreSettings'

export function WhatsAppFloat() {
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
    // It is also lifted above the bottom bar on small screens so the two
    // never overlap.
    <a
      href={`https://wa.me/${whatsappNumber}`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Chat with us on WhatsApp"
      className="group fixed bottom-24 right-4 z-[55] flex items-center gap-0 rounded-full bg-[#25D366] text-white shadow-[0_4px_20px_rgba(37,211,102,0.35)] transition-all duration-300 hover:gap-3 hover:pr-5 hover:shadow-xl hover:shadow-[#25D366]/25 animate-[whatsappFloatIn_0.5s_ease-out_both] sm:bottom-6 sm:right-6"
    >
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] transition-transform duration-300 group-hover:scale-105">
        <WhatsAppIcon size={26} className="text-white" />
      </span>
      <span className="max-w-0 overflow-hidden whitespace-nowrap text-sm font-semibold transition-all duration-300 group-hover:max-w-[120px]">
        Chat with us
      </span>
    </a>
  )
}
