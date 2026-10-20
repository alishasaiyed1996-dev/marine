import { AlertTriangle, CheckCircle2, Image as ImageIcon, RotateCcw, Sparkles } from 'lucide-react'
import type { ProductFormData } from '../../hooks/useProductForm'
import { buildProductSeo } from '../../lib/seo/productSeo'
import {
  MIN_PRODUCT_DESCRIPTION_WORDS,
  countWords,
  isValidGtin,
  meetsProductDescriptionMinimum,
} from '../../lib/seo/productContent'

interface ProductFormSeoProps {
  form: ProductFormData
  updateField: <K extends keyof ProductFormData>(field: K, value: ProductFormData[K]) => void
  getFieldClass: (field: string, extra?: string) => string
  labelClass: string
  isEditing?: boolean
  publicSlug?: string
  slugError?: string
  brandName?: string
  categoryName?: string
}

const UNKNOWN_HINT = 'Leave blank if unknown — never guess'
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SITE_HOST = 'alkatraders.co'

function characterState(value: string, min: number, max: number): { label: string; tone: string } {
  const length = value.trim().length
  if (!length) return { label: 'Missing', tone: 'text-[var(--danger)]' }
  if (length < min) return { label: `Too short (min ${min})`, tone: 'text-[var(--danger)]' }
  if (length > max) return { label: `Too long (max ${max})`, tone: 'text-[var(--danger)]' }
  return { label: 'Good', tone: 'text-[var(--success)]' }
}

export function ProductFormSeo({
  form,
  updateField,
  getFieldClass,
  labelClass,
  isEditing = false,
  publicSlug = '',
  slugError = '',
  brandName = '',
  categoryName = '',
}: ProductFormSeoProps) {
  const titleLength = form.seoTitle.trim().length
  const descriptionLength = form.seoDescription.trim().length
  const bodyLength = form.description.trim().length
  const bodyWords = countWords(form.description)
  const slug = form.slug.trim()
  const slugIsValid = !slug || (slug.length <= 200 && SLUG_PATTERN.test(slug))
  // A blank slug means "keep the current URL", not "change it", so only warn
  // when a different non-empty URL will actually be saved.
  const slugChanged = isEditing && Boolean(publicSlug) && Boolean(slug) && slug !== publicSlug
  const mainImage = form.images.find((image) => image.url.trim())
  const titleState = characterState(form.seoTitle, 1, 70)
  const descriptionState = characterState(form.seoDescription, 80, 160)

  const publishChecks = [
    {
      label: 'Name & SKU',
      detail: form.name.trim() && form.sku.trim() ? 'Present' : 'Required to publish',
      ok: Boolean(form.name.trim() && form.sku.trim()),
    },
    { label: 'Product description', detail: `${bodyLength} chars · ${bodyWords}/${MIN_PRODUCT_DESCRIPTION_WORDS} words (300 chars or 50 words)`, ok: meetsProductDescriptionMinimum(form.description) },
    { label: 'Category', detail: form.category ? 'Assigned' : 'No category selected', ok: Boolean(form.category) },
    { label: 'SEO title', detail: `${titleLength}/70 characters`, ok: titleLength >= 1 && titleLength <= 70 },
    { label: 'SEO description', detail: `${descriptionLength}/80–160 characters`, ok: descriptionLength >= 80 && descriptionLength <= 160 },
    {
      label: 'Verified identifier',
      detail: 'Model number, MPN or IMPA code',
      ok: [form.modelNumber, form.mpn, form.impaCode].some((value) => value.trim().length > 0),
    },
    {
      label: 'Main image alt text',
      detail: mainImage ? (mainImage.alt.trim() ? 'Alt text present' : 'Alt text missing') : 'No image added',
      ok: Boolean(mainImage?.alt.trim()),
    },
  ]
  const passing = publishChecks.filter((check) => check.ok).length

  const generateMetadata = () => {
    const generated = buildProductSeo({
      id: 'new-product',
      slug: slug || 'new-product',
      name: form.name,
      sku: form.sku,
      brand: brandName || 'Unknown',
      category: categoryName || 'other-business',
      condition: form.condition || 'used',
      description: form.description,
      price: Number(form.regularPrice) || 0,
      currency: form.currency,
      inStock: form.availability !== 'out-of-stock',
      stockCount: Number(form.stockCount) || 0,
      images: form.images.filter((image) => image.url).map((image) => ({ url: image.url, alt: image.alt })),
      makeOffer: form.makeOfferEnabled,
      manufacturer: form.manufacturer,
      modelNumber: form.modelNumber,
      mpn: form.mpn,
      gtin: form.gtin,
      impaCode: form.impaCode,
    })

    // The generated sentence is intentionally factual and can be shorter than
    // the 80-character publish minimum for sparse products. Add a neutral
    // procurement sentence rather than padding with keywords.
    let metaDescription = generated.metaDescription.trim()
    if (metaDescription.length < 80) {
      metaDescription = `${metaDescription} Request a quote for current availability, condition photos and export pricing.`
        .replace(/\s+/g, ' ')
        .trim()
    }

    updateField('seoTitle', generated.title.slice(0, 70))
    updateField('seoDescription', metaDescription.slice(0, 160))
  }

  const previewTitleRaw = form.seoTitle.trim() || form.name.trim() || 'Product title'
  const previewTitle = /(?:^|[|\-–—])\s*Alka Traders\s*(?:$|[|\-–—])/i.test(previewTitleRaw)
    ? previewTitleRaw.slice(0, 70)
    : `${previewTitleRaw.slice(0, 70)} | Alka Traders`
  const previewDescription = form.seoDescription.trim()
    || form.shortDescription.trim()
    || form.description.trim().slice(0, 160)
    || 'Add a meta description to control how this product appears in search results.'
  const previewSlug = slug || 'auto-generated-from-product-name'

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-lg font-bold text-[var(--text-primary)]">Search appearance</h2>
          <span className={`text-xs font-bold ${passing === publishChecks.length ? 'text-[var(--success)]' : 'text-[var(--accent-gold)]'}`}>
            {passing}/{publishChecks.length} publish requirements met
          </span>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {publishChecks.map((check) => (
            <div
              key={check.label}
              className={`rounded-xl border px-3 py-2 ${check.ok ? 'border-[var(--success)]/30 bg-[var(--success)]/5' : 'border-[var(--accent-gold)]/30 bg-[var(--gold-muted)]'}`}
            >
              <div className="flex items-start gap-1.5">
                {check.ok
                  ? <CheckCircle2 size={12} className="mt-0.5 shrink-0 text-[var(--success)]" />
                  : <AlertTriangle size={12} className="mt-0.5 shrink-0 text-[var(--accent-gold)]" />}
                <div className="min-w-0">
                  <p className="text-[0.625rem] font-bold text-[var(--text-primary)]">{check.label}</p>
                  <p className="text-[0.5625rem] text-[var(--text-muted)]">{check.detail}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── URL ─────────────────────────────────────────────── */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className={`${labelClass} mb-0`}>Public URL slug</label>
          {slugChanged && (
            <button
              type="button"
              onClick={() => updateField('slug', publicSlug)}
              className="inline-flex items-center gap-1 text-[0.625rem] font-bold text-[var(--accent-blue)] hover:underline"
            >
              <RotateCcw size={10} /> Restore current URL
            </button>
          )}
        </div>
        <div className="mt-2 flex items-stretch overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <span className="flex items-center border-r border-[var(--border)] bg-[var(--secondary-bg)] px-3 text-[0.6875rem] font-mono text-[var(--text-muted)]">
            {SITE_HOST}/en/product/
          </span>
          <input
            type="text"
            value={form.slug}
            onChange={(e) => updateField('slug', e.target.value)}
            placeholder="auto-generated-from-product-name"
            maxLength={200}
            aria-invalid={!slugIsValid}
            className="min-w-0 flex-1 bg-transparent px-3 py-2.5 font-mono text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
          />
          <span className="flex items-center px-3 text-[0.6875rem] font-mono text-[var(--text-muted)]">/</span>
        </div>
        {slugError ? (
          <p className="mt-1.5 text-[0.625rem] font-bold text-[var(--danger)]">{slugError}</p>
        ) : !slugIsValid ? (
          <p className="mt-1.5 text-[0.625rem] font-bold text-[var(--danger)]">
            Use lowercase letters, numbers and single hyphens, up to 200 characters (example: caterpillar-3512b).
          </p>
        ) : slugChanged ? (
          <p className="mt-1.5 text-[0.625rem] font-bold text-[var(--accent-gold)]">
            Saving changes the live URL from /{publicSlug}/ to /{slug || publicSlug}/. The old URL permanently redirects (301), so existing links and rankings transfer.
          </p>
        ) : (
          <p className="mt-1.5 text-[0.625rem] text-[var(--text-muted)]">
            {isEditing
              ? 'Renaming the product does not change this URL. Leave blank to keep it, or enter a different URL deliberately; the old one will 301.'
              : 'Leave blank to generate the slug from the product name. Choose a stable, descriptive URL before publishing.'}
          </p>
        )}
        <p className="mt-1 text-[0.5625rem] text-[var(--text-muted)]">
          Canonical tags, sitemap entries and structured data use this URL automatically.
        </p>
      </div>

      {/* ── SERP preview ────────────────────────────────────── */}
      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <label className={`${labelClass} mb-0`}>Search result preview</label>
          <button
            type="button"
            onClick={generateMetadata}
            disabled={!form.name.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--accent-teal)]/40 bg-[var(--accent-teal)]/10 px-3 py-1.5 text-[0.625rem] font-bold text-[var(--accent-teal)] transition-colors hover:bg-[var(--accent-teal)]/20 disabled:cursor-not-allowed disabled:opacity-50"
            title="Generate factual title and description from the product name, identifiers and description"
          >
            <Sparkles size={11} /> Generate title &amp; description
          </button>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <p className="truncate text-[0.625rem] font-mono text-[var(--success)]">
            https://{SITE_HOST} › en › product › {previewSlug}
          </p>
          <p className="mt-1 truncate text-[1rem] font-medium text-[#1a0dab] dark:text-[#8ab4f8]">
            {previewTitle}
          </p>
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-[var(--text-secondary)]">
            {previewDescription}
          </p>
        </div>
      </div>

      {/* ── Title / description ─────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between gap-2">
          <label className={labelClass}>SEO title</label>
          <span className={`text-[0.625rem] font-bold ${titleState.tone}`}>
            {titleLength}/60 recommended · max 70 · {titleState.label}
          </span>
        </div>
        <input
          type="text"
          value={form.seoTitle}
          onChange={(e) => updateField('seoTitle', e.target.value)}
          placeholder="Brand + model + product type"
          className={getFieldClass('seoTitle')}
        />
        <p className="mt-1 text-[0.625rem] text-[var(--text-muted)]">
          Appears before “| Alka Traders”. Keep the product identity first; stop at about 60 characters so it is not truncated.
        </p>
      </div>

      <div>
        <div className="flex items-center justify-between gap-2">
          <label className={labelClass}>Meta description</label>
          <span className={`text-[0.625rem] font-bold ${descriptionState.tone}`}>
            {descriptionLength}/160 · {descriptionState.label}
          </span>
        </div>
        <textarea
          value={form.seoDescription}
          onChange={(e) => updateField('seoDescription', e.target.value)}
          placeholder="One or two factual sentences about this exact part, its identifiers and availability."
          rows={3}
          className={`${getFieldClass('seoDescription')} resize-y`}
        />
        <p className="mt-1 text-[0.625rem] text-[var(--text-muted)]">
          80–160 characters are required to publish. Describe the part and its verified identifiers; avoid generic filler.
        </p>
      </div>

      {/* ── Social image ────────────────────────────────────── */}
      <div>
        <label className={labelClass}>Social share image (Open Graph)</label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="url"
            value={form.ogImageUrl}
            onChange={(e) => updateField('ogImageUrl', e.target.value)}
            placeholder="https://… (optional — defaults to the main product image)"
            className={`${getFieldClass('ogImageUrl')} flex-1`}
          />
          {mainImage && (
            <button
              type="button"
              onClick={() => updateField('ogImageUrl', mainImage.url)}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2 text-[0.625rem] font-bold text-[var(--text-secondary)] hover:border-[var(--accent-gold)]"
            >
              <ImageIcon size={11} /> Use main image
            </button>
          )}
        </div>
        {(form.ogImageUrl.trim() || mainImage?.url) ? (
          <div className="mt-2 flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-2">
            <img
              src={form.ogImageUrl.trim() || mainImage?.url}
              alt="Social share preview"
              className="h-14 w-20 rounded-lg object-cover"
              onError={(e) => { e.currentTarget.style.display = 'none' }}
            />
            <div className="min-w-0">
              <p className="text-[0.625rem] font-bold text-[var(--text-primary)]">Social preview</p>
              <p className="truncate text-[0.5625rem] text-[var(--text-muted)]">
                {form.ogImageUrl.trim() || 'Falls back to the main product image'}
              </p>
            </div>
          </div>
        ) : (
          <p className="mt-1 text-[0.625rem] text-[var(--text-muted)]">
            Without an override, social cards use the main product image.
          </p>
        )}
      </div>

      <div>
        <label className={labelClass}>Internal search terms</label>
        <textarea
          value={form.searchKeywords}
          onChange={(e) => updateField('searchKeywords', e.target.value)}
          placeholder="Alternate names, old part numbers, synonyms (comma-separated)"
          rows={2}
          className={`${getFieldClass('searchKeywords')} resize-y`}
        />
        <p className="mt-1 text-[0.625rem] text-[var(--text-muted)]">
          Used only by the storefront’s own search to match alternate names and part numbers. It is never rendered into the page or emitted as a meta keywords tag. Put ranking terms in the title and description instead.
        </p>
      </div>

      {/* ── Identity ────────────────────────────────────────── */}
      <h2 className="font-display text-lg font-bold text-[var(--text-primary)] pt-2">Product identity</h2>
      <p className="-mt-3 text-xs text-[var(--text-muted)]">
        Verified identifiers from manufacturer documentation. These feed Google
        (structured data + Merchant Center), so accuracy matters more than
        completeness — an empty field is always better than a guessed one.
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass}>Manufacturer</label>
          <input
            type="text"
            value={form.manufacturer}
            onChange={(e) => updateField('manufacturer', e.target.value)}
            placeholder="e.g. TERYair"
            className={getFieldClass('manufacturer')}
          />
        </div>
        <div>
          <label className={labelClass}>Model number</label>
          <input
            type="text"
            value={form.modelNumber}
            onChange={(e) => updateField('modelNumber', e.target.value)}
            placeholder="e.g. 23-24-83 PB"
            className={getFieldClass('modelNumber')}
          />
        </div>
        <div>
          <label className={labelClass}>MPN (manufacturer part number)</label>
          <input
            type="text"
            value={form.mpn}
            onChange={(e) => updateField('mpn', e.target.value)}
            placeholder={UNKNOWN_HINT}
            className={getFieldClass('mpn')}
          />
        </div>
        <div>
          <label className={labelClass}>GTIN (barcode)</label>
          <input
            type="text"
            inputMode="numeric"
            value={form.gtin}
            onChange={(e) => updateField('gtin', e.target.value.replace(/[^\d]/g, ''))}
            placeholder="8, 12, 13 or 14 digits — only from real packaging"
            className={getFieldClass('gtin')}
          />
          {form.gtin && !isValidGtin(form.gtin) && (
            <p className="mt-1 text-[0.625rem] text-[var(--danger)]">
              GTIN must be 8 or 12–14 digits. Never enter an IMPA code or internal SKU here.
            </p>
          )}
        </div>
        <div>
          <label className={labelClass}>IMPA code</label>
          <input
            type="text"
            value={form.impaCode}
            onChange={(e) => updateField('impaCode', e.target.value)}
            placeholder="e.g. 232483"
            className={getFieldClass('impaCode')}
          />
        </div>
        <div>
          <label className={labelClass}>Source URL (documentation)</label>
          <input
            type="url"
            value={form.sourceUrl}
            onChange={(e) => updateField('sourceUrl', e.target.value)}
            placeholder="Manufacturer page or datasheet URL used to verify"
            className={getFieldClass('sourceUrl')}
          />
        </div>
      </div>
    </div>
  )
}
