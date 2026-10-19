import { Plus, Trash2, CheckCircle, AlertCircle, Info } from 'lucide-react'
import type { ProductFormData } from '../../hooks/useProductForm'

interface ProductFormDetailsProps {
  form: ProductFormData
  updateField: <K extends keyof ProductFormData>(field: K, value: ProductFormData[K]) => void
  addArrayItem: (field: 'keyFeatures' | 'includedItems' | 'excludedItems') => void
  removeArrayItem: (field: 'keyFeatures' | 'includedItems' | 'excludedItems', i: number) => void
  updateArrayItem: (field: 'keyFeatures' | 'includedItems' | 'excludedItems', i: number, value: string) => void
  getFieldClass: (field: string, extra?: string) => string
  labelClass: string
}

export function ProductFormDetails({
  form, updateField,
  addArrayItem, removeArrayItem, updateArrayItem,
  getFieldClass, labelClass,
}: ProductFormDetailsProps) {
  return (
    <div className="space-y-6">
      <h2 className="font-display text-lg font-bold text-[var(--text-primary)]">Product Details</h2>

      <label className="flex items-start gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-3 text-sm text-[var(--text-secondary)]">
        <input type="checkbox" checked={form.allowDuplicateDescription} onChange={(event) => updateField('allowDuplicateDescription', event.target.checked)} />
        <span>Allow an exact duplicate description for a legitimate product variant. Use only when the model/size details distinguish this part.</span>
      </label>

      {/* Key Features */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <label className={labelClass}>Key Features</label>
          <button onClick={() => addArrayItem('keyFeatures')} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-1.5 text-xs font-bold text-[var(--text-secondary)] hover:border-[var(--accent-gold)] transition-colors">
            <Plus size={12} /> Add Feature
          </button>
        </div>
        {form.keyFeatures.map((feat, i) => (
          <div key={i} className="flex items-center gap-2 mb-2">
            <span className="text-xs font-bold text-[var(--text-muted)] w-6 shrink-0">{i + 1}.</span>
            <input type="text" value={feat} onChange={(e) => updateArrayItem('keyFeatures', i, e.target.value)} placeholder="e.g. Heavy-duty construction" className={`${getFieldClass('')} flex-1`} />
            {form.keyFeatures.length > 1 && (
              <button onClick={() => removeArrayItem('keyFeatures', i)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-danger/5 transition-colors">
                <Trash2 size={14} />
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Condition Notes */}
      <div>
        <label className={labelClass}>Condition Notes</label>
        <textarea
          value={form.conditionNotes}
          onChange={(e) => updateField('conditionNotes', e.target.value)}
          placeholder="Notes about the item's condition (e.g. minor scratches on housing, fully tested and functional)"
          rows={3}
          className={`${getFieldClass('conditionNotes')} resize-y`}
        />
      </div>

      {/* Compatibility Notes */}
      <div>
        <label className={labelClass}>Compatibility Notes</label>
        <textarea
          value={form.compatibilityNotes}
          onChange={(e) => updateField('compatibilityNotes', e.target.value)}
          placeholder="Compatible engines, vessels, systems, OEM part numbers, replacements..."
          rows={3}
          className={`${getFieldClass('compatibilityNotes')} resize-y`}
        />
      </div>

      {/* Warranty Notes */}
      <div>
        <label className={labelClass}>Warranty / Guarantee Notes</label>
        <textarea
          value={form.warrantyNotes}
          onChange={(e) => updateField('warrantyNotes', e.target.value)}
          placeholder="e.g. 30-day functional warranty, sold as-is, etc."
          rows={2}
          className={`${getFieldClass('warrantyNotes')} resize-y`}
        />
      </div>

      {/* Included Items */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <label className={labelClass}>Included Items</label>
          <button onClick={() => addArrayItem('includedItems')} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-1.5 text-xs font-bold text-[var(--text-secondary)] hover:border-[var(--accent-gold)] transition-colors">
            <Plus size={12} /> Add Item
          </button>
        </div>
        {form.includedItems.map((item, i) => (
          <div key={i} className="flex items-center gap-2 mb-2">
            <CheckCircle size={14} className="text-[var(--success)] shrink-0" />
            <input type="text" value={item} onChange={(e) => updateArrayItem('includedItems', i, e.target.value)} placeholder="e.g. Mounting brackets, User manual" className={`${getFieldClass('')} flex-1`} />
            {form.includedItems.length > 1 && (
              <button onClick={() => removeArrayItem('includedItems', i)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-danger/5 transition-colors">
                <Trash2 size={14} />
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Excluded Items */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <label className={labelClass}>Excluded Items</label>
          <button onClick={() => addArrayItem('excludedItems')} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-1.5 text-xs font-bold text-[var(--text-secondary)] hover:border-[var(--accent-gold)] transition-colors">
            <Plus size={12} /> Add Item
          </button>
        </div>
        {form.excludedItems.map((item, i) => (
          <div key={i} className="flex items-center gap-2 mb-2">
            <AlertCircle size={14} className="text-[var(--danger)] shrink-0" />
            <input type="text" value={item} onChange={(e) => updateArrayItem('excludedItems', i, e.target.value)} placeholder="e.g. Power cable, Installation tools" className={`${getFieldClass('')} flex-1`} />
            {form.excludedItems.length > 1 && (
              <button onClick={() => removeArrayItem('excludedItems', i)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-danger/5 transition-colors">
                <Trash2 size={14} />
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="rounded-xl bg-[var(--surface-soft)] border border-[var(--border)] p-4">
        <p className="text-xs text-[var(--text-muted)] flex items-center gap-2">
          <Info size={14} />
          These details appear on the product detail page to give buyers full information about the item.
        </p>
      </div>
    </div>
  )
}
