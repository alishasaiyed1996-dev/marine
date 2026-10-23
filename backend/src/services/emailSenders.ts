import { emailTemplates } from './emailTemplates.js'
import { queueEmail } from './email.js'

export async function sendOrderConfirmation(params: {
  to: string; customerName: string; orderNumber: string
  items: { name: string; quantity: number; price: number }[]
  subtotal: number; shippingCost: number; tax: number; total: number; shippingAddress: string
  currency?: string
  paymentMethod?: string
  paymentInstructions?: {
    heading: string
    details: { label: string; value: string }[]
    note?: string
  }
  paymentPending?: boolean
}) {
  const tpl = emailTemplates.orderConfirmation(params)
  await queueEmail({ ...tpl, to: params.to })
}

/**
 * Sent when the money actually arrives (PayPal capture, card capture, or an
 * admin marking a bank transfer paid). Distinct from the order-received email
 * so the customer gets one receipt and one payment confirmation, never two
 * identical "order confirmed" messages.
 */
export async function sendOrderPaymentReceived(params: {
  to: string; customerName: string; orderNumber: string; total: number
  currency?: string; paymentMethod?: string
}) {
  const tpl = emailTemplates.orderPaymentReceived(params)
  await queueEmail({ ...tpl, to: params.to })
}

export async function sendOrderShipped(params: {
  to: string; customerName: string; orderNumber: string; trackingNumber: string; courier: string
}) {
  const tpl = emailTemplates.orderShipped(params)
  await queueEmail({ ...tpl, to: params.to })
}

export async function sendOrderCancelled(params: {
  to: string; customerName: string; orderNumber: string; reason: string
}) {
  const tpl = emailTemplates.orderCancelled(params)
  await queueEmail({ ...tpl, to: params.to })
}

export async function sendRfqReceived(params: {
  rfqNumber: string; customerName: string; customerEmail?: string; productDescription: string; urgency: string
}) {
  const tpl = emailTemplates.rfqReceived(params)
  await queueEmail({ ...tpl, replyTo: params.customerEmail })
}

export async function sendRfqResponse(params: {
  to: string; customerName: string; rfqNumber: string; message: string
}) {
  const tpl = emailTemplates.rfqResponse(params)
  await queueEmail({ ...tpl, to: params.to })
}

export async function sendEmergencyAlert(params: {
  rfqNumber: string; customerName: string; phone: string; partDescription: string; vesselName?: string
}) {
  const tpl = emailTemplates.emergencyAlert(params)
  await queueEmail(tpl)
}

export async function sendOfferReceived(params: {
  offerNumber: string; productName: string; offeredPrice: number; customerEmail: string; currency?: string
}) {
  const tpl = emailTemplates.offerReceived(params)
  await queueEmail({ ...tpl, replyTo: params.customerEmail })
}

export async function sendOfferDecision(params: {
  to: string; offerNumber: string; productName: string; decision: 'accepted' | 'rejected' | 'countered'; counterPrice?: number; currency?: string
}) {
  const tpl = emailTemplates.offerDecision(params)
  await queueEmail({ ...tpl, to: params.to })
}

export async function sendContactNotification(params: {
  name: string; email: string; subject: string; message: string
}) {
  const tpl = emailTemplates.contactNotification(params)
  await queueEmail({ ...tpl, replyTo: params.email })
}

export async function sendPasswordReset(params: {
  to: string; name: string; resetUrl: string; isAdmin?: boolean
}) {
  const tpl = emailTemplates.passwordReset(params)
  await queueEmail({ ...tpl, to: params.to })
}

export async function sendWelcome(params: {
  to: string; name: string; email: string
}) {
  const tpl = emailTemplates.welcome(params)
  await queueEmail({ ...tpl, to: params.to })
}

// ─── Admin Notifications ───────────────────────────────────────
// Recipient is resolved by the caller (adminNotifications.ts) from settings;
// the template itself leaves `to` empty.

export async function sendAdminOrderEvent(params: {
  to: string; event: string; orderNumber: string; status: string
  customerName?: string; customerEmail?: string; total?: number; currency?: string; note?: string
}) {
  const tpl = emailTemplates.adminOrderEvent(params)
  await queueEmail({ ...tpl, to: params.to })
}

export async function sendAdminLowStock(params: {
  to: string; products: { name: string; sku: string; stockCount: number; lowStockThreshold: number }[]
}) {
  const tpl = emailTemplates.adminLowStock(params)
  return queueEmail({ ...tpl, to: params.to })
}

export async function sendAdminNewCustomer(params: {
  to: string; name: string; email: string; company?: string; country?: string
}) {
  const tpl = emailTemplates.adminNewCustomer(params)
  await queueEmail({ ...tpl, to: params.to })
}

export async function sendAdminReport(params: {
  to: string; period: 'weekly' | 'monthly'; rangeLabel: string
  orders: number; revenue: number; newCustomers: number
  topProducts: { name: string; quantity: number; revenue: number }[]
}) {
  const tpl = emailTemplates.adminReport(params)
  return queueEmail({ ...tpl, to: params.to })
}
