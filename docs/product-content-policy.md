# Product content and SEO policy

Last updated: 2026-10-22

This policy applies to every product page, category page, meta description and
Merchant Center feed generated from the Alka Traders catalog.

## The short version

Google does not reject a page because it was written by AI. It can demote a page
that exists mainly to manipulate rankings and does not help the searcher. The
same rule applies to human-written, template-written and AI-assisted pages.

The risk on a 1,000+ product catalog is not "AI detection". It is **the same
generic paragraphs and FAQs repeated across hundreds of URLs**. Fix that with
unique listing facts, not with detector-evasion tricks.

## Do not do these things

1. **Do not try to bypass AI detectors or "humanize" text.**
   AI-detection scores are not a Google ranking factor. Rewriting text to fool a
   detector does not add product information and can make the copy less accurate.

2. **Do not invent an author, reviewer, certification, test result, review,
   rating, customer, shipping time or compatibility claim.**
   If a person has not reviewed a page, do not add "Reviewed by..." text. If a
   compatibility has not been verified, say that it is not recorded.

3. **Do not pad pages to a word count.**
   A short page with the real MPN, IMPA code, dimensions, condition notes and
   photos is better than 800 words of generic filler. Word count is not a
   quality signal by itself.

4. **Do not put site-wide shipping, returns, payment or "about us" paragraphs
   in the product body.**
   Keep those on the shipping, returns, payment and about pages, and link to
   them. Repetition across the catalog is the main scaled-content risk.

5. **Do not generate a generic FAQ on every product.**
   FAQ copy is allowed only when the answer contains a fact from that listing,
   such as the included quantity, the recorded condition or the exact part
   number. Do not add FAQPage structured data for generic customer-service Q&A.

6. **Do not publish mass-generated pages without a review path.**
   Pages with no description, no identifier and no condition note should be held
   for enrichment or marked `noindex` until a person has enough information to
   make the page useful. Do not publish them just to increase the URL count.

7. **Do not create fake E-E-A-T signals.**
   No fake author bios, fake "inspected by" badges, fake reviews, fake
   certifications or invented "20 years of experience" claims. Use real business
   details, real contact routes, real policies and real product evidence.

8. **Do not duplicate the same product under multiple indexable URLs.**
   Keep one canonical URL per product and redirect legacy UUID URLs.

9. **Do not submit AI-generated Merchant Center titles or descriptions as if a
   person wrote them.**
   If generative AI is used for feed attributes, follow Google's structured
   product data rules: supply `structured_title` / `structured_description` and
   set `digital_source_type` to `trained_algorithmic_media`. This is a Merchant
   Center feed requirement, separate from on-page SEO.

## What to do instead

- Start with listing facts: brand, model, MPN, IMPA code, SKU, size, material,
  voltage, capacity, condition notes, included items, item location, lead time
  and photos.
- Make the unique facts visible and specific. "IMPA 232483" is useful.
  "High-quality marine-grade product" is not.
- Use exact product identifiers in the H1, title, meta description, specs,
  fitment section and Product structured data.
- Show the actual condition and contents. Do not smooth over missing data with
  confident language.
- Link to the site-wide shipping, returns and export policies instead of
  repeating them on every product.
- Keep one human-maintained policy page for shipping, one for returns and one
  for export/RFQ terms.
- Give the highest-value or highest-traffic products a real manual review:
  check the identifiers, photos, condition wording and fitment notes.
- Use `npm run seo:audit` after every content or template change. It checks
  duplicate titles/descriptions, specifications, structured data, repeated
  sentences and repeated FAQ questions across the rebuilt catalog.

## Review workflow

1. Import or update the product record.
2. Confirm that the identifiers and condition data are present.
3. If the record is thin (no description, no identifiers, no condition notes),
   enrich it before publishing or keep it out of the index.
4. For a sampled set of high-value products, a person compares the page with the
   photos and listing data and records the review date.
5. Run the build, prerender and SEO audit.
6. Re-check the audit after any template change. A lower word count is acceptable
   if the unique facts are still present.

## Metrics that matter

- Repeated-sentence share across product articles: target **<= 20%**
- Identical FAQ question on more than 10% of products: target **0**
- Duplicate titles or meta descriptions: target **0**
- Pages with identifiers and specifications: target **100%** where the data exists
- Pages under 120 words: review individually; do not pad them

## Current catalog audit (2026-10-22)

- 1,074 English product pages
- Average article length: 389 words; minimum: 145 words
- Repeated-sentence share: 0.3% (target <= 20%)
- Duplicate titles: 0; duplicate meta descriptions: 0
- Repeated FAQ questions: 0
- 689 pages have at least two product-specific FAQs and FAQPage markup;
  the remaining pages have at most one visible fact-based answer and no
  FAQPage markup
- 8 pages are under 200 words because the source record has little more than
  an identifier and condition; they should be enriched or reviewed for
  `noindex` rather than padded

## Official guidance

- Google Search: AI-generated content and Google Search
  https://developers.google.com/search/docs/fundamentals/using-gen-ai-content
- Google Search spam policies: scaled content abuse
  https://developers.google.com/search/docs/essentials/spam-policies#scaled-content
- Google Search: creating helpful, reliable, people-first content
  https://developers.google.com/search/docs/fundamentals/creating-helpful-content
- Google Merchant Center: AI-generated product data
  https://support.google.com/merchants/answer/14743464
