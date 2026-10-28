import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'

interface MarqueeProps {
  items: string[]
  direction?: 'left' | 'right'
  speed?: string
}

export function Marquee({ items, direction = 'left', speed = '30s' }: MarqueeProps) {
  const [paused, setPaused] = useState(false)
  const { t } = useTranslation()
  const animationClass = direction === 'left' ? 'animate-marquee-left' : 'animate-marquee-right'

  const togglePause = useCallback(() => setPaused(v => !v), [])

  return (
    <div
      className="overflow-hidden relative w-full max-w-[100vw]"
      aria-live="off"
      aria-label={t('a11y.marqueeLabel', { count: items.length })}
    >
      <button
        onClick={togglePause}
        className="tap-native tap-pad absolute end-2 top-1/2 -translate-y-1/2 z-10 text-xs font-bold text-[var(--text-muted)] hover:text-[var(--text-primary)] bg-[var(--surface)] border border-[var(--border)] rounded-full px-2 py-1 transition-colors"
        aria-label={paused ? t('a11y.marqueePlay') : t('a11y.marqueePause')}
      >
        {paused ? '▶' : '⏸'}
      </button>
      <div
        className={`flex w-max ${animationClass} ${paused ? 'animate-none' : ''}`}
        style={{ animationDuration: paused ? undefined : speed }}
      >
        {[...items, ...items].map((item, i) => (
          <span
            key={`${item}-${i}`}
            className="inline-flex items-center px-5 py-[10px] mx-1.5 rounded-full bg-[var(--surface)] border border-[var(--border)] font-semibold text-sm text-[var(--text-secondary)] tracking-[1px] whitespace-nowrap flex-shrink-0 hover:border-[var(--muted-teal)] hover:text-[var(--text-primary)] transition-all duration-300"
          >
            {item}
          </span>
        ))}
      </div>
    </div>
  )
}
