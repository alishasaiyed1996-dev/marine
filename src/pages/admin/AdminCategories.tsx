import { useState, useMemo, useEffect, useCallback } from 'react'
import {
  Search,
  FolderTree,
  Plus,
  Pencil,
  Trash2,
  ChevronRight,
  ChevronDown,
  GripVertical,
  X,
  Eye,
  CheckCircle,
  ArrowUp,
  ArrowDown,
} from 'lucide-react'
import { admin } from '../../lib/api'
import { useToast } from '../../components/admin/toast-context'
import type { ApiCategory } from '../../lib/api-types'

// ─── Types ────────────────────────────────────────────────────────────────────────

interface Category {
  id: string
  name: string
  slug: string
  description: string
  seoTitle: string
  seoDescription: string
  parentId: string | null
  sortOrder: number
  isVisible: boolean
}



// ─── Helpers ──────────────────────────────────────────────────────────────────────

const inputClass = 'w-full rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] py-2.5 px-4 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] transition-all focus:border-[var(--accent-gold)]'
const labelClass = 'block text-xs font-bold text-[var(--text-secondary)] mb-1.5'

interface TreeNode extends Category {
  children: TreeNode[]
}

function buildTree(categories: Category[]): TreeNode[] {
  const map = new Map<string, TreeNode>()
  const roots: TreeNode[] = []

  categories.forEach((c) => map.set(c.id, { ...c, children: [] }))

  categories.forEach((c) => {
    const node = map.get(c.id)!
    if (c.parentId && map.has(c.parentId)) {
      map.get(c.parentId)!.children.push(node)
    } else {
      roots.push(node)
    }
  })

  return roots.sort((a, b) => a.sortOrder - b.sortOrder)
}

function getCategoryProductCount(categoryId: string, _categories: (Category & { productCount?: number })[]): number {
  const cat = _categories.find((c) => c.id === categoryId)
  return cat?.productCount ?? 0
}



// ─── Component ────────────────────────────────────────────────────────────────────

export default function AdminCategories() {
  const { toast } = useToast()
  const [categories, setCategories] = useState<Category[]>([])
  const [_loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set([]))
  const [editingCategory, setEditingCategory] = useState<string | null>(null)
  const [newCategoryOpen, setNewCategoryOpen] = useState(false)
  const [newParentId, setNewParentId] = useState<string | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  const fetchCategories = useCallback(async () => {
    setLoading(true)
    try {
      const res = await admin.categories.list()
      // The admin endpoint returns only top-level categories, each with its
      // subcategories nested under `children`. Flatten so the tree can render
      // and edit every level.
      const topLevel = (res.categories || []) as (ApiCategory & { children?: ApiCategory[] })[]
      const rows: (ApiCategory & { productCount?: number })[] = []
      for (const c of topLevel) {
        rows.push(c)
        for (const child of c.children || []) rows.push(child)
      }
      const cats = rows.map((c) => ({
        id: c.id || c.slug,
        name: c.name,
        slug: c.slug,
        description: c.description || '',
        seoTitle: c.seoTitle || '',
        seoDescription: c.seoDescription || '',
        parentId: c.parentId || null,
        sortOrder: c.sortOrder ?? 0,
        isVisible: c.isVisible ?? true,
        productCount: c._count?.products ?? c.productCount ?? 0,
      })) as Category[]
      setCategories(cats)
      // Auto-expand top-level
      setExpandedIds(new Set(cats.filter((c: Category) => !c.parentId).map((c: Category) => c.id)))
    } catch (err: unknown) {
      console.error('Failed to load categories:', err)
      toast('Failed to load categories', 'error')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { fetchCategories() }, [fetchCategories])

  const tree = useMemo(() => buildTree(categories), [categories])

  const filteredTree: TreeNode[] = useMemo(() => {
    if (!search.trim()) return tree
    const q = search.toLowerCase()
    return tree.filter((root) => {
      const rootMatch = root.name.toLowerCase().includes(q) || root.description.toLowerCase().includes(q)
      const childMatch = root.children.some((child) => child.name.toLowerCase().includes(q) || child.description.toLowerCase().includes(q))
      return rootMatch || childMatch
    }).map((root) => ({
      ...root,
      children: root.children.filter((c) => c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q)),
    }))
  }, [tree, search])

  const totalCount = categories.length
  const topLevelCount = categories.filter((c) => !c.parentId).length

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleSave = async (cat: Partial<Category>) => {
    try {
      if (editingCategory) {
        await admin.categories.update(editingCategory, { name: cat.name, slug: cat.slug, description: cat.description, seoTitle: cat.seoTitle, seoDescription: cat.seoDescription, parentId: cat.parentId, sortOrder: cat.sortOrder })
        toast('Category updated', 'success')
        setEditingCategory(null)
      } else {
        await admin.categories.create({ name: cat.name, slug: cat.slug, description: cat.description, seoTitle: cat.seoTitle, seoDescription: cat.seoDescription, parentId: newParentId })
        toast('Category created', 'success')
        setNewCategoryOpen(false)
        setNewParentId(null)
      }
      fetchCategories()
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Failed to save category', 'error')
    }
  }

  const handleDelete = async (catId: string) => {
    try {
      await admin.categories.delete(catId)
      toast('Category deleted', 'success')
      setDeleteConfirmId(null)
      fetchCategories()
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Failed to delete category', 'error')
    }
  }

  const handleToggleVisibility = async (catId: string) => {
    const cat = categories.find((c) => c.id === catId)
    if (!cat) return
    const nextVisible = !cat.isVisible
    setCategories((prev) => prev.map((c) => c.id === catId ? { ...c, isVisible: nextVisible } : c))
    try {
      await admin.categories.update(catId, { isVisible: nextVisible })
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Failed to update visibility', 'error')
      setCategories((prev) => prev.map((c) => c.id === catId ? { ...c, isVisible: !nextVisible } : c))
    }
  }

  const handleMoveCategory = async (catId: string, direction: 'up' | 'down') => {
    const cat = categories.find((c) => c.id === catId)
    if (!cat) return
    const siblings = categories.filter((c) => c.parentId === cat.parentId).sort((a, b) => a.sortOrder - b.sortOrder)
    const idx = siblings.findIndex((c) => c.id === catId)
    if (direction === 'up' && idx <= 0) return
    if (direction === 'down' && idx >= siblings.length - 1) return
    const other = direction === 'up' ? siblings[idx - 1] : siblings[idx + 1]

    // Optimistic update
    setCategories((prev) => prev.map((c) => {
      if (c.id === catId) return { ...c, sortOrder: other.sortOrder }
      if (c.id === other.id) return { ...c, sortOrder: cat.sortOrder }
      return c
    }))

    // Persist to API
    try {
      await Promise.all([
        admin.categories.reorder(catId, other.sortOrder),
        admin.categories.reorder(other.id, cat.sortOrder),
      ])
    } catch {
      toast('Failed to save order', 'error')
      fetchCategories() // Revert on error
    }
  }

  // ─── Render Tree Node ──────────────────────────────────────────────────────────

  const renderNode = (node: TreeNode, depth: number = 0) => {
    const isExpanded = expandedIds.has(node.id)
    const productCount = getCategoryProductCount(node.id, categories)
    const isEditing = editingCategory === node.id
    const isDeleting = deleteConfirmId === node.id

    return (
      <div key={node.id}>
        <div
          className={`group flex items-center gap-2 rounded-xl px-3 py-2.5 transition-all hover:bg-[var(--surface-soft)] ${
            isEditing ? 'bg-[var(--surface-soft)]' : ''
          } ${!node.isVisible ? 'opacity-50' : ''}`}
          style={{ paddingLeft: `${depth * 24 + 12}px` }}
        >
          {/* Expand/Collapse */}
          <button
            onClick={() => toggleExpand(node.id)}
            className="flex h-5 w-5 items-center justify-center shrink-0"
          >
            {node.children.length > 0 ? (
              isExpanded ? <ChevronDown size={12} className="text-[var(--text-muted)]" /> : <ChevronRight size={12} className="text-[var(--text-muted)]" />
            ) : (
              <span className="w-3" />
            )}
          </button>

          {/* Drag Handle */}
          <GripVertical size={12} className="text-[var(--text-muted)]/30 group-hover:text-[var(--text-muted)] shrink-0 cursor-grab" />

          {/* Folder Icon */}
          <FolderTree size={14} className={`${node.children.length > 0 ? 'text-[var(--accent-gold)]' : 'text-[var(--text-muted)]'} shrink-0`} />

          {/* Name + Slug */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-[var(--text-primary)] truncate">{node.name}</span>
              <span className="text-[0.625rem] text-[var(--text-muted)] font-mono truncate hidden sm:inline">/{node.slug}</span>
            </div>
            {node.description && (
              <p className="text-[0.625rem] text-[var(--text-muted)] truncate mt-0.5 max-w-xs">{node.description}</p>
            )}
          </div>

          {/* Product Count */}
          <span className="text-[0.625rem] font-bold text-[var(--text-muted)] bg-[var(--surface-soft)] border border-[var(--border)] rounded-md px-1.5 py-0.5 shrink-0 hidden sm:inline">
            {productCount} products
          </span>

          {/* Visibility Dot */}
          <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${node.isVisible ? 'bg-[var(--success)]' : 'bg-[var(--text-muted)]'}`} title={node.isVisible ? 'Visible' : 'Hidden'} />

          {/* Actions */}
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
            <button
              onClick={(e) => { e.stopPropagation(); handleMoveCategory(node.id, 'up') }}
              className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-muted)] hover:text-[var(--accent-blue)] hover:bg-[var(--accent-blue)]/10 transition-colors"
              title="Move up"
            >
              <ArrowUp size={10} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); handleMoveCategory(node.id, 'down') }}
              className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-muted)] hover:text-[var(--accent-blue)] hover:bg-[var(--accent-blue)]/10 transition-colors"
              title="Move down"
            >
              <ArrowDown size={10} />
            </button>
            <button
              onClick={() => { setNewParentId(node.id); setNewCategoryOpen(true); setEditingCategory(null) }}
              className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-muted)] hover:text-[var(--accent-teal)] hover:bg-[var(--accent-teal)]/10 transition-colors"
              title="Add subcategory"
            >
              <Plus size={10} />
            </button>
            <button
              onClick={() => { setEditingCategory(isEditing ? null : node.id); setNewCategoryOpen(false) }}
              className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-muted)] hover:text-[var(--accent-gold)] hover:bg-[var(--gold-muted)] transition-colors"
              title="Edit"
            >
              <Pencil size={10} />
            </button>
            <button
              onClick={() => handleToggleVisibility(node.id)}
              className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-muted)] hover:text-[var(--accent-blue)] hover:bg-[var(--accent-blue)]/10 transition-colors"
              title={node.isVisible ? 'Hide' : 'Show'}
            >
              <Eye size={10} />
            </button>
            <button
              onClick={() => setDeleteConfirmId(isDeleting ? null : node.id)}
              className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger)]/10 transition-colors"
              title="Delete"
            >
              <Trash2 size={10} />
            </button>
          </div>
        </div>

        {/* Delete Confirmation */}
        {isDeleting && (
          <div className="ml-12 mb-2 flex items-center gap-2 rounded-lg border border-[var(--danger)]/20 bg-[var(--danger)]/5 px-3 py-2">
            <p className="text-[0.625rem] text-[var(--danger)] font-bold">
              Delete "{node.name}"{node.children.length > 0 ? ` and ${node.children.length} subcategories` : ''}?
            </p>
            <button
              onClick={() => handleDelete(node.id)}
              className="rounded-md bg-[var(--danger)] px-2 py-0.5 text-[0.625rem] font-bold text-[var(--btn-danger-text)] hover:bg-[var(--danger)]/80"
            >
              Confirm
            </button>
            <button
              onClick={() => setDeleteConfirmId(null)}
              className="text-[0.625rem] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Inline Edit Form */}
        {isEditing && (
          <div className="ml-12 mb-2 rounded-xl border border-[var(--accent-gold)]/20 bg-[var(--accent-gold)]/5 p-4 space-y-3">
            <h4 className="text-[0.625rem] font-bold uppercase tracking-wider text-[var(--accent-gold)]">Edit Category</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Name</label>
                <input value={node.name} onChange={(e) => setCategories((prev) => prev.map((c) => c.id === node.id ? { ...c, name: e.target.value } : c))} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Slug</label>
                <input value={node.slug} onChange={(e) => setCategories((prev) => prev.map((c) => c.id === node.id ? { ...c, slug: e.target.value } : c))} className={inputClass} />
              </div>
              <div className="sm:col-span-2">
                <label className={labelClass}>Description</label>
                <textarea value={node.description} onChange={(e) => setCategories((prev) => prev.map((c) => c.id === node.id ? { ...c, description: e.target.value } : c))} rows={3} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>SEO Title (max 70)</label>
                <input value={node.seoTitle} maxLength={70} onChange={(e) => setCategories((prev) => prev.map((c) => c.id === node.id ? { ...c, seoTitle: e.target.value } : c))} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>SEO Description (max 160)</label>
                <textarea value={node.seoDescription} maxLength={160} rows={2} onChange={(e) => setCategories((prev) => prev.map((c) => c.id === node.id ? { ...c, seoDescription: e.target.value } : c))} className={inputClass} />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => handleSave({ id: node.id, name: node.name, slug: node.slug, description: node.description, seoTitle: node.seoTitle, seoDescription: node.seoDescription })}
                className="inline-flex items-center gap-1 rounded-lg bg-[var(--accent-gold)] px-3 py-1.5 text-[0.625rem] font-bold text-[var(--btn-blue-text)]"
              >
                <CheckCircle size={10} /> Save
              </button>
              <button onClick={() => { fetchCategories(); setEditingCategory(null) }} className="text-[0.625rem] text-[var(--text-muted)] hover:text-[var(--text-primary)]">Cancel</button>
            </div>
          </div>
        )}

        {/* Children */}
        {isExpanded && node.children.length > 0 && (
          <div>
            {node.children.sort((a, b) => a.sortOrder - b.sortOrder).map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-extrabold text-[var(--text-primary)]">Categories</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">{totalCount} categories ({topLevelCount} top-level)</p>
        </div>
        <button
          onClick={() => { setNewCategoryOpen(true); setNewParentId(null); setEditingCategory(null) }}
          className="inline-flex items-center gap-2 rounded-xl bg-[var(--accent-gold)] px-4 py-2.5 text-xs font-bold text-[var(--btn-blue-text)] hover:shadow-[0_4px_12px_rgba(232,170,36,0.3)] transition-all"
        >
          <Plus size={14} /> Add Category
        </button>
      </div>

      {/* Search */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="relative">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="text"
            placeholder="Search categories..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] py-2.5 pl-10 pr-4 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] transition-all focus:border-[var(--accent-gold)]"
          />
        </div>
      </div>

      {/* New Category Form */}
      {newCategoryOpen && (
        <NewCategoryForm
          parentId={newParentId}
          categories={categories}
          onAdd={(cat) => handleSave(cat)}
          onCancel={() => { setNewCategoryOpen(false); setNewParentId(null) }}
        />
      )}

      {/* Category Tree */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
        {filteredTree.length === 0 ? (
          <div className="text-center py-12">
            <FolderTree size={32} className="mx-auto text-[var(--text-muted)] mb-3" />
            <p className="text-sm font-semibold text-[var(--text-muted)]">No categories found</p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {filteredTree.map((node) => renderNode(node, 0))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── New Category Form ────────────────────────────────────────────────────────────

function NewCategoryForm({ parentId, categories, onAdd, onCancel }: { parentId: string | null; categories: Category[]; onAdd: (cat: Partial<Category>) => void; onCancel: () => void }) {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [description, setDescription] = useState('')
  const [seoTitle, setSeoTitle] = useState('')
  const [seoDescription, setSeoDescription] = useState('')

  const parentName = parentId ? categories.find((c) => c.id === parentId)?.name : null

  return (
    <div className="rounded-2xl border border-[var(--accent-gold)]/20 bg-[var(--accent-gold)]/5 p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-[var(--accent-gold)]">
          New Category{parentName ? ` (under "${parentName}")` : ''}
        </h3>
        <button onClick={onCancel} className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)]">
          <X size={14} />
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Name *</label>
          <input value={name} onChange={(e) => { setName(e.target.value); setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')) }} placeholder="e.g. Propellers" className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Slug</label>
          <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="propellers" className={inputClass} />
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass}>Description</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Write original category copy for shoppers" className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>SEO Title (max 70)</label>
          <input value={seoTitle} onChange={(e) => setSeoTitle(e.target.value)} maxLength={70} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>SEO Description (max 160)</label>
          <textarea value={seoDescription} onChange={(e) => setSeoDescription(e.target.value)} maxLength={160} rows={2} className={inputClass} />
        </div>
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => onAdd({ name: name || 'New Category', slug, description, seoTitle, seoDescription })}
          disabled={!name.trim()}
          className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--accent-gold)] px-4 py-2.5 text-xs font-bold text-[var(--btn-blue-text)] hover:shadow-[0_4px_12px_rgba(232,170,36,0.3)] transition-all disabled:opacity-40"
        >
          <Plus size={14} /> Create Category
        </button>
        <button onClick={onCancel} className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-4 py-2.5 text-xs font-bold text-[var(--text-secondary)] hover:border-[var(--accent-gold)] transition-colors">
          Cancel
        </button>
      </div>
    </div>
  )
}
