import { Link } from 'react-router-dom'
import { useMemo } from 'react'
import { SEO } from '../components/seo/SEO'
import { useLocalizedPath } from '../lib/locale'
import { useStoreSettings } from '../hooks/useStoreSettings'
import { buildShippingTerms } from '../lib/shippingPromise'
import { useStaticPageSeo } from '../lib/seo/staticPageSeo'

export default function TermsOfService() {
  const lp = useLocalizedPath()
  const seo = useStaticPageSeo('terms-of-service')
  const settings = useStoreSettings()

  // The shipping and tax terms are generated from the live configuration so
  // the legal page can never contradict the invoice.
  const shippingTerms = useMemo(
    () => buildShippingTerms({
      zones: settings.shippingZones,
      baseShippingCost: settings.shippingCost,
      freeShippingThreshold: settings.freeShippingThreshold,
      currency: settings.currency,
    }),
    [settings.shippingZones, settings.shippingCost, settings.freeShippingThreshold, settings.currency],
  )
  const taxRateLabel = (settings.taxRate * 100).toFixed(settings.taxRate * 100 % 1 === 0 ? 0 : 2)

  return (
    <div className="min-h-screen bg-[var(--primary-bg)]">
      <SEO
        title={seo.title}
        description={seo.description}
        canonical="/terms-of-service"
      />
      <div className="max-w-4xl mx-auto px-4 py-16">
        <h1 className="font-display text-3xl font-extrabold text-[var(--text-primary)] mb-8">Terms &amp; Conditions</h1>
        <p className="text-sm text-[var(--text-muted)] mb-6">Last updated: July 27, 2026</p>

        <div className="prose prose-sm max-w-none space-y-6 text-[var(--text-secondary)]">
          <section>
            <p className="text-sm leading-relaxed">
              This website is operated by Alka Traders. Throughout the site, the terms "we", "us" and "our" refer to Alka Traders.
            </p>
            <p className="text-sm leading-relaxed mt-3">
              The following terms and conditions govern the sale by Alka Traders – SELLER to the BUYER on orders for the listed products on website. These terms and conditions change occasionally. Please read carefully before submitting your order. By ordering from Alka Traders, you agree to the following terms. Please print this page and retain for your records so that you have a copy of the TOC at the time of your purchase.
            </p>
            <p className="text-sm font-semibold mt-3 text-[var(--danger)]">
              ACTUAL PHOTOS OF ORIGINAL ITEMS AND ITS DESCRIPTIONS ARE UPLOADED ON THE PRODUCT LISTINGS. BUYERS ARE KINDLY REQUESTED TO GO THROUGH THE SAME BEFORE BUYING.
            </p>
          </section>

          {/* ─── 1. ORDER ─── */}
          <section>
            <h2 className="font-display text-lg font-bold text-[var(--text-primary)] mb-3">1. Order</h2>
            <p className="text-sm leading-relaxed">
              The BUYER hereby orders from Alka Traders, hereinafter referred to as SELLER, the product(s) listed on the front of this document.
            </p>
          </section>

          {/* ─── 2. PURCHASE PRICE ─── */}
          <section>
            <h2 className="font-display text-lg font-bold text-[var(--text-primary)] mb-3">2. Purchase Price</h2>
            <p className="text-sm leading-relaxed">
              The BUYER agrees to pay the balance of the total purchase price as specified on the sales receipt document at checkout. In addition, as an addendum to our standard Terms and Conditions, when ordering from Alka Traders for items being exported from INDIA, we want our International Customers to know that additional costs may be involved. Any duties, VATs, or other applicable taxes, customs broker fees or other fees due upon entry to the buyer's country are the responsibility of the buyer. We cannot calculate these for you. You will need to contact your local Government representative to find out what these additional costs might add to the final delivery cost of your order.
            </p>
            <p className="text-sm leading-relaxed mt-3">
              Prices for our products are subject to change without notice. We reserve the right at any time to modify or discontinue the Service (or any part or content thereof) without notice at any time. We shall not be liable to you or to any third-party for any modification, price change, suspension or discontinuance of the Service.
            </p>
          </section>

          {/* ─── 3. TITLE AND DELIVERY ─── */}
          <section>
            <h2 className="font-display text-lg font-bold text-[var(--text-primary)] mb-3">3. Title and Delivery</h2>
            <p className="text-sm leading-relaxed">
              Delivery of goods to a carrier by SELLER will be CNF (Cost and Freight). BUYER assumes the risk of loss, damage or shortage in transit and shall be responsible for pursuing all claims with the carrier or carrier's insurer. BUYER shall provide SELLER with written notice of any shortage, loss or damage within three (3) days of receipt of the goods.
            </p>
            <p className="text-sm leading-relaxed mt-3">
              SELLER shall have no liability to customers or any third party for any loss, damage, or expense from any delay or failure of performance due to any cause beyond the control of SELLER including but not limited to fire, strike, accident, war conditions, government regulation or restriction, shortages in transportation, power, labour, or material, freight embargo, riot or civil commotion, pandemic conditions, default of the supplier, or events which render performance difficult or impossible.
            </p>
            <p className="text-sm leading-relaxed mt-3">
              Shipments that are non-deliverable due to incorrect and/or incomplete shipping address supplied by you, the customer, will result in an additional shipping charge for address change to attempt re-delivery. We are not responsible or liable for replacement of your order if you give us an incorrect or incomplete shipping address. We ship Monday-Friday only. We are closed on Saturday and Sunday. If you need your item by a specific date, please contact us before ordering to ensure that we will be able to meet your request.
            </p>
            <p className="text-sm leading-relaxed mt-3">
              <strong>WE ARE A GENERAL TRADER AND NOT AN AUTHORIZED DISTRIBUTOR OF ANY OF THE PRODUCTS LISTED ON OUR WEBSITE.</strong>
            </p>
          </section>

          {/* ─── 4. INSPECTION ─── */}
          <section>
            <h2 className="font-display text-lg font-bold text-[var(--text-primary)] mb-3">4. Inspection</h2>
            <p className="text-sm leading-relaxed">
              BUYER shall inspect the product(s) at delivery and shall notify SELLER of any defects or discrepancies in the product(s). Unless BUYER notifies SELLER in writing immediately of any defects or discrepancies, it shall be conclusively presumed, by BUYER and SELLER, that the product(s) was delivered in good repair and operable and BUYER accepts the product(s) as delivered.
            </p>
          </section>

          {/* ─── 5. WARRANTIES ─── */}
          <section>
            <h2 className="font-display text-lg font-bold text-[var(--text-primary)] mb-3">5. Warranties</h2>
            <p className="text-sm leading-relaxed">
              We are dealing in old and used items — there will be no warranty on the sold products.
            </p>
          </section>

          {/* ─── 6. ALTERATION, MODIFICATIONS AND ATTACHMENTS ─── */}
          <section>
            <h2 className="font-display text-lg font-bold text-[var(--text-primary)] mb-3">6. Alteration, Modifications and Attachments</h2>
            <p className="text-sm leading-relaxed">
              Any alterations, additions, improvements, or attachments on the product(s) not authorized in writing by SELLER shall be solely at BUYER's expense and risk. To the extent that any alteration, addition, improvement, modification, or installation affects the operation of the product(s), SELLER shall have no further obligations to the BUYER hereinafter.
            </p>
          </section>

          {/* ─── 7. LIABILITY ─── */}
          <section>
            <h2 className="font-display text-lg font-bold text-[var(--text-primary)] mb-3">7. Liability</h2>
            <p className="text-sm leading-relaxed">
              SELLER's liability under this Agreement for any breach hereof is limited to those rights conferred on BUYER to dispatch the selected product at agreed price; and any right of BUYER to consequential, incidental, indirect or special damages is hereby excluded. SELLER shall not be liable for any loss, damages, or injury, either personal or business, of any kind to any premises or property arising from the use of the product(s).
            </p>
          </section>

          {/* ─── 8. CANCELLATION POLICY ─── */}
          <section>
            <h2 className="font-display text-lg font-bold text-[var(--text-primary)] mb-3">8. Cancellation Policy</h2>
            <p className="text-sm leading-relaxed">
              We reserve the right to refuse/cancel any order you place with us. We may, in our sole discretion, limit or cancel quantities purchased per person, per household or per order. These restrictions may include orders placed by or under the same customer account, the same credit card, and/or orders that use the same billing and/or shipping address. In the event that we make a change to or cancel an order, we may attempt to notify you by contacting the e-mail and/or billing address/phone number provided at the time the order was made. We reserve the right to limit or prohibit orders that, in our sole judgment, appear to be placed by dealers, resellers or distributors.
            </p>
            <p className="text-sm leading-relaxed mt-3">
              You agree to provide current, complete and accurate purchase and account information for all purchases made at our store. You agree to promptly update your account and other information, including your email address and credit card numbers and expiration dates, so that we can complete your transactions and contact you as needed.
            </p>
            <p className="text-sm leading-relaxed mt-3">
              The Buyer can choose to cancel an order any time before it's dispatched. The order cannot be cancelled once it is dispatched. In some cases, the customer may not be allowed to cancel the order for free, post the specified time and a cancellation fee will be charged.
            </p>
            <p className="text-sm leading-relaxed mt-3">
              In case of any cancellation from the seller due to unforeseen circumstances, a full refund will be initiated for prepaid orders.
            </p>
            <p className="text-sm leading-relaxed mt-3">
              For more detail, please review our <Link to={lp('/refund-policy')} className="text-[var(--accent-primary)] hover:underline">Returns Policy</Link>.
            </p>
          </section>

          {/* ─── 9. TYPOGRAPHICAL ERRORS ─── */}
          <section>
            <h2 className="font-display text-lg font-bold text-[var(--text-primary)] mb-3">9. Typographical Errors</h2>
            <p className="text-sm leading-relaxed">
              In the event a SELLER product is listed at an incorrect price or with incorrect product description, details, pictures or condition due to typographical error, SELLER will inform BUYER regarding the incident and BUYER will have a chance to pay/receive, proceed/cancel the order as per mutual understanding of SELLER and BUYER. SELLER shall have the right to refuse or cancel any orders placed for product listed with above mentioned discrepancies. SELLER shall have the right to refuse or cancel any such orders whether or not the order has been confirmed and your payment is processed. If your payment has already been processed for the purchase and your order is cancelled, SELLER shall issue a credit to your account or refund the amount of the incorrect price. We reserve the right to cancel any order, any time for any reason without any prior notice.
            </p>
          </section>

          {/* ─── 10. ENTIRE AGREEMENT ─── */}
          <section>
            <h2 className="font-display text-lg font-bold text-[var(--text-primary)] mb-3">10. Entire Agreement</h2>
            <p className="text-sm leading-relaxed">
              This document constitutes the entire Agreement between the BUYER and SELLER. It is intended as a complete and exclusive statement of the terms of the Agreement and no course of prior dealings between the parties and no usage of the trade shall be relevant to supplement or explain any term used in this Agreement. No agent, employee, or representative of the SELLER has any authority to bind the SELLER to any affirmation or representation concerning the product(s) sold under this Agreement, unless the same is included within this written Agreement. This Agreement may be modified or rescinded only by a written instrument signed by the parties hereto or by their duly authorized agents.
            </p>
            <p className="text-sm leading-relaxed mt-3">
              Waiver by the SELLER of any provision hereof in one instance shall not constitute a waiver as to any other instance.
            </p>
          </section>

          {/* ─── DIVIDER: SHIPPING POLICY ─── */}
          <div className="border-t border-[var(--border)] pt-6 mt-8">
            <h1 className="font-display text-2xl font-extrabold text-[var(--text-primary)] mb-6">Shipping Policy</h1>

            <section className="mb-6">
              <h2 className="font-display text-lg font-bold text-[var(--text-primary)] mb-3">Carriers &amp; Coverage</h2>
              <p className="text-sm leading-relaxed">
                Our official logistics partners are DHL &amp; FedEx, renowned for their extensive delivery networks and time-definite solutions to over 200+ countries and territories worldwide. Please visit FedEx / DHL website for specific services available in your country. We retain the right to make the final decision on which carrier your package is shipped. On rare occasions, we may use alternative carriers for logistical or operational reasons.
              </p>
            </section>

            <section className="mb-6">
              <h2 className="font-display text-lg font-bold text-[var(--text-primary)] mb-3">Shipping Charges</h2>
              <ul className="list-disc pl-5 space-y-1 text-sm">
                {/* Generated from the same shipping configuration the checkout
                    prices with — the legal page must not promise a different
                    freight than the invoice charges. */}
                {shippingTerms.map((line) => (
                  <li key={line}>{line}</li>
                ))}
                <li>Orders at or above $100 having weight above 250 kgs may attract extra freight. BUYER has to contact SELLER to choose shipping options from Airport delivery, Door delivery &amp; Sea delivery which may have different freight costs.</li>
              </ul>
            </section>

            <section className="mb-6">
              <h2 className="font-display text-lg font-bold text-[var(--text-primary)] mb-3">Processing and Delivery</h2>
              <p className="text-sm leading-relaxed">
                All orders with stock items will be shipped within 48 hours of receiving cleared payment Monday – Friday 9am – 5pm IST. (Payment must be received within 7 days of placing an order. In case of non-receipt of the payment your order will be terminated and the item will be made available for purchase to other buyers.) We will do our best to ship your order the same day if it comes in before 1:00 pm IST, Monday to Friday. We will notify you promptly if an item ordered is backordered. If you need something delivered on urgent basis, we suggest you call us to make sure we can ship the item you need for delivery when you need it.
              </p>
              <p className="text-sm leading-relaxed mt-3">
                Once your item(s) have been shipped, you will receive a Shipment Notification email containing the carrier's name and a tracking number with a link to their website, allowing you to track your consignment. Please note that the estimated time of delivery (ETD) will be around 10-12 working days after your article is shipped.
              </p>
              <p className="text-sm leading-relaxed mt-3">
                <strong>Packaging:</strong> Packages having weight up to 40 kgs will be packed in a corrugated box unless it's a delicate or fragile item. Packages having weight above 40 kgs will need to be packed in a heat-treated lumber as per the logistics norms. Most items we carry ship from our location.
              </p>
            </section>

            <section className="mb-6">
              <h2 className="font-display text-lg font-bold text-[var(--text-primary)] mb-3">Express Delivery</h2>
              <p className="text-sm leading-relaxed">
                Understanding the impact and cost of equipment breakdowns, we provide worldwide express delivery for all our products. Through our network of preferred partner warehouses and distribution centres, we offer a unique and efficient service across the globe.
              </p>
            </section>

            <section className="mb-6">
              <h2 className="font-display text-lg font-bold text-[var(--text-primary)] mb-3">Arrange Your Own Shipping</h2>
              <p className="text-sm leading-relaxed">
                If you prefer to arrange your own shipping, you have the option to do so. However, this process may attract packing and handling charges. To use your own shipping company, please contact our sales team with your account details and your desired shipping service, the rest will be taken care of. It is important to highlight that by choosing your own shipping, we will not be responsible for any loss or damage during transit. You will be solely responsible to resolve any issues directly with your shipping company.
              </p>
            </section>

            <section className="mb-6">
              <h2 className="font-display text-lg font-bold text-[var(--text-primary)] mb-3">Import Custom Charges</h2>
              <p className="text-sm leading-relaxed">
                As an addendum to our standard Terms and Conditions, when ordering from Alka Traders for items being exported from INDIA, we want our International Customers to know that additional costs may be involved. Any duties, VATs, or other applicable taxes, customs broker fees or other fees due upon entry to the buyer's country are the responsibility of the buyer. We cannot calculate these for you. You will need to contact your local Government representative to find out what these additional costs might add to the final delivery cost of your order.
              </p>
              <p className="text-sm leading-relaxed mt-3">
                Buyer will be responsible to keep a track on their incoming package and to furnish all the required details by the logistics. If the buyer fails to clear customs or refuses the incoming shipment, there will be no option for us to receive the returned material and we will not be in possession of the goods.
              </p>
              <p className="text-sm leading-relaxed mt-3">
                Combined shipping is done at the seller's discretion. If you purchase more than one item from us, they may arrive in separate/single packages.
              </p>
              <p className="text-sm leading-relaxed mt-3">
                All shipments to locations outside of INDIA are shipped CNF (Cost and Freight).
              </p>
              <p className="text-sm leading-relaxed mt-3">
                <strong>Domestic Buyers:</strong> Tax of {taxRateLabel}% applies to the items purchased within INDIA. The exact rate charged on your order is shown at checkout and on your invoice.
              </p>
            </section>
          </div>

          {/* ─── CONTACT ─── */}
          <section>
            <h2 className="font-display text-lg font-bold text-[var(--text-primary)] mb-3">Contact</h2>
            <p className="text-sm leading-relaxed">
              For questions about these terms, contact us at{' '}
              <a href="mailto:sales@alkatraders.co" className="text-[var(--accent-primary)] hover:underline">sales@alkatraders.co</a>{' '}
              or call{' '}
              <a href="tel:+918799095041" className="text-[var(--accent-primary)] hover:underline">+91 87990 95041</a>.
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
