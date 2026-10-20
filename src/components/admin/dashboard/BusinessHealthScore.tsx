import { useMemo } from 'react'
import { ShieldCheck, AlertTriangle, TrendingUp, TrendingDown } from 'lucide-react'

interface Props {
  stats: any
}

export function BusinessHealthScore({ stats }: Props) {
  const { score, breakdown, config } = useMemo(() => {
    const total = stats?.totalProducts || 0
    if (total === 0) {
      return {
        score: 0,
        breakdown: { stockHealth: 0, riskReduction: 0, availability: 0, dataQuality: 0 },
        config: { label: 'No Data', color: 'text-[var(--text-muted)]', bg: 'bg-[var(--text-muted)]/10', icon: ShieldCheck },
      }
    }

    const inStock = stats?.inStockProducts || 0
    const outOfStock = stats?.outOfStockProducts || 0
    // The API returns only a 20-item sample plus the true count; using the
    // sample length understated the penalty when more than 20 products were
    // low on stock or missing images.
    const lowStockCount = stats?.lowStockCount ?? stats?.lowStockProducts?.length ?? 0
    const missingImages = stats?.missingImageCount ?? stats?.missingImageProducts?.length ?? 0

    const stockHealth = (inStock / total) * 30
    const riskReduction = (1 - lowStockCount / total) * 25
    const availability = (1 - outOfStock / total) * 25
    const dataQuality = ((total - missingImages) / total) * 20
    const totalScore = Math.round(stockHealth + riskReduction + availability + dataQuality)

    const c = totalScore >= 81
      ? { label: 'Excellent', color: 'text-[var(--success)]', bg: 'bg-[var(--success)]/10', icon: ShieldCheck }
      : totalScore >= 61
      ? { label: 'Good', color: 'text-[var(--accent-blue)]', bg: 'bg-[var(--accent-blue)]/10', icon: TrendingUp }
      : totalScore >= 41
      ? { label: 'Needs Attention', color: 'text-[var(--accent-gold)]', bg: 'bg-[var(--accent-gold)]/10', icon: AlertTriangle }
      : { label: 'Critical', color: 'text-[var(--danger)]', bg: 'bg-[var(--danger)]/10', icon: TrendingDown }

    return {
      score: totalScore,
      breakdown: { stockHealth, riskReduction, availability, dataQuality },
      config: c,
    }
  }, [stats])

  const Icon = config.icon

  return (
    <div className="admin-stat-card">
      <div className="flex items-center gap-3">
        <div className={`flex h-14 w-14 items-center justify-center rounded-xl ${config.bg} ${config.color}`}>
          <Icon size={28} />
        </div>
        <div className="flex-1">
          <p className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
            Business Health
          </p>
          <div className="flex items-baseline gap-2">
            <p className="font-display text-4xl font-extrabold text-[var(--text-primary)]">
              {score}
            </p>
            <span className={`text-sm font-bold ${config.color}`}>{config.label}</span>
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mt-4 h-2.5 w-full rounded-full bg-[var(--surface-soft)] overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ease-out ${
            score >= 81 ? 'bg-[var(--success)]' :
            score >= 61 ? 'bg-[var(--accent-blue)]' :
            score >= 41 ? 'bg-[var(--accent-gold)]' :
            'bg-[var(--danger)]'
          }`}
          style={{ width: `${score}%` }}
        />
      </div>

      {/* Breakdown labels */}
      <div className="mt-3 grid grid-cols-4 gap-2">
        {[
          { label: 'Stock', value: Math.round(breakdown.stockHealth), max: 30 },
          { label: 'Risk', value: Math.round(breakdown.riskReduction), max: 25 },
          { label: 'Avail.', value: Math.round(breakdown.availability), max: 25 },
          { label: 'Data', value: Math.round(breakdown.dataQuality), max: 20 },
        ].map(item => (
          <div key={item.label} className="text-center">
            <div className="h-1 w-full rounded-full bg-[var(--surface-soft)] overflow-hidden mb-1">
              <div
                className="h-full rounded-full bg-[var(--accent-gold)]"
                style={{ width: `${(item.value / item.max) * 100}%` }}
              />
            </div>
            <p className="text-[0.5rem] font-bold text-[var(--text-muted)] uppercase">
              {item.label} {item.value}/{item.max}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}
