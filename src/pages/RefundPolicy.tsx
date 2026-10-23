import { SEO } from '../components/seo/SEO'
import { useStaticPageSeo } from '../lib/seo/staticPageSeo'

export default function RefundPolicy() {
  const seo = useStaticPageSeo('refund-policy')
  return (
    <div className="min-h-screen bg-[var(--primary-bg)]">
      <SEO
        title={seo.title}
        description={seo.description}
        canonical="/refund-policy"
      />
      <div className="max-w-4xl mx-auto px-4 py-16">
        <h1 className="font-display text-3xl font-extrabold text-[var(--text-primary)] mb-8">Return &amp; Refund Policy</h1>
        <p className="text-sm text-[var(--text-muted)] mb-6">Last updated: July 27, 2026</p>

        <div className="prose prose-sm max-w-none space-y-6 text-[var(--text-secondary)]">
          {/* ─── RETURNS POLICY ─── */}
          <section>
            <h2 className="font-display text-lg font-bold text-[var(--text-primary)] mb-3">Returns Policy</h2>
            <p className="text-sm leading-relaxed">
              <strong>Definition:</strong> 'Return' is defined as the action of giving back the item purchased by the Buyer to Alka Traders. Following situations may arise:
            </p>
            <ul className="list-disc pl-5 space-y-1 text-sm">
              <li>Item was defective</li>
              <li>Item was damaged during the Shipping</li>
              <li>Products was/were missing</li>
              <li>If the wrong item was sent by Alka Traders</li>
              <li>Not as Described</li>
            </ul>
            <p className="text-sm leading-relaxed mt-3">
              We encourage the Buyer to review the listing before making the purchase decision. In case of Buyer orders a wrong item, the Buyer shall not be entitled to any return/refund. The return could also result in a refund of money in most of cases.
            </p>
            <p className="text-sm leading-relaxed mt-3">
              Products purchased from the SELLER may be returned by the BUYER, in their unopened package, during the 30 day period. Post 30 days the return, refund or exchange window will be closed. In order to process returns, an RMA (return merchandise authorization) number must be obtained from the SELLER. The items for return must be unopened and in a pristine and resalable condition, ALL seals must be intact and ALL packaging must be pristine and unmarked. Buyer will be required to return the goods to us at their own cost which will be non-refundable; we will deduct any such charges from the refund amount. The correct address will be provided once the RMA has been issued. Damaged items are not returnable.
            </p>
            <p className="text-sm leading-relaxed mt-3">
              SELLER reserves the right to refuse return of damaged, used or incomplete returns. Returns will be accepted only if the item received by the buyer is not as described in the listing. IF THE CARRIER RETURNING ITEMS WILL NOT ALLOW US TO EXAMINE CONTENTS PRIOR TO SIGNING POD, WE WILL SIGN AS 'UNCHECKED'. IF GOODS ARE SUBSEQUENTLY FOUND TO BE DAMAGED OR NOT AS STATED, REFUND/REPLACEMENT WILL NOT BE ISSUED AND YOU WILL BE REQUESTED TO COLLECT SAID GOODS AT YOUR COST. BUYER NEEDS TO CONFIRM ACCEPTANCE OF THESE CONDITIONS IN ORDER TO RECEIVE RMA CONFIRMATION FROM OUR END.
            </p>
            <p className="text-sm leading-relaxed mt-3">
              We will inspect the item upon receiving. The decision of acceptance/rejection and credit will be at sole discretion of Alka Traders. We do our best to present accurate, detailed information about every item we sell. Please feel free to contact us if you have any query before Buying. In case of receiving item in damaged condition, buyer has to retain all the packaging until and unless asked to dispose it off by the seller. Further, buyer has to co-operate in an event where logistics carrier team requires more information or any other details to investigate the damages.
            </p>
          </section>

          {/* ─── REFUND POLICY ─── */}
          <section>
            <h2 className="font-display text-lg font-bold text-[var(--text-primary)] mb-3">Refund Policy</h2>
            <p className="text-sm leading-relaxed">
              Once the return is accepted from our end, buyer has to return the article as per the instructions mentioned in RMA. It can take up to 25 days for an item to reach us once you return the item. It will take around 24-48 hours to provide refund after investigation.
            </p>
            <p className="text-sm leading-relaxed mt-3">
              For damaged/defective items, Alka Traders will issue a refund if the item cannot be repaired or replaced.
            </p>
            <p className="text-sm leading-relaxed mt-3">
              In any case where a refund is required, the Customer Care Executive needs to authorize that refund. Alka Traders can assist in facilitating refunds for you once the Customer Care Executive notifies us of the receipt of the returned item, and we will apply for processing refunds.
            </p>
          </section>

          {/* ─── CONTACT ─── */}
          <section>
            <h2 className="font-display text-lg font-bold text-[var(--text-primary)] mb-3">Contact</h2>
            <p className="text-sm leading-relaxed">
              For return or refund requests, contact us at{' '}
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
