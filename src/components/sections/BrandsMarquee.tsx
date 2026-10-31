import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { SectionLabel } from '../ui/SectionLabel'
import { Marquee } from '../ui/Marquee'
import { useBrands } from '../../hooks/useApiQuery'
import { brandMarqueeItems, brandMarqueeItems2 } from '../../data/brands'

export function BrandsMarquee() {
  const { t } = useTranslation()

  // React Query caches brands — replaces manual useEffect + fetch
  const { data: brandsData } = useBrands()

  const { row1, row2 } = useMemo(() => {
    if (brandsData?.brands?.length) {
      const names = brandsData.brands.map((b) => b.name).filter(Boolean)
      const mid = Math.ceil(names.length / 2)
      return { row1: names.slice(0, mid), row2: names.slice(mid) }
    }
    return { row1: brandMarqueeItems, row2: brandMarqueeItems2 }
  }, [brandsData])

  if (row1.length === 0 && row2.length === 0) return null

  return (
    <section className="section-y bg-[var(--primary-bg)]" id="brands">
      <div className="site-container section-header">
        <SectionLabel>{t('brands.label')}</SectionLabel>
        <h2 className="font-display font-bold text-section tracking-tight">{t('brands.title')}</h2>
        <div className="gold-accent-bar mt-4" />
      </div>
      {row1.length > 0 && (
        <div className="mb-4">
          <Marquee items={row1} direction="left" speed="30s" />
        </div>
      )}
      {row2.length > 0 && (
        <div>
          <Marquee items={row2} direction="right" speed="25s" />
        </div>
      )}
    </section>
  )
}
