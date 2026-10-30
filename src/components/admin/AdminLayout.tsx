import { Suspense, useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import { AdminSidebar } from './AdminSidebar'
import { AdminHeader } from './AdminHeader'
import { AdminCommandPalette } from './AdminCommandPalette'
import { useStore } from '../../store/useStore'

export function AdminLayout() {
  const collapsed = useStore((s) => s.adminSidebarCollapsed)

  // Dynamically load admin CSS only when entering admin routes
  useEffect(() => {
    import('../../admin.css')
  }, [])

  return (
    <div className="flex min-h-screen bg-[var(--primary-bg)]">
      <AdminSidebar />

      <div
        className={`admin-main flex min-w-0 flex-1 flex-col transition-all duration-300 ${
          collapsed ? 'lg:ml-[76px]' : 'lg:ml-[264px]'
        }`}
      >
        <AdminHeader />

        <main className="admin-content flex-1 px-3 py-4 sm:px-5 sm:py-6 lg:px-8 lg:py-7">
          <div className="mx-auto w-full max-w-[1500px]">
            <Suspense
              fallback={
                <div className="space-y-4" aria-hidden="true">
                  <div className="h-8 w-48 animate-pulse rounded-lg bg-[var(--surface-soft)]" />
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    {[0, 1, 2, 3].map((key) => (
                      <div key={key} className="h-28 animate-pulse rounded-2xl bg-[var(--surface-soft)]" />
                    ))}
                  </div>
                </div>
              }
            >
              <Outlet />
            </Suspense>
          </div>
        </main>
      </div>

      <AdminCommandPalette />
    </div>
  )
}
