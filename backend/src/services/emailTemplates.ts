import { escapeHtml } from '../utils/html-escape.js'
import { getFrontendUrl } from '../utils/env.js'

const WHATSAPP = process.env.WHATSAPP_NUMBER || '918799095041'
const COMPANY = process.env.COMPANY_EMAIL || 'sales@alkatraders.co'
const FRONTEND_URL = getFrontendUrl()
// Single inbox for ALL inbound form submissions — contact form, RFQ,
// emergency request, and make-offer. Hard-defaults to sales@alkatraders.co
// so user submissions always land in the sales inbox regardless of other
// env vars (previously RFQ_EMAIL / EMERGENCY_EMAIL / ADMIN_EMAIL could
// redirect them to separate addresses). Override only via SALES_EMAIL.
const SALES_EMAIL = process.env.SALES_EMAIL || 'sales@alkatraders.co'

// ─── Template Helpers ──────────────────────────────────────────

function baseLayout(body: string): string {
  const whatsapp = WHATSAPP
  const company = COMPANY
  const frontendUrl = FRONTEND_URL
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <tr><td style="background:linear-gradient(135deg,#0a1628 0%,#1a2d4a 100%);padding:24px 32px;text-align:center;">
          <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:700;">⚓ Alka Traders</h1>
          <p style="margin:4px 0 0;color:#94a3b8;font-size:12px;letter-spacing:1px;text-transform:uppercase;">Marine & Industrial Equipment</p>
        </td></tr>
        <tr><td style="padding:32px;">${body}</td></tr>
        <tr><td style="background:#f8fafc;padding:24px 32px;text-align:center;border-top:1px solid #e2e8f0;">
          <p style="margin:0;color:#64748b;font-size:12px;">Alka Traders — Marine & Industrial Equipment</p>
          <p style="margin:4px 0 0;color:#94a3b8;font-size:11px;">
            <a href="https://wa.me/${whatsapp}" style="color:#25d366;">WhatsApp</a> ·
            <a href="mailto:${company}" style="color:#0ea5e9;">Email</a> ·
            <a href="${frontendUrl}" style="color:#0ea5e9;">Website</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

function btn(href: string, text: string, color = '#0ea5e9'): string {
  return `<a href="${href}" style="display:inline-block;background:${color};color:#ffffff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;margin:16px 0;">${text}</a>`
}

function infoRow(label: string, value: string): string {
  return `<tr><td style="padding:6px 0;color:#64748b;font-size:13px;width:140px;vertical-align:top;">${label}</td><td style="padding:6px 0;color:#1e293b;font-size:13px;font-weight:500;">${value}</td></tr>`
}

interface QueueEmail {
  to: string
  toName?: string
  subject: string
  html: string
  text?: string
  template?: string
  templateData?: Record<string, unknown>
}

// ─── Email Templates ───────────────────────────────────────────

export const emailTemplates = {
  orderConfirmation(data: {
    orderNumber: string
    customerName: string
    items: { name: string; quantity: number; price: number }[]
    subtotal: number
    shippingCost: number
    tax: number
    total: number
    shippingAddress: string
  }): QueueEmail {
    const itemRows = data.items.map(i =>
      `<tr><td style="padding:8px 0;border-bottom:1px solid #f1f5f9;color:#1e293b;">${escapeHtml(i.name)}</td><td style="padding:8px 0;border-bottom:1px solid #f1f5f9;text-align:center;color:#64748b;">${i.quantity}</td><td style="padding:8px 0;border-bottom:1px solid #f1f5f9;text-align:right;color:#1e293b;">$${i.price.toFixed(2)}</td></tr>`
    ).join('')

    const html = baseLayout(`
      <h2 style="margin:0 0 8px;color:#1e293b;font-size:22px;">Order Confirmed ✅</h2>
      <p style="color:#64748b;font-size:14px;margin:0 0 24px;">Thank you for your order, ${escapeHtml(data.customerName)}!</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:8px;padding:16px;margin-bottom:24px;">
        <tr><td>${infoRow('Order Number', `<span style="color:#0ea5e9;font-weight:700;">${data.orderNumber}</span>`)}</td></tr>
      </table>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
        <tr style="background:#f8fafc;"><th style="padding:10px 8px;text-align:left;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Product</th><th style="padding:10px 8px;text-align:center;font-size:12px;color:#64748b;">Qty</th><th style="padding:10px 8px;text-align:right;font-size:12px;color:#64748b;">Price</th></tr>
        ${itemRows}
      </table>
      ${infoRow('Subtotal', `$${data.subtotal.toFixed(2)}`)}
      ${infoRow('Shipping', `$${data.shippingCost.toFixed(2)}`)}
      ${infoRow('Tax', `$${data.tax.toFixed(2)}`)}
      <p style="font-size:18px;font-weight:bold;border-top:2px solid #e2e8f0;padding-top:8px;">Total: <span style="color:#0ea5e9;">$${data.total.toFixed(2)}</span></p>
      ${infoRow('Shipping Address', escapeHtml(data.shippingAddress))}
      <p style="color:#64748b;font-size:13px;text-align:center;">We'll send you tracking information once your order ships.</p>
    `)
    return { to: '', subject: `Order ${data.orderNumber} Confirmed — Alka Traders`, html, template: 'order-confirmation', templateData: data as Record<string, unknown> }
  },

  orderShipped(data: { orderNumber: string; customerName: string; trackingNumber: string; courier: string }): QueueEmail {
    const html = baseLayout(`
      <h2 style="margin:0 0 8px;color:#1e293b;font-size:22px;">Your Order Has Shipped 🚚</h2>
      <p style="color:#64748b;font-size:14px;margin:0 0 24px;">Hi ${escapeHtml(data.customerName)}, your order is on its way!</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin-bottom:24px;">
        <tr><td>${infoRow('Order', `<span style="font-weight:700;">${escapeHtml(data.orderNumber)}</span>`)}${infoRow('Courier', escapeHtml(data.courier))}${infoRow('Tracking', `<span style="color:#0ea5e9;font-weight:600;">${escapeHtml(data.trackingNumber)}</span>`)}</td></tr>
      </table>
      <p style="color:#64748b;font-size:13px;">Track your shipment with ${escapeHtml(data.courier)} using tracking number <strong>${escapeHtml(data.trackingNumber)}</strong>.</p>
    `)
    return { to: '', subject: `Order ${data.orderNumber} Shipped — Tracking: ${escapeHtml(data.trackingNumber)}`, html, template: 'order-shipped', templateData: data as Record<string, unknown> }
  },

  orderCancelled(data: { orderNumber: string; customerName: string; reason: string }): QueueEmail {
    const html = baseLayout(`
      <h2 style="margin:0 0 8px;color:#1e293b;font-size:22px;">Order Cancelled</h2>
      <p style="color:#64748b;font-size:14px;margin:0 0 24px;">Hi ${escapeHtml(data.customerName)}, your order <strong>${escapeHtml(data.orderNumber)}</strong> has been cancelled.</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;margin-bottom:24px;">
        <tr><td style="color:#991b1b;font-size:13px;"><strong>Reason:</strong> ${escapeHtml(data.reason)}</td></tr>
      </table>
      <p style="color:#64748b;font-size:13px;">If you have questions, contact us at <a href="mailto:${COMPANY}" style="color:#0ea5e9;">${COMPANY}</a>.</p>
    `)
    return { to: '', subject: `Order ${data.orderNumber} Cancelled — Alka Traders`, html, template: 'order-cancelled', templateData: data as Record<string, unknown> }
  },

  rfqReceived(data: { rfqNumber: string; customerName: string; productDescription: string; urgency: string }): QueueEmail {
    const urgencyColor = data.urgency === 'emergency' ? '#dc2626' : data.urgency === 'urgent' ? '#f59e0b' : '#0ea5e9'
    const html = baseLayout(`
      <h2 style="margin:0 0 8px;color:#1e293b;font-size:22px;">New RFQ Received 📋</h2>
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:8px;padding:16px;margin-bottom:24px;">
        <tr><td>${infoRow('RFQ Number', `<span style="color:#0ea5e9;font-weight:700;">${data.rfqNumber}</span>`)}${infoRow('Customer', data.customerName)}${infoRow('Urgency', `<span style="display:inline-block;background:${urgencyColor};color:#fff;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:600;text-transform:uppercase;">${data.urgency}</span>`)}${infoRow('Description', escapeHtml(data.productDescription))}</td></tr>
      </table>
      ${btn(`${FRONTEND_URL}/admin/rfqs`, 'View RFQ in Admin Panel', urgencyColor)}
    `)
    return { to: SALES_EMAIL, subject: `[RFQ ${data.urgency.toUpperCase()}] ${data.rfqNumber} — ${escapeHtml(data.customerName)}`, html, template: 'rfq-received', templateData: data as Record<string, unknown> }
  },

  rfqResponse(data: { rfqNumber: string; customerName: string; message: string }): QueueEmail {
    const html = baseLayout(`
      <h2 style="margin:0 0 8px;color:#1e293b;font-size:22px;">Response to Your RFQ</h2>
      <p style="color:#64748b;font-size:14px;margin:0 0 16px;">Hi ${data.customerName}, we've received your RFQ <strong>${data.rfqNumber}</strong> and our team is working on it.</p>
      <div style="background:#f8fafc;border-radius:8px;padding:16px;margin-bottom:24px;color:#1e293b;font-size:14px;line-height:1.6;">${escapeHtml(data.message)}</div>
      <p style="color:#64748b;font-size:13px;">Need immediate help? <a href="https://wa.me/${WHATSAPP}" style="color:#25d366;font-weight:600;">WhatsApp us</a></p>
    `)
    return { to: '', subject: `RE: RFQ ${data.rfqNumber} — Alka Traders`, html, template: 'rfq-response', templateData: data as Record<string, unknown> }
  },

  emergencyAlert(data: { rfqNumber: string; customerName: string; phone: string; partDescription: string; vesselName?: string }): QueueEmail {
    const safePhone = String(data.phone || '').replace(/[^+0-9]/g, '')
    const waPhone = String(data.phone || '').replace(/[^0-9]/g, '')
    const html = baseLayout(`
      <div style="background:#fef2f2;border:2px solid #dc2626;border-radius:8px;padding:20px;margin-bottom:24px;">
        <h2 style="margin:0 0 8px;color:#dc2626;font-size:22px;">🚨 EMERGENCY RFQ — RESPOND WITHIN 2 HOURS</h2>
        <p style="color:#991b1b;font-size:14px;margin:0;">This requires immediate attention.</p>
      </div>
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:16px;margin-bottom:24px;">
        <tr><td>${infoRow('RFQ Number', `<span style="color:#dc2626;font-weight:700;">${escapeHtml(data.rfqNumber)}</span>`)}${infoRow('Customer', escapeHtml(data.customerName))}${infoRow('Phone', `<a href="tel:${escapeHtml(safePhone)}" style="color:#0ea5e9;">${escapeHtml(data.phone)}</a>`)}${infoRow('Part Needed', escapeHtml(data.partDescription))}${data.vesselName ? infoRow('Vessel', escapeHtml(data.vesselName)) : ''}</td></tr>
      </table>
      ${btn(`tel:${safePhone}`, '📞 Call Customer Now', '#dc2626')}
      ${btn(`https://wa.me/${waPhone}`, '💬 WhatsApp Now', '#25d366')}
    `)
    return { to: SALES_EMAIL, subject: `🚨 EMERGENCY RFQ ${data.rfqNumber} — ${data.customerName} — ${data.vesselName || 'Vessel Unknown'}`, html, template: 'emergency-rfq', templateData: data as Record<string, unknown> }
  },

  offerReceived(data: { offerNumber: string; productName: string; offeredPrice: number; customerEmail: string }): QueueEmail {
    const html = baseLayout(`
      <h2 style="margin:0 0 8px;color:#1e293b;font-size:22px;">New Make-Offer Request 💰</h2>
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:8px;padding:16px;margin-bottom:24px;">
        <tr><td>${infoRow('Offer Number', `<span style="color:#0ea5e9;font-weight:700;">${data.offerNumber}</span>`)}${infoRow('Product', data.productName)}${infoRow('Offered Price', `<span style="color:#059669;font-weight:700;font-size:16px;">$${data.offeredPrice.toFixed(2)}</span>`)}${infoRow('Customer', data.customerEmail)}</td></tr>
      </table>
      ${btn(`${FRONTEND_URL}/admin/offers`, 'Review Offer in Admin', '#059669')}
    `)
    return { to: SALES_EMAIL, subject: `[OFFER] ${data.offerNumber} — $${data.offeredPrice.toFixed(2)} — ${data.productName}`, html, template: 'offer-received', templateData: data as Record<string, unknown> }
  },

  offerDecision(data: { offerNumber: string; productName: string; decision: 'accepted' | 'rejected' | 'countered'; counterPrice?: number }): QueueEmail {
    const colors = { accepted: '#059669', rejected: '#dc2626', countered: '#f59e0b' }
    const labels = { accepted: 'Accepted ✅', rejected: 'Rejected ❌', countered: `Countered at $${data.counterPrice?.toFixed(2)}` }
    const html = baseLayout(`
      <h2 style="margin:0 0 8px;color:${colors[data.decision]};font-size:22px;">Offer ${labels[data.decision]}</h2>
      <p style="color:#64748b;font-size:14px;margin:0 0 24px;">Your offer for <strong>${data.productName}</strong> has been ${data.decision}.</p>
      ${infoRow('Offer', data.offerNumber)}
      ${infoRow('Product', data.productName)}
      ${infoRow('Status', `<span style="color:${colors[data.decision]};font-weight:700;">${labels[data.decision]}</span>`)}
      ${data.decision === 'countered' ? `<p style="color:#1e293b;font-size:14px;">We've countered with <strong>$${data.counterPrice?.toFixed(2)}</strong>. Reply to this email or <a href="https://wa.me/${WHATSAPP}" style="color:#25d366;">WhatsApp us</a> to continue.</p>` : ''}
    `)
    return { to: '', subject: `Offer ${data.offerNumber} ${labels[data.decision]} — Alka Traders`, html, template: 'offer-decision', templateData: data as Record<string, unknown> }
  },

  contactNotification(data: { name: string; email: string; subject: string; message: string }): QueueEmail {
    const html = baseLayout(`
      <h2 style="margin:0 0 8px;color:#1e293b;font-size:22px;">New Contact Message 📩</h2>
      ${infoRow('From', `${escapeHtml(data.name)} &lt;${escapeHtml(data.email)}&gt;`)}
      ${infoRow('Subject', escapeHtml(data.subject) || '(no subject)')}
      <div style="background:#f8fafc;border-radius:8px;padding:16px;margin-bottom:24px;color:#1e293b;font-size:14px;line-height:1.6;">${escapeHtml(data.message)}</div>
      ${btn(`mailto:${encodeURIComponent(data.email)}?subject=${encodeURIComponent(`Re: ${data.subject || 'Your Message'}`)}`, 'Reply via Email', '#0ea5e9')}
    `)
    return { to: SALES_EMAIL, subject: `[CONTACT] ${data.subject || 'New message from ' + data.name}`, html, template: 'contact-notification', templateData: data as Record<string, unknown> }
  },

  passwordReset(data: { name: string; resetUrl: string; isAdmin?: boolean }): QueueEmail {
    const html = baseLayout(`
      <h2 style="margin:0 0 8px;color:#1e293b;font-size:22px;">Reset Your Password</h2>
      <p style="color:#64748b;font-size:14px;margin:0 0 24px;">Hi ${data.name}, we received a password reset request for your ${data.isAdmin ? 'admin' : 'customer'} account.</p>
      ${btn(data.resetUrl, 'Reset Password', '#0ea5e9')}
      <p style="color:#94a3b8;font-size:12px;margin:24px 0 0;">This link expires in 1 hour. If you didn't request this, ignore this email.</p>
    `)
    return { to: '', subject: 'Password Reset — Alka Traders', html, template: 'password-reset', templateData: data as Record<string, unknown> }
  },

  welcome(data: { name: string; email: string }): QueueEmail {
    const html = baseLayout(`
      <h2 style="margin:0 0 8px;color:#1e293b;font-size:22px;">Welcome aboard! 🎉</h2>
      <p style="color:#64748b;font-size:14px;margin:0 0 24px;">Hi ${data.name}, your account has been created successfully.</p>
      <p style="color:#1e293b;font-size:14px;">Browse our marine & industrial equipment catalog, place orders, submit RFQs, and make offers on products.</p>
      ${btn(`${FRONTEND_URL}/products`, 'Browse Products', '#0ea5e9')}
    `)
    return { to: data.email, subject: 'Welcome to Alka Traders! 🎉', html, template: 'welcome', templateData: data as Record<string, unknown> }
  },

  // ─── Admin Notifications ─────────────────────────────────────
  // Sent to the store inbox (SALES_EMAIL) and gated by the admin toggles in
  // Settings → Notifications. `to` is empty here and set by the sender so the
  // recipient can be resolved from settings at call time.

  adminOrderEvent(data: {
    event: string
    orderNumber: string
    status: string
    customerName?: string
    customerEmail?: string
    total?: number
    note?: string
  }): QueueEmail {
    const html = baseLayout(`
      <h2 style="margin:0 0 8px;color:#1e293b;font-size:22px;">${escapeHtml(data.event)} 🛒</h2>
      <p style="color:#64748b;font-size:14px;margin:0 0 24px;">An order event just happened on Alka Traders.</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:8px;padding:16px;margin-bottom:24px;">
        <tr><td>${infoRow('Order', `<span style="color:#0ea5e9;font-weight:700;">${escapeHtml(data.orderNumber)}</span>`)}${infoRow('Status', escapeHtml(data.status))}${infoRow('Customer', escapeHtml(data.customerName || 'Guest'))}${data.customerEmail ? infoRow('Email', escapeHtml(data.customerEmail)) : ''}${data.total != null ? infoRow('Total', `<strong>$${data.total.toFixed(2)}</strong>`) : ''}${data.note ? infoRow('Note', escapeHtml(data.note)) : ''}</td></tr>
      </table>
      ${btn(`${FRONTEND_URL}/admin/orders`, 'Open Orders in Admin', '#0ea5e9')}
    `)
    return { to: '', subject: `[ORDER] ${data.event} — ${data.orderNumber}`, html, template: 'admin-order-event', templateData: data as Record<string, unknown> }
  },

  adminLowStock(data: {
    products: { name: string; sku: string; stockCount: number; lowStockThreshold: number }[]
  }): QueueEmail {
    const rows = data.products.map((p) =>
      `<tr><td style="padding:8px 0;border-bottom:1px solid #f1f5f9;color:#1e293b;">${escapeHtml(p.name)}</td><td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-family:monospace;font-size:12px;color:#64748b;">${escapeHtml(p.sku)}</td><td style="padding:8px 0;border-bottom:1px solid #f1f5f9;text-align:right;font-weight:700;color:${p.stockCount <= 2 ? '#dc2626' : '#f59e0b'};">${p.stockCount} left</td></tr>`
    ).join('')
    const html = baseLayout(`
      <h2 style="margin:0 0 8px;color:#1e293b;font-size:22px;">Low Stock Alert ⚠️</h2>
      <p style="color:#64748b;font-size:14px;margin:0 0 24px;">${data.products.length} product(s) are at or below their low-stock threshold.</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
        <tr style="background:#f8fafc;"><th style="padding:10px 8px;text-align:left;font-size:12px;color:#64748b;text-transform:uppercase;">Product</th><th style="padding:10px 8px;text-align:left;font-size:12px;color:#64748b;">SKU</th><th style="padding:10px 8px;text-align:right;font-size:12px;color:#64748b;">Stock</th></tr>
        ${rows}
      </table>
      ${btn(`${FRONTEND_URL}/admin/products?filter=low-stock`, 'Review Inventory', '#f59e0b')}
    `)
    return { to: '', subject: `[STOCK] ${data.products.length} product(s) low on stock`, html, template: 'admin-low-stock', templateData: data as Record<string, unknown> }
  },

  adminNewCustomer(data: { name: string; email: string; company?: string; country?: string }): QueueEmail {
    const html = baseLayout(`
      <h2 style="margin:0 0 8px;color:#1e293b;font-size:22px;">New Customer Registration 🎉</h2>
      <p style="color:#64748b;font-size:14px;margin:0 0 24px;">A new customer account was just created.</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:8px;padding:16px;margin-bottom:24px;">
        <tr><td>${infoRow('Name', escapeHtml(data.name))}${infoRow('Email', escapeHtml(data.email))}${data.company ? infoRow('Company', escapeHtml(data.company)) : ''}${data.country ? infoRow('Country', escapeHtml(data.country)) : ''}</td></tr>
      </table>
      ${btn(`${FRONTEND_URL}/admin/customers`, 'Open Customers in Admin', '#0ea5e9')}
    `)
    return { to: '', subject: `[CUSTOMER] New registration — ${data.name}`, html, template: 'admin-new-customer', templateData: data as Record<string, unknown> }
  },

  adminReport(data: {
    period: 'weekly' | 'monthly'
    rangeLabel: string
    orders: number
    revenue: number
    newCustomers: number
    topProducts: { name: string; quantity: number; revenue: number }[]
  }): QueueEmail {
    const rows = data.topProducts.length > 0
      ? data.topProducts.map((p) =>
          `<tr><td style="padding:8px 0;border-bottom:1px solid #f1f5f9;color:#1e293b;">${escapeHtml(p.name)}</td><td style="padding:8px 0;border-bottom:1px solid #f1f5f9;text-align:center;color:#64748b;">${p.quantity}</td><td style="padding:8px 0;border-bottom:1px solid #f1f5f9;text-align:right;color:#1e293b;">$${p.revenue.toFixed(2)}</td></tr>`
        ).join('')
      : '<tr><td colspan="3" style="padding:12px 0;color:#94a3b8;text-align:center;">No sales in this period.</td></tr>'
    const html = baseLayout(`
      <h2 style="margin:0 0 8px;color:#1e293b;font-size:22px;">${data.period === 'weekly' ? 'Weekly' : 'Monthly'} Business Report 📊</h2>
      <p style="color:#64748b;font-size:14px;margin:0 0 24px;">${escapeHtml(data.rangeLabel)}</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:8px;padding:16px;margin-bottom:24px;">
        <tr><td>${infoRow('Orders', String(data.orders))}${infoRow('Revenue', `<strong>$${data.revenue.toFixed(2)}</strong>`)}${infoRow('New Customers', String(data.newCustomers))}</td></tr>
      </table>
      <h3 style="font-size:13px;text-transform:uppercase;letter-spacing:0.5px;color:#64748b;margin:0 0 12px;">Top Products</h3>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
        <tr style="background:#f8fafc;"><th style="padding:10px 8px;text-align:left;font-size:12px;color:#64748b;text-transform:uppercase;">Product</th><th style="padding:10px 8px;text-align:center;font-size:12px;color:#64748b;">Qty</th><th style="padding:10px 8px;text-align:right;font-size:12px;color:#64748b;">Revenue</th></tr>
        ${rows}
      </table>
      ${btn(`${FRONTEND_URL}/admin`, 'Open Admin Dashboard', '#0ea5e9')}
    `)
    return { to: '', subject: `[REPORT] ${data.period === 'weekly' ? 'Weekly' : 'Monthly'} sales report — ${data.rangeLabel}`, html, template: `admin-${data.period}-report`, templateData: data as Record<string, unknown> }
  },
}
