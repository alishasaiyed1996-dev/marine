/** Formats an amount in the currency stored on the order/offer. */
export function formatMoney(amount: number, currency = 'USD'): string {
  const code = String(currency || 'USD').trim().toUpperCase() || 'USD'
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(Number(amount) || 0)
  } catch {
    return `${code} ${(Number(amount) || 0).toFixed(2)}`
  }
}
