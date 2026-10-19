import { useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Trash2, ShoppingBag, Plus, Minus } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { useLocalizedPath } from '../../lib/locale'
import { OptimizedImage } from '../ui/OptimizedImage'



const backdropVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
  exit: { opacity: 0 },
} as const

const drawerVariants = {
  hidden: { x: '100%' },
  visible: {
    x: 0,
    transition: { type: 'spring' as const, damping: 30, stiffness: 300 },
  },
  exit: {
    x: '100%',
    transition: { type: 'spring' as const, damping: 30, stiffness: 300 },
  },
} as const

import { getProductImageUrl } from '../../lib/utils'

export function CartDrawer() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const lp = useLocalizedPath()
  const cart = useStore((s) => s.cart)
  const showCartDrawer = useStore((s) => s.showCartDrawer)
  const setShowCartDrawer = useStore((s) => s.setShowCartDrawer)
  const removeFromCart = useStore((s) => s.removeFromCart)
  const updateQuantity = useStore((s) => s.updateQuantity)
  const clearCart = useStore((s) => s.clearCart)
  const getCartTotal = useStore((s) => s.getCartTotal)
  const getCartCount = useStore((s) => s.getCartCount)

  const closeDrawer = useCallback(() => {
    setShowCartDrawer(false)
  }, [setShowCartDrawer])

  // Escape key closes drawer
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showCartDrawer) closeDrawer()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [showCartDrawer, closeDrawer])

  // Lock page scroll when open — with ref counting to support multiple modals.
  // Lock <html> not <body>: overflow:hidden on body makes body a clip
  // container that breaks position:sticky on the site header.
  useEffect(() => {
    if (showCartDrawer) {
      document.documentElement.style.overflow = 'hidden'
    }
    return () => {
      // Only clear overflow if no other modal is open. The cart drawer itself
      // is excluded: AnimatePresence keeps it mounted through its exit
      // animation, so a plain [role="dialog"] query would always find it and
      // leave the page unscrollable after close.
      const otherModalOpen = Array.from(
        document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"]')
      ).some((el) => el.dataset.modal !== 'cart')
      if (!otherModalOpen) {
        document.documentElement.style.overflow = ''
      }
    }
  }, [showCartDrawer])

  const handleCheckout = () => {
    closeDrawer()
    navigate(lp('/checkout'))
  }

  const subtotal = getCartTotal()
  const itemCount = getCartCount()

  return (
    <AnimatePresence mode="wait">
      {showCartDrawer && (
        <>
          {/* Backdrop */}
          <motion.div
            key="cart-backdrop"
            className="fixed inset-0 z-[59] bg-black/40 backdrop-blur-[2px]"
            variants={backdropVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            transition={{ duration: 0.25 }}
            onClick={closeDrawer}
            aria-hidden="true"
          />

          {/* Drawer */}
          <motion.aside
            key="cart-drawer"
            className="fixed top-0 right-0 z-[60] flex h-full w-full max-w-[420px] flex-col border-l border-[var(--border)] bg-[var(--surface)] shadow-2xl"
            variants={drawerVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            role="dialog"
            aria-label="Shopping cart"
            data-modal="cart"
          >
            {/* ─── Header ─── */}
            <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-semibold text-[var(--text-primary)]">
                  {t('cart.yourCart')}
                </h2>
                {itemCount > 0 && (
                  <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="flex h-6 min-w-6 items-center justify-center rounded-full bg-[var(--brick-ember)] px-1.5 text-xs font-bold text-[var(--honeydew)]"
                  >
                    {itemCount}
                  </motion.span>
                )}
              </div>
              <button
                onClick={closeDrawer}
                className="group flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-[var(--border)]"
                aria-label="Close cart"
              >
                <X
                  size={20}
                  className="text-[var(--text-secondary)] transition-colors group-hover:text-[var(--text-primary)]"
                />
              </button>
            </div>

            {/* ─── Content ─── */}
            {cart.length === 0 ? (
              /* Empty State */
              <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6">
                <motion.div
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: 0.1, type: 'spring', stiffness: 200 }}
                  className="flex h-24 w-24 items-center justify-center rounded-full bg-[var(--border)]/30"
                >
                  <ShoppingBag
                    size={64}
                    strokeWidth={1}
                    className="text-[var(--text-muted)]"
                  />
                </motion.div>
                <div className="text-center">
                  <p className="text-lg font-medium text-[var(--text-primary)]">
                    {t('cart.empty')}
                  </p>
                  <p className="mt-1 text-sm text-[var(--text-muted)]">
                    {t('cart.emptySub')}
                  </p>
                </div>
                <button
                  onClick={() => {
                    closeDrawer()
                    navigate(lp('/products'))
                  }}
                  className="rounded-full bg-[var(--brick-ember)] px-6 py-2.5 text-sm font-semibold text-[var(--honeydew)] transition-transform hover:scale-[1.03] active:scale-[0.97]"
                >
                  {t('cart.startShopping')}
                </button>
              </div>
            ) : (
              <>
                {/* Scrollable Item List */}
                <ul className="flex-1 divide-y divide-[var(--border)] overflow-y-auto px-5 py-2 scrollbar-thin">
                  <AnimatePresence initial={false}>
                    {cart.map(({ product, quantity }) => {
                      const price = product.onSale && product.salePrice ? product.salePrice : product.price
                      const lineTotal = price * quantity

                      return (
                        <motion.li
                          key={product.id}
                          layout
                          initial={{ opacity: 0, x: 40 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{
                            opacity: 0,
                            x: 40,
                            transition: { duration: 0.2 },
                          }}
                          className="flex gap-4 py-4"
                        >
                          {/* Thumbnail */}
                          <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--secondary-bg)]">
                            <OptimizedImage
                              src={getProductImageUrl(product.filename, 0)}
                              alt={product.name}
                              width={64}
                              height={64}
                              transformWidth={160}
                              sizes="64px"
                              className="h-full w-full object-contain p-1"
                            />
                          </div>

                          {/* Info */}
                          <div className="flex flex-1 flex-col gap-1.5">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium leading-tight text-[var(--text-primary)]">
                                  {product.name}
                                </p>
                                <p className="mt-0.5 truncate text-xs text-[var(--text-muted)]">
                                  {product.brand} · {product.sku}
                                </p>
                              </div>
                              <button
                                onClick={() => removeFromCart(product.id)}
                                className="group flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md transition-colors hover:bg-[var(--danger)]/10"
                                aria-label={`Remove ${product.name}`}
                              >
                                <Trash2
                                  size={14}
                                  className="text-[var(--text-muted)] transition-colors group-hover:text-danger"
                                />
                              </button>
                            </div>

                            <div className="flex items-center justify-between">
                              {/* Quantity Controls */}
                              <div className="flex items-center gap-0.5 rounded-full border border-[var(--border)] bg-[var(--primary-bg)] p-0.5">
                                <button
                                  onClick={() =>
                                    updateQuantity(product.id, quantity - 1)
                                  }
                                  className="flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-full transition-colors hover:bg-[var(--border)]"
                                  aria-label="Decrease quantity"
                                >
                                  <Minus size={14} className="text-[var(--text-secondary)]" />
                                </button>
                                <span className="min-w-[28px] text-center text-xs font-semibold text-[var(--text-primary)]">
                                  {quantity}
                                </span>
                                <button
                                  onClick={() =>
                                    updateQuantity(product.id, quantity + 1)
                                  }
                                  className="flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-full transition-colors hover:bg-[var(--border)]"
                                  aria-label="Increase quantity"
                                >
                                  <Plus size={14} className="text-[var(--text-secondary)]" />
                                </button>
                              </div>

                              {/* Line Total */}
                              <div className="text-right">
                                <p className="text-sm font-semibold text-[var(--text-primary)]">
                                  ${lineTotal.toFixed(2)}
                                </p>
                                {quantity > 1 && (
                                  <p className="text-xs text-[var(--text-muted)]">
                                    ${price.toFixed(2)} {t('cart.each')}
                                  </p>
                                )}
                              </div>
                            </div>
                          </div>
                        </motion.li>
                      )
                    })}
                  </AnimatePresence>
                </ul>

                {/* ─── Footer ─── */}
                <div className="border-t border-[var(--border)] bg-[var(--surface)] px-6 pt-4 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]">
                  {/* Subtotal */}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-[var(--text-secondary)]">
                      {t('cart.subtotal')}
                    </span>
                    <span className="text-lg font-bold text-[var(--text-primary)]">
                      ${subtotal.toFixed(2)}
                    </span>
                  </div>

                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    {t('cart.shippingCalc')}
                  </p>

                  {/* Actions */}
                  <motion.button
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleCheckout}
                    className="mt-4 w-full rounded-full bg-[var(--brick-ember)] py-3.5 text-sm font-semibold text-[var(--honeydew)] shadow-lg shadow-[var(--brick-ember)]/20 transition-shadow hover:shadow-xl hover:shadow-[var(--brick-ember)]/30"
                  >
                    {t('cart.checkout')}
                  </motion.button>

                  <button
                    onClick={clearCart}
                    className="mt-3 w-full text-center text-xs font-medium text-[var(--text-muted)] transition-colors hover:text-danger"
                  >
                    {t('cart.clearCart')}
                  </button>
                </div>
              </>
            )}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}
