/**
 * Routes where the shopper is completing a payment: the cart checkout and the
 * per-offer pay page. Both carry the final action button in the lower part of
 * the screen, so anything floating there (the PayPal SDK, the WhatsApp button)
 * competes with the step that actually takes money.
 *
 * Anchored at the END because every storefront path is locale-prefixed
 * (/en/checkout, /ar/account/offers/12/pay, …). Shared so the two consumers
 * cannot drift apart when a payment route is added.
 */
export const PAYMENT_ROUTE = /\/(?:checkout|account\/offers\/[^/]+\/pay)\/?$/
