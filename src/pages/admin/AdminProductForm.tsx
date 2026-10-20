import { useState } from 'react'
import { Save, Eye, ExternalLink, ArrowLeft, Loader2, CheckCircle, FileText } from 'lucide-react'
import { useProductForm, TABS } from '../../hooks/useProductForm'
import { ProductPreviewModal } from '../../components/admin/ProductPreviewModal'
import { ProductFormBasics } from '../../components/admin/ProductFormBasics'
import { ProductFormImages } from '../../components/admin/ProductFormImages'
import { ProductFormPricing } from '../../components/admin/ProductFormPricing'
import { ProductFormInventory } from '../../components/admin/ProductFormInventory'
import { ProductFormSpecs } from '../../components/admin/ProductFormSpecs'
import { ProductFormDetails } from '../../components/admin/ProductFormDetails'
import { ProductFormSeo } from '../../components/admin/ProductFormSeo'
import { ProductFormNotes } from '../../components/admin/ProductFormNotes'

export default function AdminProductForm() {
  const hook = useProductForm()
  const [showPreview, setShowPreview] = useState(false)

  const isPublished = hook.form.status === 'published'
  const brandName = hook.brandList.find((brand) => brand.id === hook.form.brand)?.name || ''
  const categoryName = hook.categoryList.find((category) => category.id === hook.form.category)?.name || ''
  const saveDisabled = hook.saving || (!hook.isValid && hook.attempted)
  const saveLabel = hook.saving ? 'Saving...' : hook.saved ? 'Saved!' : isPublished ? 'Save & Publish' : 'Save as Draft'

  if (hook.loadingProduct) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 size={24} className="animate-spin text-[var(--accent-gold)]" />
        <span className="ml-3 text-sm text-[var(--text-muted)]">Loading product...</span>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => hook.navigate('/admin/products')}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            <ArrowLeft size={16} />
          </button>
          <div>
            <h1 className="font-display text-2xl font-extrabold text-[var(--text-primary)]">
              {hook.isEditing ? 'Edit Product' : 'Add Product'}
            </h1>
            <p className="text-sm text-[var(--text-muted)] mt-0.5">
              {hook.isEditing ? `Editing ${hook.form.name || hook.id}` : 'Create a new product listing'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowPreview(true)}
            className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-4 py-2.5 text-xs font-bold text-[var(--text-secondary)] no-underline hover:border-[var(--accent-blue)] hover:text-[var(--text-primary)] transition-colors"
          >
            <Eye size={14} /> Preview
          </button>
          {hook.isEditing && hook.form.status === 'published' && (
            <a
              href={`/en/product/${encodeURIComponent(hook.publicSlug)}/`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-4 py-2.5 text-xs font-bold text-[var(--text-secondary)] no-underline hover:border-[var(--accent-blue)] transition-colors"
            >
              <ExternalLink size={14} /> View Live
            </a>
          )}
          {hook.isEditing && hook.form.status !== 'published' && (
            <span
              title="Publish this product to view it on the storefront"
              className="inline-flex cursor-not-allowed items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-4 py-2.5 text-xs font-bold text-[var(--text-muted)] opacity-60"
            >
              <ExternalLink size={14} /> View Live
            </span>
          )}
          <button
            onClick={() => hook.handleSave()}
            disabled={saveDisabled}
            className={`inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-xs font-extrabold transition-all ${
              hook.saved
                ? 'bg-[var(--success)] text-[var(--btn-success-text)]'
                : !hook.isValid && hook.attempted
                  ? 'bg-[var(--text-muted)] text-[var(--btn-blue-text)] cursor-not-allowed opacity-60'
                  : 'bg-[var(--accent-gold)] text-[var(--btn-blue-text)] hover:brightness-95 hover:-translate-y-0.5'
            }`}
          >
            {hook.saving ? <Loader2 size={14} className="animate-spin" /> : hook.saved ? <CheckCircle size={14} /> : <Save size={14} />}
            {saveLabel}
          </button>
        </div>
      </div>

      {hook.publishVerification && (
        <div className={`rounded-xl border px-4 py-3 text-sm ${hook.publishVerification.ok ? 'border-[var(--success)]/30 bg-[var(--success)]/5 text-[var(--success)]' : 'border-[var(--danger)]/30 bg-[var(--danger)]/5 text-[var(--danger)]'}`} role="status">
          <p className="font-bold">{hook.publishVerification.message}</p>
          <a className="mt-1 inline-block underline" href={hook.publishVerification.url} target="_blank" rel="noreferrer">Open public page</a>
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-5">
        {/* Tab Navigation */}
        <div className="lg:w-48 shrink-0">
          <nav className="flex lg:flex-col gap-1 overflow-x-auto pb-2 lg:pb-0">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => hook.setActiveTab(tab.id)}
                className={`whitespace-nowrap rounded-xl px-4 py-2.5 text-xs font-bold transition-all ${
                  hook.activeTab === tab.id
                    ? 'bg-[var(--accent-gold)] text-[var(--btn-blue-text)] shadow-[0_4px_12px_rgba(232,170,36,0.2)]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--surface-soft)] hover:text-[var(--text-primary)]'
                }`}
              >
                {tab.label}
                {hook.tabErrors[tab.id] && (
                  <span className="ml-1.5 inline-block h-2 w-2 rounded-full bg-[var(--danger)]" />
                )}
              </button>
            ))}
          </nav>
        </div>

        {/* Tab Content — 1:1 mapping with the 8 tabs */}
        <div className="flex-1 min-w-0">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
            {hook.activeTab === 'basics' && (
              <ProductFormBasics
                form={hook.form}
                updateField={hook.updateField}
                markTouched={hook.markTouched}
                showError={hook.showError}
                getFieldClass={hook.getFieldClass}
                getSelectClass={hook.getSelectClass}
                labelClass={hook.labelClass}
                errorClass={hook.errorClass}
                errors={hook.errors}
                brandList={hook.brandList}
                categoryList={hook.categoryList}
                industryList={hook.industryList}
                toggleIndustry={hook.toggleIndustry}
              />
            )}
            {hook.activeTab === 'images' && (
              <ProductFormImages
                form={hook.form}
                updateImage={hook.updateImage}
                addImage={hook.addImage}
                removeImage={hook.removeImage}
                handleImageUpload={hook.handleImageUpload}
                uploadingImage={hook.uploadingImage}
                getFieldClass={hook.getFieldClass}
                labelClass={hook.labelClass}
                productImageInputId={hook.productImageInputId}
              />
            )}
            {hook.activeTab === 'pricing' && (
              <ProductFormPricing
                form={hook.form}
                updateField={hook.updateField}
                getFieldClass={hook.getFieldClass}
                labelClass={hook.labelClass}
              />
            )}
            {hook.activeTab === 'inventory' && (
              <ProductFormInventory
                form={hook.form}
                updateField={hook.updateField}
                getFieldClass={hook.getFieldClass}
                labelClass={hook.labelClass}
              />
            )}
            {hook.activeTab === 'specs' && (
              <ProductFormSpecs
                form={hook.form}
                addSpec={hook.addSpec}
                removeSpec={hook.removeSpec}
                updateSpec={hook.updateSpec}
                getFieldClass={hook.getFieldClass}
              />
            )}
            {hook.activeTab === 'details' && (
              <ProductFormDetails
                form={hook.form}
                updateField={hook.updateField}
                addArrayItem={hook.addArrayItem}
                removeArrayItem={hook.removeArrayItem}
                updateArrayItem={hook.updateArrayItem}
                getFieldClass={hook.getFieldClass}
                labelClass={hook.labelClass}
              />
            )}
            {hook.activeTab === 'seo' && (
              <ProductFormSeo
                form={hook.form}
                updateField={hook.updateField}
                getFieldClass={hook.getFieldClass}
                labelClass={hook.labelClass}
                isEditing={hook.isEditing}
                publicSlug={hook.publicSlug}
                slugError={hook.errors.slug}
                brandName={brandName}
                categoryName={categoryName}
              />
            )}
            {hook.activeTab === 'notes' && (
              <ProductFormNotes
                form={hook.form}
                updateField={hook.updateField}
                getFieldClass={hook.getFieldClass}
                labelClass={hook.labelClass}
              />
            )}
          </div>
        </div>
      </div>

      {/* ── Sticky final submit ──
          Kept at the bottom of the editor so the publish action is always in
          reach, even scrolled deep inside a long tab. */}
      <div className="sticky bottom-0 z-20 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 shadow-[0_-8px_24px_rgba(0,0,0,0.10)]">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className={`admin-badge ${isPublished ? 'admin-badge-published' : 'admin-badge-draft'} capitalize`}>
              {hook.form.status || 'draft'}
            </span>
            <span className="text-[var(--text-muted)]">
              {isPublished
                ? 'Saving publishes this product to the storefront immediately.'
                : 'Not visible on the storefront until published.'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => hook.handleSave('draft')}
              disabled={saveDisabled}
              className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-4 py-2.5 text-xs font-bold text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-blue)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <FileText size={14} /> Save as Draft
            </button>
            <button
              type="button"
              onClick={() => hook.handleSave('published')}
              disabled={saveDisabled}
              className={`inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-xs font-extrabold transition-all ${
                hook.saved
                  ? 'bg-[var(--success)] text-[var(--btn-success-text)]'
                  : !hook.isValid && hook.attempted
                    ? 'bg-[var(--text-muted)] text-[var(--btn-blue-text)] cursor-not-allowed opacity-60'
                    : 'bg-[var(--accent-gold)] text-[var(--btn-blue-text)] hover:brightness-95 hover:-translate-y-0.5'
              }`}
            >
              {hook.saving ? <Loader2 size={14} className="animate-spin" /> : hook.saved ? <CheckCircle size={14} /> : <Save size={14} />}
              {hook.saving ? 'Publishing...' : hook.saved ? 'Published!' : 'Publish'}
            </button>
          </div>
        </div>
      </div>

      {showPreview && (
        <ProductPreviewModal
          form={hook.form}
          brandList={hook.brandList}
          onClose={() => setShowPreview(false)}
        />
      )}
    </div>
  )
}
