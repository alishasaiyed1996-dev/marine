import { ToggleLeft, ToggleRight } from 'lucide-react'
import type { SiteConfig } from './types'
import { inputClass, selectClass, labelClass, currencies, timezones } from './types'

interface SiteConfigTabProps {
  site: SiteConfig
  updateSite: <K extends keyof SiteConfig>(key: K, value: SiteConfig[K]) => void
}

export function SiteConfigTab({ site, updateSite }: SiteConfigTabProps) {
  return (
    <div className="space-y-6">
      {/* Company Info */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 space-y-4">
        <h3 className="text-sm font-bold text-[var(--text-primary)] uppercase tracking-wider">Company Information</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Company Name</label>
            <input value={site.companyName} onChange={(e) => updateSite('companyName', e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Tagline</label>
            <input value={site.tagline} onChange={(e) => updateSite('tagline', e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Email</label>
            <input type="email" value={site.email} onChange={(e) => updateSite('email', e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Phone</label>
            <input value={site.phone} onChange={(e) => updateSite('phone', e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>WhatsApp Number</label>
            <input
              value={site.whatsappNumber}
              onChange={(e) => updateSite('whatsappNumber', e.target.value)}
              className={inputClass}
              placeholder="918799095041"
            />
            <p className="text-[0.625rem] text-[var(--text-muted)] mt-1">Digits only, including the country code.</p>
          </div>
          <div className="md:col-span-2">
            <label className={labelClass}>Address</label>
            <input value={site.address} onChange={(e) => updateSite('address', e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>City</label>
            <input value={site.city} onChange={(e) => updateSite('city', e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Country</label>
            <input value={site.country} onChange={(e) => updateSite('country', e.target.value)} className={inputClass} />
          </div>
        </div>
      </div>

      {/* Regional Settings */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 space-y-4">
        <h3 className="text-sm font-bold text-[var(--text-primary)] uppercase tracking-wider">Regional Settings</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Currency</label>
            <select value={site.currency} onChange={(e) => updateSite('currency', e.target.value)} className={selectClass}>
              {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass}>Timezone</label>
            <select value={site.timezone} onChange={(e) => updateSite('timezone', e.target.value)} className={selectClass}>
              {timezones.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* SEO */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 space-y-4">
        <h3 className="text-sm font-bold text-[var(--text-primary)] uppercase tracking-wider">SEO & Analytics</h3>
        <div className="space-y-4">
          <div>
            <label className={labelClass}>SEO Title</label>
            <input value={site.seoTitle} onChange={(e) => updateSite('seoTitle', e.target.value)} className={inputClass} />
            <p className="text-[0.625rem] text-[var(--text-muted)] mt-1">{site.seoTitle.length}/60 characters</p>
          </div>
          <div>
            <label className={labelClass}>Meta Description</label>
            <textarea value={site.seoDescription} onChange={(e) => updateSite('seoDescription', e.target.value)} rows={3} className={`${inputClass} resize-y`} />
            <p className="text-[0.625rem] text-[var(--text-muted)] mt-1">{site.seoDescription.length}/160 characters</p>
          </div>
          <div>
            <label className={labelClass}>Google Analytics ID</label>
            <input value={site.googleAnalyticsId} onChange={(e) => updateSite('googleAnalyticsId', e.target.value)} placeholder="G-XXXXXXXXXX" className={inputClass} />
          </div>
        </div>
      </div>

      {/* Danger Zone */}
      <div className="rounded-2xl border border-[var(--danger)]/20 bg-[var(--danger)]/5 p-6 space-y-3">
        <h3 className="text-sm font-bold text-[var(--danger)]">Maintenance Mode</h3>
        <p className="text-xs text-[var(--text-secondary)]">When enabled, the storefront will display a maintenance page to all visitors except admins.</p>
        <button
          onClick={() => updateSite('maintenanceMode', !site.maintenanceMode)}
          className="inline-flex items-center gap-2"
        >
          {site.maintenanceMode ? <ToggleRight size={28} className="text-[var(--danger)]" /> : <ToggleLeft size={28} className="text-[var(--text-muted)]" />}
          <span className={`text-xs font-bold ${site.maintenanceMode ? 'text-[var(--danger)]' : 'text-[var(--text-muted)]'}`}>
            {site.maintenanceMode ? 'Enabled' : 'Disabled'}
          </span>
        </button>
      </div>
    </div>
  )
}
