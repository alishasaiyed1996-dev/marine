import { useState, useCallback, useRef, useEffect } from 'react'
import { useStore } from '../store/useStore'
import type { Product } from '../types'

/**
 * Shared add-to-cart logic with "added" feedback state.
 * Eliminates ~80 lines of duplicated code across Home, Shop, Products, ProductDetail.
 */
export function useAddToCart() {
  const { addToCart } = useStore()
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set())
  const timerRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  useEffect(() => {
    const timers = timerRef.current
    return () => {
      timers.forEach((t) => clearTimeout(t))
      timers.clear()
    }
  }, [])

  const handleAddToCart = useCallback(
    (product: Product, quantity = 1) => {
      if (!product.inStock) return
      const before = useStore.getState().cart.find((i) => i.product.id === product.id)?.quantity ?? 0
      for (let i = 0; i < quantity; i++) {
        addToCart(product)
      }
      const after = useStore.getState().cart.find((i) => i.product.id === product.id)?.quantity ?? 0
      // addToCart silently refuses once stock is exhausted; don't confirm an
      // add that never happened.
      if (after <= before) return
      setAddedIds((prev) => new Set(prev).add(product.id))
      if (timerRef.current.has(product.id)) {
        clearTimeout(timerRef.current.get(product.id))
      }
      timerRef.current.set(
        product.id,
        setTimeout(() => {
          setAddedIds((prev) => {
            const next = new Set(prev)
            next.delete(product.id)
            return next
          })
          timerRef.current.delete(product.id)
        }, 1500),
      )
    },
    [addToCart],
  )

  return { handleAddToCart, addedIds }
}
