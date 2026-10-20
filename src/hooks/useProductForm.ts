import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { admin } from '../lib/api'
import { useToast } from '../components/admin/toast-context'
import { toLocalInputValue, fromLocalInputValue, isSaleWindowValid, generateProductSku } from '../lib/utils'
import type { ApiProduct, ApiBrand, ApiCategory, ApiIndustry } from '../lib/api-types'

export interface SpecRow {
  name: string
  value: string
}

export interface ProductFormData {
  name: string
  sku: string
  brand: string
  category: string
  industries: string[]
  status: string
  condition: string
  availability: string
  shortDescription: string
  description: string
  allowDuplicateDescription: boolean
  images: { url: string; alt: string; label: string }[]
  regularPrice: string
  salePrice: string
  saleStartsAt: string
  saleEndsAt: string
  makeOfferEnabled: boolean
  minimumOfferPrice: string
  currency: string
  stockCount: string
  lowStockThreshold: string
  warehouseLocation: string
  leadTime: string
  specs: SpecRow[]
  keyFeatures: string[]
  compatibilityNotes: string
  warrantyNotes: string
  conditionNotes: string
  includedItems: string[]
  excludedItems: string[]
  seoTitle: string
  seoDescription: string
  searchKeywords: string
  // Verified product identity — empty string means unknown (stored as NULL).
  manufacturer: string
  modelNumber: string
  mpn: string
  gtin: string
  impaCode: string
  sourceUrl: string
  internalNotes: string
  isNewArrival: boolean
  isFeatured: boolean
  customLabel: string
  customLabelColor: string
}

export type TabId = 'basics' | 'images' | 'pricing' | 'inventory' | 'specs' | 'details' | 'seo' | 'notes'

export const TABS: { id: TabId; label: string }[] = [
  { id: 'basics', label: 'Basics' },
  { id: 'images', label: 'Images' },
  { id: 'pricing', label: 'Pricing' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'specs', label: 'Specifications' },
  { id: 'details', label: 'Details' },
  { id: 'seo', label: 'SEO' },
  { id: 'notes', label: 'Admin Notes' },
]

function getEmptyForm(): ProductFormData {
  return {
    name: '',
    sku: '',
    brand: '',
    category: '',
    industries: [],
    status: 'published',
    condition: 'used',
    availability: 'in-stock',
    shortDescription: '',
    description: '',
    allowDuplicateDescription: false,
    images: [{ url: '', alt: '', label: 'Main' }],
    regularPrice: '',
    salePrice: '',
    saleStartsAt: '',
    saleEndsAt: '',
    makeOfferEnabled: true,
    minimumOfferPrice: '',
    currency: 'USD',
    stockCount: '1',
    lowStockThreshold: '10',
    warehouseLocation: '',
    leadTime: '',
    specs: [{ name: '', value: '' }],
    keyFeatures: [''],
    compatibilityNotes: '',
    warrantyNotes: '',
    conditionNotes: '',
    includedItems: [''],
    excludedItems: [''],
    seoTitle: '',
    seoDescription: '',
    searchKeywords: '',
    manufacturer: '',
    modelNumber: '',
    mpn: '',
    gtin: '',
    impaCode: '',
    sourceUrl: '',
    internalNotes: '',
    isNewArrival: false,
    isFeatured: false,
    customLabel: '',
    customLabelColor: '#159a67',
  }
}

function getFormFromProduct(product: ApiProduct): ProductFormData {
  return {
    name: product.name || '',
    sku: product.sku || '',
    brand: product.brandId || (typeof product.brand === 'object' ? product.brand?.id || '' : product.brand || ''),
    category: product.categoryId || (typeof product.category === 'object' ? product.category?.id || '' : product.category || ''),
    industries: Array.isArray(product.industries)
      ? product.industries.map((i) => typeof i === 'object' ? (i.industry?.id || '') : i)
      : (Array.isArray(product.industryIds) ? product.industryIds : []),
    status: product.status || 'draft',
    condition: product.condition || 'used',
    availability: product.availability || 'in-stock',
    shortDescription: product.shortDescription || product.description?.split('—')[0]?.trim() || '',
    description: product.description || '',
    allowDuplicateDescription: false,
    images: Array.isArray(product.images) && product.images.length > 0
      ? product.images.map((img) => ({
          url: img.url || '',
          alt: img.altText || img.alt || '',
          label: img.label || '',
        }))
      : [{ url: '', alt: '', label: 'Main' }],
    regularPrice: (product.regularPrice ?? product.price ?? '').toString(),
    salePrice: product.salePrice?.toString() || '',
    saleStartsAt: toLocalInputValue(product.saleStartsAt),
    saleEndsAt: toLocalInputValue(product.saleEndsAt),
    makeOfferEnabled: product.makeOfferEnabled ?? product.makeOffer ?? false,
    minimumOfferPrice: product.minimumOfferPrice ? String(product.minimumOfferPrice) : '',
    currency: product.currency || 'USD',
    stockCount: (product.stockCount ?? 0).toString(),
    lowStockThreshold: (product.lowStockThreshold ?? 10).toString(),
    warehouseLocation: product.warehouseLocation || '',
    leadTime: product.leadTime || '',
    specs: Array.isArray(product.specs)
      ? product.specs.map((s) => ({ name: s.name || '', value: String(s.value || '') }))
      : (product.specs && typeof product.specs === 'object'
          ? Object.entries(product.specs).map(([name, value]) => ({ name, value: String(value) }))
          : []),
    keyFeatures: Array.isArray(product.keyFeatures) && product.keyFeatures.length > 0 ? product.keyFeatures : [''],
    compatibilityNotes: product.compatibilityNotes || '',
    warrantyNotes: product.warrantyNotes || '',
    conditionNotes: product.conditionNotes || '',
    includedItems: Array.isArray(product.includedItems) && product.includedItems.length > 0 ? product.includedItems : [''],
    excludedItems: Array.isArray(product.excludedItems) && product.excludedItems.length > 0 ? product.excludedItems : [''],
    seoTitle: product.seoTitle || product.name || '',
    seoDescription: product.seoDescription || product.description?.slice(0, 160) || '',
    searchKeywords: (Array.isArray(product.seoKeywords) ? product.seoKeywords.join(', ') : (product.seoKeywords || product.searchKeywords || '')) as string,
    manufacturer: product.manufacturer || '',
    modelNumber: product.modelNumber || '',
    mpn: product.mpn || '',
    gtin: product.gtin || '',
    impaCode: product.impaCode || '',
    sourceUrl: product.sourceUrl || '',
    internalNotes: product.internalNotes || '',
    isNewArrival: product.isNewArrival ?? false,
    isFeatured: product.isFeatured ?? false,
    customLabel: product.customLabel || '',
    customLabelColor: product.customLabelColor || '#159a67',
  }
}

export function useProductForm() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const isEditing = !!id && id !== 'new'
  const { toast } = useToast()

  const [activeTab, setActiveTab] = useState<TabId>('basics')
  const [form, setForm] = useState<ProductFormData>(getEmptyForm())
  const [loadingProduct, setLoadingProduct] = useState(isEditing)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [publicSlug, setPublicSlug] = useState('')
  const [publishVerification, setPublishVerification] = useState<{ url: string; ok: boolean; message: string } | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [attempted, setAttempted] = useState(false)
  const isDirtyRef = useRef(false)
  const hasMountedFormRef = useRef(false)
  const suppressNextDirtyRef = useRef(false)

  const [brandList, setBrandList] = useState<{ id: string; name: string }[]>([])
  const [categoryList, setCategoryList] = useState<{ id: string; name: string }[]>([])
  const [industryList, setIndustryList] = useState<{ id: string; name: string }[]>([])
  const [uploadingImage, setUploadingImage] = useState(false)
  const pendingUploadsRef = useRef(0)
  const productImageInputId = 'product-image-upload'

  // ── Effects ──

  useEffect(() => {
    let cancelled = false
    Promise.allSettled([
      admin.brands.list(),
      admin.categories.list(),
      admin.industries.list(),
    ]).then(([brandsRes, catsRes, indsRes]) => {
      if (cancelled) return
      if (brandsRes.status === 'fulfilled') {
        const val = brandsRes.value as { brands?: ApiBrand[] }
        setBrandList((val?.brands || []).map((x) => ({ id: x.id, name: x.name })))
      }
      if (catsRes.status === 'fulfilled') {
        const val = catsRes.value as { categories?: ApiCategory[] }
        setCategoryList((val?.categories || []).map((x) => ({ id: x.id || x.slug, name: x.name })))
      }
      if (indsRes.status === 'fulfilled') {
        const val = indsRes.value as { industries?: ApiIndustry[] }
        setIndustryList((val?.industries || []).map((x) => ({ id: x.id, name: x.name })))
      }
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!isEditing || !id) return
    let cancelled = false
    setLoadingProduct(true)
    admin.products.get(id)
      .then((res) => {
        if (!cancelled && res.product) {
          suppressNextDirtyRef.current = true
          setForm(getFormFromProduct(res.product))
          setPublicSlug(res.product.slug)
        }
      })
      .catch((err) => {
        console.error('Failed to load product:', err)
      })
      .finally(() => {
        if (!cancelled) setLoadingProduct(false)
      })
    return () => { cancelled = true }
  }, [id, isEditing])

  const formJson = JSON.stringify(form)
  useEffect(() => {
    if (!hasMountedFormRef.current) {
      hasMountedFormRef.current = true
      return
    }
    if (suppressNextDirtyRef.current) {
      suppressNextDirtyRef.current = false
      isDirtyRef.current = false
      return
    }
    isDirtyRef.current = true
  }, [formJson])

  // The publish-time category error should clear itself as soon as a category
  // is picked, without requiring another save attempt.
  useEffect(() => {
    if (form.category && errors.category) {
      setErrors((prev) => {
        const next = { ...prev }
        delete next.category
        return next
      })
    }
  }, [form.category, errors.category])

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirtyRef.current) {
        e.preventDefault()
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  // ── Helpers ──

  const tabErrors: Record<TabId, boolean> = {
    // No mandatory fields — admins can save partial drafts.
    basics: false,
    images: false,
    pricing: !!(form.salePrice && form.regularPrice && Number(form.salePrice) >= Number(form.regularPrice))
      || !!(form.salePrice && !isSaleWindowValid(form.saleStartsAt, form.saleEndsAt))
      || !!(form.makeOfferEnabled && form.minimumOfferPrice && Number(form.minimumOfferPrice) <= 0),
    inventory: false,
    specs: false,
    details: false,
    seo: !!(form.gtin && !/^(\d{8}|\d{12,14})$/.test(form.gtin)),
    notes: false,
  }

  const updateField = useCallback(<K extends keyof ProductFormData>(field: K, value: ProductFormData[K]) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }, [])

  const addSpec = useCallback(() => updateField('specs', [...form.specs, { name: '', value: '' }]), [form.specs, updateField])
  const removeSpec = useCallback((i: number) => updateField('specs', form.specs.filter((_, idx) => idx !== i)), [form.specs, updateField])
  const updateSpec = useCallback((i: number, field: keyof SpecRow, value: string) => {
    const specs = [...form.specs]
    specs[i] = { ...specs[i], [field]: value }
    updateField('specs', specs)
  }, [form.specs, updateField])

  type ArrayField = 'keyFeatures' | 'includedItems' | 'excludedItems'

  const addArrayItem = useCallback((field: ArrayField) => {
    updateField(field, [...form[field], ''] as string[])
  }, [form, updateField])

  const removeArrayItem = useCallback((field: ArrayField, i: number) => {
    updateField(field, form[field].filter((_: string, idx: number) => idx !== i) as string[])
  }, [form, updateField])

  const updateArrayItem = useCallback((field: ArrayField, i: number, value: string) => {
    const arr = [...form[field]]
    arr[i] = value
    updateField(field, arr as string[])
  }, [form, updateField])

  const addImage = useCallback(() => updateField('images', [...form.images, { url: '', alt: '', label: '' }]), [form.images, updateField])
  const removeImage = useCallback((i: number) => updateField('images', form.images.filter((_, idx) => idx !== i)), [form.images, updateField])
  const updateImage = useCallback((i: number, field: string, value: string) => {
    const images = [...form.images]
    images[i] = { ...images[i], [field]: value }
    updateField('images', images)
  }, [form.images, updateField])

  const toggleIndustry = useCallback((industryId: string) => {
    updateField(
      'industries',
      form.industries.includes(industryId)
        ? form.industries.filter((i) => i !== industryId)
        : [...form.industries, industryId]
    )
  }, [form.industries, updateField])

  const validate = useCallback((forStatus?: string): Record<string, string> => {
    const e: Record<string, string> = {}
    // Pricing rules only fire when the fields are actually filled in.
    // No required-field blocks — admins can save partial drafts.
    if (form.salePrice && form.regularPrice && Number(form.salePrice) >= Number(form.regularPrice)) {
      e.salePrice = 'Sale price must be lower than regular price'
    }
    if (form.salePrice && !isSaleWindowValid(form.saleStartsAt, form.saleEndsAt)) {
      e.saleEndsAt = 'Sale end date must be after the start date'
    }
    if (form.makeOfferEnabled && form.minimumOfferPrice && Number(form.minimumOfferPrice) <= 0) {
      e.minimumOfferPrice = 'Minimum offer price must be greater than 0'
    }
    // Identity truth rule: a GTIN must be a real GS1 barcode or left empty —
    // IMPA codes and internal SKUs are the classic wrong values here.
    if (form.gtin && !/^(\d{8}|\d{12,14})$/.test(form.gtin)) {
      e.gtin = 'GTIN must be 8 or 12–14 digits (leave blank if unknown)'
    }
    // Published products must belong to a category: storefront category
    // browsing and filters count by categoryId, so an uncategorized product
    // never appears under any category. Drafts/partials stay unrestricted.
    const statusForValidation = forStatus || form.status
    if (statusForValidation === 'published') {
      if (!form.name.trim()) e.name = 'Add a product name before publishing.'
      if (!form.sku.trim()) e.sku = 'Add a unique SKU or part number before publishing.'
      if (!form.category) e.category = 'Select a category before publishing.'
      if (form.description.trim().length < 120) e.description = 'Write at least 120 characters of product-specific description.'
      if (!form.seoTitle.trim() || form.seoTitle.trim().length > 70) e.seoTitle = 'Add an SEO title between 1 and 70 characters.'
      if (form.seoDescription.trim().length < 80 || form.seoDescription.trim().length > 160) e.seoDescription = 'Add an SEO description between 80 and 160 characters.'
      if (![form.modelNumber, form.mpn, form.impaCode].some((value) => value.trim())) e.mpn = 'Add a verified model number, manufacturer part number, or IMPA code.'
      const images = form.images.filter((image) => image.url.trim())
      if (!images.length) e.images = 'Add at least one product image before publishing.'
      else if (!images[0].alt.trim()) e.images = 'Add descriptive alt text to the main product image.'
    }
    return e
  }, [form.salePrice, form.regularPrice, form.saleStartsAt, form.saleEndsAt, form.makeOfferEnabled, form.minimumOfferPrice, form.category, form.status, form.gtin, form.name, form.sku, form.description, form.seoTitle, form.seoDescription, form.modelNumber, form.mpn, form.impaCode, form.images])

  const isValid = Object.keys(validate()).length === 0

  const markTouched = useCallback((field: string) => setTouched((prev) => ({ ...prev, [field]: true })), [])
  const showError = useCallback((field: string) => (attempted || touched[field]) && errors[field], [attempted, touched, errors])

  const inputBaseClass = 'w-full rounded-xl border bg-[var(--surface-soft)] px-4 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] transition-all'

  const getFieldClass = useCallback((field: string, extra = '') => {
    const hasError = showError(field)
    return `${inputBaseClass} ${extra} ${
      hasError
        ? 'border-[var(--danger)] focus:border-[var(--danger)] focus:shadow-[0_0_0_3px_rgba(220,38,38,0.1)]'
        : 'border-[var(--border)] focus:border-[var(--accent-gold)]'
    }`
  }, [showError])

  const getSelectClass = useCallback((field: string) => {
    const hasError = showError(field)
    return `w-full rounded-xl border bg-[var(--surface-soft)] px-4 py-2.5 text-sm text-[var(--text-primary)] ${
      hasError
        ? 'border-[var(--danger)] focus:border-[var(--danger)]'
        : 'border-[var(--border)] focus:border-[var(--accent-gold)]'
    }`
  }, [showError])

  const labelClass = 'mb-1.5 block text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--text-muted)]'
  const errorClass = 'mt-1 text-[0.625rem] font-bold text-[var(--danger)] flex items-center gap-1'

  // ── Image upload ──

  const handleImageUpload = useCallback(async (file: File) => {
    pendingUploadsRef.current += 1
    setUploadingImage(true)
    try {
      const { asset } = await admin.media.upload(file)
      const alt = file.name.replace(/\.[^.]+$/, '')
      // Functional update: multi-file uploads run concurrently, so using the
      // captured `form.images` here would discard every earlier upload.
      setForm((prev) => {
        const images = [...prev.images]
        const emptyIdx = images.findIndex((img) => !img.url)
        if (emptyIdx >= 0) {
          images[emptyIdx] = { ...images[emptyIdx], url: asset.url, alt: images[emptyIdx].alt || alt }
        } else {
          images.push({ url: asset.url, alt, label: images.length === 0 ? 'Main' : '' })
        }
        return { ...prev, images }
      })
      toast('Image uploaded', 'success')
    } catch (err: any) {
      toast(err.message || 'Upload failed', 'error')
    } finally {
      pendingUploadsRef.current = Math.max(0, pendingUploadsRef.current - 1)
      if (pendingUploadsRef.current === 0) setUploadingImage(false)
    }
  }, [toast])

  // ── Helpers ──

  /** Check if a string is a UUID (existing brand) vs plain text (new brand) */
  function isUuid(str: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str)
  }

  // ── Save ──

  // `statusOverride` lets the sticky action bar publish/save-as-draft in one
  // click without waiting for the Visibility dropdown state to settle.
  const handleSave = useCallback(async (statusOverride?: string) => {
    // Validate against the status this save will actually store — the sticky
    // bar can publish in one click without waiting for the Visibility dropdown.
    const validationErrors = validate(statusOverride || form.status)
    setErrors(validationErrors)
    setAttempted(true)
    if (Object.keys(validationErrors).length > 0) {
      const firstField = Object.keys(validationErrors)[0]
      setActiveTab(firstField === 'images' ? 'images' : firstField === 'description' ? 'details' : ['seoTitle', 'seoDescription', 'mpn'].includes(firstField) ? 'seo' : 'basics')
      return
    }

    const finalStatus = statusOverride || form.status

    setSaving(true)
    try {
      // Auto-generate a SKU from the product name when left blank, so the
      // backend's non-empty SKU constraint never blocks an otherwise valid save.
      const finalSku = form.sku.trim() || generateProductSku(form.name)
      if (!form.sku.trim()) {
        updateField('sku', finalSku)
      }

      // Auto-create brand if it's a new name (not a UUID)
      // Non-blocking: if brand creation fails, save the product without a brand
      // so the admin isn't stuck losing all their work.
      let brandId = form.brand
      if (brandId && !isUuid(brandId)) {
        try {
          const res = await admin.brands.create({ name: brandId })
          brandId = res.brand.id
          setBrandList((prev) => { const exists = prev.find(b => b.id === brandId); return exists ? prev : [...prev, { id: brandId, name: form.brand }] })
          updateField('brand', brandId)
        } catch (err: unknown) {
          const msg = (err as { message?: string }).message || 'Failed to create brand'
          toast(`${msg} — saving product without brand`, 'error')
          brandId = null
        }
      }

      const payload: Partial<ApiProduct> & { allowDuplicateDescription?: boolean } = {
        name: form.name,
        sku: finalSku,
        brandId: brandId || null,
        categoryId: form.category || null,
        industryIds: form.industries,
        status: finalStatus,
        condition: form.condition,
        availability: form.availability,
        shortDescription: form.shortDescription,
        description: form.description,
        allowDuplicateDescription: form.allowDuplicateDescription,
        images: form.images.filter((img) => img.url).map((img, i) => ({
          url: img.url,
          altText: img.alt,
          label: img.label,
          isMain: i === 0,
          id: `img-${Date.now()}-${i}`,
          sortOrder: i,
        })),
        regularPrice: Number(form.regularPrice) || 0,
        salePrice: form.salePrice ? Number(form.salePrice) : null,
        saleStartsAt: form.salePrice ? fromLocalInputValue(form.saleStartsAt) : null,
        saleEndsAt: form.salePrice ? fromLocalInputValue(form.saleEndsAt) : null,
        makeOfferEnabled: form.makeOfferEnabled,
        minimumOfferPrice: form.makeOfferEnabled && form.minimumOfferPrice ? Number(form.minimumOfferPrice) : null,
        currency: form.currency,
        stockCount: Number(form.stockCount) || 0,
        // 0 is a valid threshold (alert on the last unit); only blank/invalid
        // input falls back to the default.
        lowStockThreshold: form.lowStockThreshold.trim() !== '' && Number.isFinite(Number(form.lowStockThreshold))
          ? Math.max(0, Math.floor(Number(form.lowStockThreshold)))
          : 10,
        warehouseLocation: form.warehouseLocation,
        leadTime: form.leadTime,
        specs: form.specs.filter((s) => s.name.trim()),
        seoTitle: form.seoTitle,
        seoDescription: form.seoDescription,
        keyFeatures: form.keyFeatures.filter((f: string) => f.trim()),
        compatibilityNotes: form.compatibilityNotes,
        warrantyNotes: form.warrantyNotes,
        conditionNotes: form.conditionNotes,
        includedItems: form.includedItems.filter((i: string) => i.trim()),
        excludedItems: form.excludedItems.filter((i: string) => i.trim()),
        seoKeywords: form.searchKeywords ? form.searchKeywords.split(',').map(s => s.trim()).filter(Boolean) : [],
        // Identity fields: empty → null so unknown stays unknown in the DB
        // (never guessed, never fabricated for the Merchant feed or schema).
        manufacturer: form.manufacturer.trim() || null,
        modelNumber: form.modelNumber.trim() || null,
        mpn: form.mpn.trim() || null,
        gtin: form.gtin.replace(/\s+/g, '') || null,
        impaCode: form.impaCode.trim() || null,
        sourceUrl: form.sourceUrl.trim() || null,
        showPrice: (Number(form.regularPrice) || 0) > 0,
        internalNotes: form.internalNotes,
        isNewArrival: form.isNewArrival,
        isFeatured: form.isFeatured,
        customLabel: form.customLabel || null,
        customLabelColor: form.customLabel ? form.customLabelColor : null,
      }

      const response = isEditing && id
        ? await admin.products.update(id, payload)
        : await admin.products.create(payload)
      const product = response.product
      setPublicSlug(product.slug)

      if (finalStatus === 'published') {
        const liveUrl = `/en/product/${encodeURIComponent(product.slug || '')}/`
        let verified = false
        let reason = 'Public product page did not return a valid product document.'
        for (let attempt = 0; attempt < 3 && !verified; attempt += 1) {
          if (attempt) await new Promise((resolve) => setTimeout(resolve, 700))
          try {
            const pageResponse = await fetch(liveUrl, { cache: 'no-store', headers: { accept: 'text/html' } })
            const html = await pageResponse.text()
            const doc = new DOMParser().parseFromString(html, 'text/html')
            const canonical = doc.querySelector('link[rel="canonical"]')?.getAttribute('href')
            const schema = Array.from(doc.querySelectorAll('script[type="application/ld+json"]')).some((script) => {
              try { return JSON.parse(script.textContent || '{}')?.['@type'] === 'Product' } catch { return false }
            })
            verified = pageResponse.ok && canonical === `${window.location.origin}${liveUrl}` && schema && doc.querySelector('h1')?.textContent?.trim() === product.name
            if (!verified) reason = `HTTP ${pageResponse.status}; canonical, product heading, or Product structured data did not match.`
          } catch {
            reason = 'Could not fetch the public product URL from this browser.'
          }
        }
        setPublishVerification({ url: liveUrl, ok: verified, message: verified ? 'Published and verified from the public page.' : `Saved as published, but public verification failed: ${reason}` })
        if (!verified) {
          setSaved(false)
          toast(`Published, but live page check failed: ${reason}`, 'error')
          return
        }
      } else {
        setPublishVerification(null)
      }

      // Reflect the intent in the form so the Visibility dropdown and the
      // header label agree with what was just stored.
      if (finalStatus !== form.status) updateField('status', finalStatus)

      isDirtyRef.current = false
      setSaved(true)
      setTimeout(() => { setSaved(false); navigate('/admin/products') }, 1800)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save product'
      if (err instanceof Error && 'details' in err && Array.isArray((err as { details?: unknown }).details)) {
        const details = (err as { details: { field: string; message: string }[] }).details
        const fieldErrors: Record<string, string> = {}
        details.forEach((d) => { fieldErrors[d.field] = d.message })
        setErrors(fieldErrors)
        const firstField = details[0]?.field
        setActiveTab(firstField === 'images' ? 'images' : firstField === 'description' ? 'details' : ['seoTitle', 'seoDescription', 'mpn'].includes(firstField) ? 'seo' : 'basics')
        toast('Please fix the highlighted field errors', 'error')
      } else {
        toast(msg, 'error')
      }
    } finally {
      setSaving(false)
    }
  }, [form, isEditing, id, navigate, toast, validate, updateField])

  return {
    id, isEditing, navigate, publicSlug,
    activeTab, setActiveTab,
    form, setForm,
    loadingProduct,
    saving, saved, publishVerification,
    errors, touched, attempted,
    brandList, categoryList, industryList,
    uploadingImage,
    productImageInputId,
    tabErrors, isValid,

    updateField,
    addSpec, removeSpec, updateSpec,
    addArrayItem, removeArrayItem, updateArrayItem,
    addImage, removeImage, updateImage,
    toggleIndustry,
    validate, markTouched, showError,
    getFieldClass, getSelectClass,
    labelClass, errorClass,
    handleSave, handleImageUpload,
  }
}
