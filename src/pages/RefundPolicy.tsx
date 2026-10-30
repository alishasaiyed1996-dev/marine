import { SEO } from '../components/seo/SEO'
import { useStaticPageSeo } from '../lib/seo/staticPageSeo'

export default function RefundPolicy() {
  const seo = useStaticPageSeo('refund-policy')
  return (
    <div className="min-h-screen bg-[var(--primary-bg)]">
      <SEO title={seo.title} description={seo.description} canonical="/refund-policy" />
      <article className="max-w-4xl mx-auto px-4 py-16">
        <h1 className="font-display text-3xl font-extrabold text-[var(--text-primary)] mb-4">Return and Exchange Policy</h1>
        <p className="text-sm text-[var(--text-muted)] mb-8">Last updated: October 30, 2026</p>

        <div className="prose prose-sm max-w-none space-y-6 text-[var(--text-secondary)]">
          <section>
            <h2 className="font-display text-lg font-bold text-[var(--text-primary)] mb-3">All sales are final</h2>
            <p className="text-sm leading-relaxed">All sales made by Alka Traders are final. We do not accept returns and we do not offer exchanges.</p>
            <p className="text-sm leading-relaxed mt-3">This follows directly from what we sell. A large part of our catalog is used equipment, surplus stock, and discontinued assemblies sourced through the Bhavnagar and Alang network, and much of the rest is imported or arranged for a specific buyer. Used and surplus items cannot be restocked or resold as new, and once a part leaves our control we cannot verify its condition. Accepting returns would mean building that risk into every price, and we would rather give you one honest price than hide a cost inside it.</p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-[var(--text-primary)] mb-3">Review the item before confirming</h2>
            <p className="text-sm leading-relaxed">Every product page states the condition of the item in both its summary and its description, including where the item is used. Before an order is confirmed, we also give you the condition, availability, lead time, shipping option, and price in writing. Please read these carefully and send us the nameplate, serial plate, part number, or IMPA reference of what you need so we can check it against the listing with you. By confirming an order, you accept the item as described.</p>
          </section>
          <section>
            <h2 className="font-display text-lg font-bold text-[var(--text-primary)] mb-3">No returns or exchanges</h2>
            <p className="text-sm leading-relaxed">For this reason, we do not accept returns or exchanges for change of mind, ordering the wrong part or specification, incompatibility with your equipment where the part number and details were confirmed, or any reason that arises after the order is placed. We do not charge restocking or handling fees, because we do not process returns at all.</p>
          </section>
          <section>
            <h2 className="font-display text-lg font-bold text-[var(--text-primary)] mb-3">Questions before you buy</h2>
            <p className="text-sm leading-relaxed">If you have any question about a listing or a pending order, contact our procurement team before you buy. We will answer plainly, including telling you when we are not the right supplier for what you need.</p>
            <p className="text-sm leading-relaxed mt-3">Email <a href="mailto:sales@alkatraders.co" className="text-[var(--accent-primary)] hover:underline">sales@alkatraders.co</a> or call <a href="tel:+918799095041" className="text-[var(--accent-primary)] hover:underline">+91 87990 95041</a>.</p>
          </section>
        </div>
      </article>
    </div>
  )
}
