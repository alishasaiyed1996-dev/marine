import { useRef } from 'react'
import { AlertCircle, Wand2 } from 'lucide-react'
import { isLightColor, buildProductSkuBase, generateProductSku } from '../../lib/utils'
import { MIN_PRODUCT_DESCRIPTION_WORDS, countWords, meetsProductDescriptionMinimum } from '../../lib/seo/productContent'
import { BrandCombobox } from './BrandCombobox'
import type { ProductFormData } from '../../hooks/useProductForm'

interface ProductFormBasicsProps {
  form: ProductFormData
  updateField: <K extends keyof ProductFormData>(field: K, value: ProductFormData[K]) => void
  markTouched: (field: string) => void
  showError: (field: string) => string | boolean
  getFieldClass: (field: string, extra?: string) => string
  getSelectClass: (field: string) => string
  labelClass: string
  errorClass: string
  errors: Record<string, string>
  brandList: { id: string; name: string }[]
  categoryList: { id: string; name: string; parentId?: string | null }[]
  industryList: { id: string; name: string }[]
  toggleIndustry: (id: string) => void
}

export function ProductFormBasics({
  form, updateField, markTouched, showError,
  getFieldClass, getSelectClass, labelClass, errorClass, errors,
  brandList, categoryList, industryList, toggleIndustry,
}: ProductFormBasicsProps) {
  const skuInputRef = useRef<HTMLInputElement>(null)

  const useGeneratedSku = () => {
    updateField('sku', generateProductSku(form.name))
    // Focus the SKU input so the admin can immediately edit the generated value.
    skuInputRef.current?.focus()
  }

  const descriptionLength = form.description.trim().length
  const descriptionWords = countWords(form.description)

  return (
    <div className="space-y-5">
      <h2 className="font-display text-lg font-bold text-[var(--text-primary)]">Basic Information</h2>

      <div>
        <label className={labelClass}>Product Name *</label>
        <input
          type="text"
          value={form.name}
          onChange={(e) => updateField('name', e.target.value)}
          onBlur={() => markTouched('name')}
          placeholder="e.g. Hydraulic Pump HP-200"
          className={getFieldClass('name')}
        />
        {showError('name') && <p className={errorClass}><AlertCircle size={10} />{errors.name}</p>}

        {/* Live auto-SKU preview — updates as the name is typed. Only shown
            while SKU is empty; the 7-char unique suffix is added on save. */}
        {!form.sku.trim() && form.name.trim() && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span
              className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-[var(--accent-teal)]/50 bg-[var(--teal-soft)] px-2.5 py-1 font-mono text-[11px] font-bold text-[var(--accent-teal)]"
              title="A unique 7-character suffix is added automatically on save"
            >
              <Wand2 size={11} />
              Auto SKU: {buildProductSkuBase(form.name)}-XXXXXXX
            </span>
            <button
              type="button"
              onClick={useGeneratedSku}
              className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-2.5 py-1 text-[11px] font-bold text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-teal)] hover:text-[var(--accent-teal)]"
              title="Fill the SKU field with this generated value so you can edit it"
            >
              Use & edit
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>SKU <span className="normal-case font-semibold text-[var(--text-muted)]">(auto-generated if empty)</span></label>
          <input
            ref={skuInputRef}
            type="text"
            value={form.sku}
            onChange={(e) => updateField('sku', e.target.value)}
            onBlur={() => markTouched('sku')}
            placeholder="e.g. HP-200-MS"
            className={`${getFieldClass('sku')} font-mono`}
          />
          {showError('sku') && <p className={errorClass}><AlertCircle size={10} />{errors.sku}</p>}
        </div>
        <div>
          <label className={labelClass}>Brand <span className="normal-case font-semibold text-[var(--text-muted)]">(optional)</span></label>
          <BrandCombobox
            value={form.brand}
            brands={brandList}
            onChange={(value) => updateField('brand', value)}
            onBlur={() => markTouched('brand')}
            error={showError('brand') ? errors.brand : undefined}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className={labelClass}>Category <span className="normal-case font-semibold text-[var(--text-muted)]">(required to publish)</span></label>
          <select
            value={form.category}
            onChange={(e) => updateField('category', e.target.value)}
            onBlur={() => markTouched('category')}
            className={getSelectClass('category')}
          >
            <option value="">Select category</option>
            {categoryList.map((cat) => (
              <option key={cat.id} value={cat.id}>{cat.parentId ? `— ${cat.name}` : cat.name}</option>
            ))}
          </select>
          {showError('category') && <p className={errorClass}><AlertCircle size={10} />{errors.category}</p>}
        </div>
        <div>
          <label className={labelClass}>Condition</label>
          <select
            value={form.condition}
            onChange={(e) => updateField('condition', e.target.value)}
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-4 py-2.5 text-sm text-[var(--text-primary)] focus:border-[var(--accent-gold)]"
          >
            <option value="new">New</option>
            <option value="unused">Unused / New Old Stock</option>
            <option value="used">Used</option>
            <option value="refurbished">Refurbished</option>
            <option value="reconditioned">Reconditioned</option>
          </select>
        </div>
        <div>
          <label className={labelClass}>Visibility</label>
          <select
            value={form.status}
            onChange={(e) => updateField('status', e.target.value)}
            className={getSelectClass('status')}
            aria-label="Product visibility"
          >
            <option value="published">Published (live on storefront)</option>
            <option value="draft">Draft (not visible)</option>
            <option value="hidden">Hidden (unlisted)</option>
            <option value="archived">Archived</option>
          </select>
          {form.status === 'draft' && (
            <p className="mt-1 text-[0.625rem] font-semibold text-[var(--accent-gold)]">
              Draft products do not appear on the storefront until published.
            </p>
          )}
        </div>
      </div>

      <div>
        <label className={labelClass}>Industries</label>
        <div className="flex flex-wrap gap-2">
          {industryList.map((ind) => (
            <button
              key={ind.id}
              onClick={() => toggleIndustry(ind.id)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition-all ${
                form.industries.includes(ind.id)
                  ? 'border-[var(--accent-teal)] bg-[var(--accent-teal)]/10 text-[var(--accent-teal)]'
                  : 'border-[var(--border)] bg-[var(--surface-soft)] text-[var(--text-secondary)] hover:border-[var(--accent-teal)]'
              }`}
            >
              {ind.name}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className={labelClass}>Short Description</label>
        <input
          type="text"
          value={form.shortDescription}
          onChange={(e) => updateField('shortDescription', e.target.value)}
          placeholder="Brief description for cards and search previews"
          className={getFieldClass('shortDescription')}
        />
      </div>

      <div>
        <label className={labelClass}>Full Description</label>
        <textarea
          value={form.description}
          onChange={(e) => updateField('description', e.target.value)}
          onBlur={() => markTouched('description')}
          placeholder="Detailed product description (at least 50 words or about 300 characters to publish)..."
          rows={5}
          className={`${getFieldClass('description')} resize-y`}
        />
        <div className="mt-1 flex items-center justify-between gap-2">
          <p className="text-[0.625rem] text-[var(--text-muted)]">Write product-specific copy; 50 words (about 300 characters) are needed to publish.</p>
          <span className={`shrink-0 text-[0.625rem] font-bold ${meetsProductDescriptionMinimum(form.description) ? 'text-[var(--success)]' : 'text-[var(--accent-gold)]'}`}>
            {descriptionLength} chars · {descriptionWords}/{MIN_PRODUCT_DESCRIPTION_WORDS} words
          </span>
        </div>
        {showError('description') && <p className={errorClass}><AlertCircle size={10} />{errors.description}</p>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={form.isNewArrival}
            onChange={(e) => updateField('isNewArrival', e.target.checked)}
            className="h-4 w-4 rounded border-[var(--border)] accent-[var(--accent-gold)]"
          />
          <span className="text-xs font-bold text-[var(--text-secondary)]">New Arrival</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={form.isFeatured}
            onChange={(e) => updateField('isFeatured', e.target.checked)}
            className="h-4 w-4 rounded border-[var(--border)] accent-[var(--accent-gold)]"
          />
          <span className="text-xs font-bold text-[var(--text-secondary)]">Featured Product</span>
        </label>
        <div className="sm:col-span-2">
          <label className={labelClass}>Custom Label</label>
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <input
                type="text"
                value={form.customLabel}
                onChange={(e) => updateField('customLabel', e.target.value)}
                placeholder="e.g. SALE, NEW"
                className={getFieldClass('customLabel')}
              />
            </div>
            {form.customLabel && (
              <div className="flex items-center gap-2">
                <div
                  className="h-9 w-9 shrink-0 rounded-lg border-2 border-[var(--border)] cursor-pointer overflow-hidden relative"
                  title={`Label color: ${form.customLabelColor}`}
                >
                  <input
                    type="color"
                    value={form.customLabelColor}
                    onChange={(e) => updateField('customLabelColor', e.target.value)}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                  <div className="w-full h-full" style={{ backgroundColor: form.customLabelColor }} />
                </div>
                <span
                  className="inline-flex items-center rounded-md px-2.5 py-1 text-[0.625rem] font-extrabold shrink-0"
                  style={{
                    backgroundColor: form.customLabelColor,
                    color: isLightColor(form.customLabelColor) ? '#1a1a1a' : '#ffffff',
                  }}
                >
                  {form.customLabel}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
