import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft } from 'lucide-react'
import { SEO } from '../components/seo/SEO'
import { useLocalizedPath } from '../lib/locale'

export default function NotFound() {
  const { t } = useTranslation()
  const lp = useLocalizedPath()
  return (
    <>
      <SEO title="Page Not Found — Alka Traders" description="The page you are looking for does not exist. Browse our marine and industrial equipment catalog or return home." />
      <div className="min-h-[60vh] flex items-center justify-center">
      <div className="text-center max-w-[480px] mx-auto px-4 sm:px-6">
        <div className="font-mono text-8xl text-[var(--text-muted)] mb-6">404</div>
        <h1 className="font-display font-bold text-section-lg tracking-tight mb-3">
          {t('notFound.title')}
        </h1>
        <p className="text-body-sm text-[var(--text-secondary)] mb-8">
          {t('notFound.sub')}
        </p>
        <Link
          to={lp('/')}
          className="inline-flex items-center gap-2 px-7 py-3.5 bg-[var(--accent-primary)] text-[var(--btn-blue-text)] font-semibold text-sm border border-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] hover:border-[var(--accent-primary-hover)] transition-all no-underline rounded-xl"
        >
          <ArrowLeft size={16} />          {t('notFound.cta')}
        </Link>
      </div>
      </div>
    </>
  )
}
