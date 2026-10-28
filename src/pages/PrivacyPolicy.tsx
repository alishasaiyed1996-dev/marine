import { SEO } from '../components/seo/SEO'
import { useStaticPageSeo } from '../lib/seo/staticPageSeo'

export default function PrivacyPolicy() {
  const seo = useStaticPageSeo('privacy-policy')
  return (
    <div className="min-h-screen bg-[var(--primary-bg)]">
      <SEO
        title={seo.title}
        description={seo.description}
        canonical="/privacy-policy"
      />
      <div className="max-w-4xl mx-auto px-4 py-16">
        <h1 className="font-display text-3xl font-extrabold text-[var(--text-primary)] mb-8">Privacy Policy</h1>
        <p className="text-sm text-[var(--text-muted)] mb-6">Last updated: July 27, 2026</p>

        <div className="prose prose-sm max-w-none space-y-6 text-[var(--text-secondary)]">
          <section>
            <p className="text-sm leading-relaxed">
              This Privacy Policy outlines how your personal information is collected, used, and shared when you visit or make a purchase from Alka Traders (alkatraders.co).
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-[var(--text-primary)] mb-3">1. Information We Collect</h2>
            <p className="text-sm leading-relaxed">
              When you visit the Site, we automatically collect certain information about your device, including information about your web browser, IP address, time zone, and cookies that are installed on your device. As you browse, we also collect details about individual web pages or products that you view, what websites or search terms referred you to the Site, and how you interact with the Site. We refer to this automatically collected data as "Device Information."
            </p>
            <p className="text-sm leading-relaxed mt-3">
              Additionally, when you make or attempt to make a purchase, we collect certain information from you, including your name, billing address, shipping address, payment information, email address, and phone number. We refer to this as "Order Information." When we talk about "Personal Information" in this Privacy Policy, we are referring to both Device Information and Order Information.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-[var(--text-primary)] mb-3">2. Cookies and Tracking</h2>
            <p className="text-sm leading-relaxed">
              The Site uses cookies and tracking technology depending on the features offered. Cookies and tracking technology are useful for gathering information such as browser type and operating system, tracking the number of visitors to the Site, and understanding how visitors use it. Cookies can also help customize the Site for visitors. Personal information cannot be collected via cookies and other tracking technology; however, if you previously provided personally identifiable information, cookies may be tied to such information. Aggregate cookie and tracking information may be shared with third parties.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-[var(--text-primary)] mb-3">3. How We Use Your Personal Information</h2>
            <p className="text-sm leading-relaxed">
              We use the Order Information that we collect generally to fulfill any orders placed through the Site (including processing your payment information, arranging for shipping, and providing you with invoices and/or order confirmations).
            </p>
            <p className="text-sm leading-relaxed mt-3">Additionally, we use this Order Information to:</p>
            <ul className="list-disc pl-5 space-y-1 text-sm">
              <li>Communicate with you</li>
              <li>Screen our orders for potential risk or fraud</li>
              <li>When in line with the preferences you have shared with us, provide you with information or advertising relating to our products or services</li>
              <li>Improve and optimize our Site (for example, by generating analytics about how our customers browse and interact with the Site, and to assess the success of our marketing and advertising campaigns)</li>
            </ul>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-[var(--text-primary)] mb-3">4. Sharing Your Personal Information</h2>
            <p className="text-sm leading-relaxed">
              We share your Personal Information with third parties to help us use your Personal Information, as described above. Information we collect as you access and use our service includes device information, location, and network carrier.
            </p>
            <p className="text-sm leading-relaxed mt-3">This information is shared with third-party service providers so that we can:</p>
            <ul className="list-disc pl-5 space-y-1 text-sm">
              <li>Personalize the Site for you</li>
              <li>Perform behavioral analytics</li>
            </ul>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-[var(--text-primary)] mb-3">5. Behavioral Advertising</h2>
            <p className="text-sm leading-relaxed">
              We use Google Analytics and Microsoft Clarity to understand how the site is used. Where advertising features and remarketing are enabled in our Google Analytics property, Google may place a cookie on your machine to show ads relevant to the pages you viewed. Google Analytics, Microsoft Clarity, and any remarketing only run <strong>after you accept analytics cookies</strong> in the cookie notice — declining leaves the site fully usable and no analytics identifier is set.
            </p>
            <p className="text-sm leading-relaxed mt-3">
              THIS COOKIE DOES NOT IN ANY WAY IDENTIFY YOU OR GIVE ACCESS TO YOUR COMPUTER. The cookie is used to say "This person visited this page, so show them ads relating to that page."
            </p>
            <p className="text-sm leading-relaxed mt-3">
              You can change your choice at any time by clearing this site's storage in your browser and choosing again in the cookie notice. You can also opt out of Google Analytics remarketing using the Google Analytics Opt-out Browser Add-on.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-[var(--text-primary)] mb-3">6. Data Retention</h2>
            <p className="text-sm leading-relaxed">
              When you place an order through the Site, we will maintain your order information for our records unless and until you ask us to delete this information.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-[var(--text-primary)] mb-3">7. Commitment to Data Security</h2>
            <p className="text-sm leading-relaxed">
              Your personally identifiable information is kept secure. Only authorized employees, agents, and contractors (authorized under a non-disclosure agreement) have access to this information.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-[var(--text-primary)] mb-3">8. Changes</h2>
            <p className="text-sm leading-relaxed">
              As part of our efforts to ensure that we properly manage, protect, and process your personal data, we review our policies, procedures, and processes from time to time.
            </p>
            <p className="text-sm leading-relaxed mt-3">
              We may amend the terms of this Privacy Policy at our absolute discretion for operational, legal, or regulatory reasons. Updates will be reflected on this page.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-[var(--text-primary)] mb-3">9. Contact</h2>
            <p className="text-sm leading-relaxed">
              For privacy-related inquiries, contact us at{' '}
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
