import { Wrench, Mail, MessageCircle, Phone } from 'lucide-react'
import { useStoreSettings } from '../hooks/useStoreSettings'
import { SEO } from '../components/seo/SEO'

/**
 * Shown on the storefront when `site.maintenanceMode` is enabled and the
 * visitor is not a signed-in admin. Reads the same settings the admin saves so
 * the contact details stay in sync.
 *
 * L-5 (argon_seo audit follow-up): maintenance mode is enforced client-side
 * only — prerendered storefront HTML keeps serving and stays indexable in
 * every hosting mode. When the SPA does render this page, it must at least
 * emit `noindex, follow` so a maintenance URL never becomes an indexable
 * "We'll be right back" page.
 */
export default function Maintenance() {
  const settings = useStoreSettings()

  return (
    <>
      <SEO
        noindex
        title="We'll be right back — Alka Traders"
        description="Alka Traders is undergoing scheduled maintenance. Our catalogue and ordering will be back online shortly."
      />
      <div className="flex min-h-screen flex-col items-center justify-center bg-[var(--primary-bg)] px-6 py-16 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--accent-gold)]/10 text-[var(--accent-gold)]">
          <Wrench size={28} />
        </div>
        <h1 className="mt-6 font-display text-2xl font-extrabold text-[var(--text-primary)]">
          We&apos;ll be right back
        </h1>
        <p className="mt-2 max-w-md text-sm text-[var(--text-muted)]">
          Alka Traders is undergoing scheduled maintenance. Our catalogue and
          ordering will be back online shortly.
        </p>

        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          {settings.rfqEmail && (
            <a
              href={`mailto:${settings.rfqEmail}`}
              className="inline-flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-xs font-bold text-[var(--text-secondary)] no-underline transition-colors hover:border-[var(--accent-gold)]"
            >
              <Mail size={14} /> {settings.rfqEmail}
            </a>
          )}
          {settings.phoneNumber && (
            <a
              href={`tel:${settings.phoneNumber}`}
              className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-xs font-bold text-[var(--text-secondary)] no-underline transition-colors hover:border-[var(--accent-gold)]"
            >
              <Phone size={14} /> {settings.phoneNumber}
            </a>
          )}
          {settings.whatsappNumber && (
            <a
              href={`https://wa.me/${settings.whatsappNumber}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-xs font-bold text-[var(--text-secondary)] no-underline transition-colors hover:border-[var(--accent-gold)]"
            >
              <MessageCircle size={14} /> WhatsApp
            </a>
          )}
        </div>

        <a
          href="/admin/login"
          className="mt-10 text-[0.625rem] font-bold uppercase tracking-wider text-[var(--text-muted)] no-underline transition-colors hover:text-[var(--accent-gold)]"
        >
          Admin login
        </a>
      </div>
    </>
  )
}
