import { Component, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useLocalizedPath } from '../../lib/locale'

interface Props {
  children: ReactNode
  pageName?: string
}

interface State {
  hasError: boolean
  error: Error | null
}

/** Keeps the error fallback inside the active locale (en/ar/es). */
function ErrorHomeLink() {
  const lp = useLocalizedPath()
  return (
    <Link
      to={lp('/')}
      className="px-5 py-2.5 text-xs font-bold border border-[var(--border)] text-[var(--text-secondary)] rounded-lg hover:border-[var(--accent-gold)] hover:text-[var(--accent-gold)] transition-all no-underline"
    >
      Go Home
    </Link>
  )
}

export class PageErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[PageErrorBoundary - ${this.props.pageName ?? 'page'}]`, error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center">
          <div className="w-16 h-16 rounded-full border-2 border-[var(--danger)] flex items-center justify-center mb-6">
            <span className="text-2xl">⚠️</span>
          </div>
          <h2 className="font-display font-bold text-xl text-[var(--text-primary)] mb-2">
            Something went wrong
          </h2>
          <p className="text-sm text-[var(--text-secondary)] max-w-[420px] mb-6">
            {this.props.pageName
              ? `Failed to load the ${this.props.pageName} page. Please try again.`
              : 'An unexpected error occurred. Please try again.'}
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null })
                window.location.reload()
              }}
              className="px-5 py-2.5 text-xs font-bold border border-[var(--accent-blue)] text-[var(--accent-blue)] rounded-lg hover:bg-[var(--accent-blue)] hover:text-[var(--btn-blue-text)] transition-all cursor-pointer"
            >
              Retry
            </button>
            <ErrorHomeLink />
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
