import { useScrollReveal } from '../../hooks/useScrollReveal'
import { useCountUp } from '../../hooks/useCountUp'

interface StatCounterProps {
  end: number
  label: string
  suffix?: string
  delay?: number
}

export function StatCounter({ end, label, suffix = '+', delay = 0 }: StatCounterProps) {
  const { ref, isVisible } = useScrollReveal<HTMLDivElement>({ threshold: 0.3 })
  const { count } = useCountUp({ end, suffix, enabled: isVisible })

  return (
    <div
      ref={ref}
      className="flex-1 text-center px-4 min-w-0 sm:px-8 sm:min-w-[140px]"
      style={{ transitionDelay: `${delay}ms` }}
    >
      <div className="font-display font-bold text-[clamp(36px,4.5vw,62px)] text-[var(--accent-primary)] leading-none tracking-normal tabular-nums">
        {count}
      </div>
      <div className="text-body text-[var(--text-secondary)] mt-2.5">
        {label}
      </div>
    </div>
  )
}
