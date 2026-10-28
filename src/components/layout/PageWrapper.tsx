import { useLocation } from 'react-router-dom'
import { Navbar } from './Navbar'
import { Footer } from './Footer'

interface PageWrapperProps {
  children: React.ReactNode
}

export function PageWrapper({ children }: PageWrapperProps) {
  const { pathname } = useLocation()

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      {/* The page entrance used <AnimatePresence> + <motion.div>, which put
          framer-motion (~40 KB gz) on the critical path of EVERY page via a
          static layout import. The keyed element now restarts a composited
          CSS opacity/transform animation on navigation instead — same 0.3s
          fade-up 20px, zero JS animation library. The exit transition was
          dropped: pages swap instantly and fade in (no "wait" stutter). */}
      <main key={pathname} className="page-enter flex-1">
        {children}
      </main>
      <Footer />
    </div>
  )
}
