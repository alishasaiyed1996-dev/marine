import { useEffect, type RefObject } from 'react'

/**
 * Shared behavior for every overlay surface (cart drawer, auth modal, command
 * palette, filter sheet, offer modal, cookie consent): ref-counted page scroll
 * lock, Escape-to-close, focus trap, initial focus move, and focus restore.
 *
 * Why this exists: each overlay used to hand-roll these details (or forget
 * them), so iOS scroll-lock behavior, Escape handling and focus restoration
 * differed per component — and some overlays (offer modal, command palette)
 * shipped with none at all, leaving keyboard and screen-reader users stranded
 * behind a full-screen surface on phones.
 *
 * Scroll lock targets <html>, NOT <body>: overflow:hidden on body turns body
 * into a clip container that breaks position:sticky on the site header.
 * Ref-counting via [data-modal] lets overlays coexist (consent over the cart
 * drawer) without unlocking the page while another overlay is still mounted.
 * Caveat: overlays that stay mounted through an exit animation (framer-motion
 * AnimatePresence) are excluded by their own lockKey, not by visibility.
 */
export function useOverlayBehavior({
  open,
  onClose,
  panelRef,
  initialFocusRef,
  lockKey,
}: {
  open: boolean
  onClose: () => void
  /** The overlay panel (dialog) element. Gets tabIndex=-1 for focusability. */
  panelRef: RefObject<HTMLElement | null>
  /** Element to focus on open; falls back to the panel itself. */
  initialFocusRef?: RefObject<HTMLElement | null>
  /** Unique key shared between the scroll lock and the panel's data-modal. */
  lockKey: string
}) {
  // ── Ref-counted scroll lock ──────────────────────────────────────────
  useEffect(() => {
    if (!open) return
    const html = document.documentElement
    html.style.overflow = 'hidden'
    return () => {
      // Only clear the lock if no OTHER overlay is still open. AnimatePresence
      // keeps closing overlays mounted through their exit animation, so a
      // plain [role="dialog"] query would always find ourselves and never
      // unlock — hence the lockKey exclusion.
      const otherOpen = Array.from(
        document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"]'),
      ).some((el) => el.dataset.modal && el.dataset.modal !== lockKey)
      if (!otherOpen) html.style.overflow = ''
    }
  }, [open, lockKey])

  // ── Focus management + keyboard ──────────────────────────────────────
  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    ;(initialFocusRef?.current ?? panelRef.current)?.focus?.()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const focusables = panelRef.current?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      if (!focusables || focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const inside = panelRef.current?.contains(document.activeElement)
      if (event.shiftKey && (document.activeElement === first || !inside)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !inside)) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previouslyFocused?.focus?.()
    }
  }, [open, onClose, panelRef, initialFocusRef])
}
