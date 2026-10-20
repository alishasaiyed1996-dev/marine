import { useTranslation } from 'react-i18next'
import { Clock } from 'lucide-react'
import { useCountdownTo } from '../../hooks/useSaleCountdown'

/**
 * Live "expected response in HH:MM:SS" banner for the RFQ success screens.
 * Driven by the app-wide shared ticker — no per-component interval.
 * Renders nothing when there is no deadline or the deadline has passed.
 */
export function ResponseCountdown({ deadline }: { deadline: string | null }) {
  const { t } = useTranslation()
  const countdown = useCountdownTo(deadline)

  if (!countdown || countdown.expired) return null

  // Include whole days in the hour field: the 24-hour urgent SLA would
  // otherwise render as "00:00:00" the moment it starts (hours = diff % 1 day).
  const hh = String(countdown.days * 24 + countdown.hours).padStart(2, '0')
  const mm = String(countdown.minutes).padStart(2, '0')
  const ss = String(countdown.seconds).padStart(2, '0')

  return (
    <div className="inline-flex items-center gap-2 rounded-xl border border-[var(--accent-primary)]/40 bg-[var(--accent-primary)]/10 px-4 py-2.5 font-mono text-sm">
      <Clock size={14} className="animate-pulse text-[var(--accent-primary)]" />
      <span className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
        {t('rfq.expectedResponseIn')}
      </span>
      <span className="tabular-nums font-bold text-[var(--accent-primary)]">
        {hh}:{mm}:{ss}
      </span>
    </div>
  )
}
