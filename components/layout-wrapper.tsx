'use client'

import { usePathname } from 'next/navigation'
import { AuthProvider } from '@/lib/auth-context'
import { AuthGuard } from '@/components/auth-guard'
import { Sidebar } from '@/components/sidebar'

export function LayoutWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isLoginPage = pathname === '/login'
  const isPublicVideoSharePage = pathname.startsWith('/video-board/share/')
  const isPublicGuidePage = pathname.startsWith('/guide/')
  const isPublicAdSharePage = pathname.startsWith('/meta-ad/share/')
  const isPublicContentGuidePage = pathname.startsWith('/content-guide/share/')

  return (
    <AuthProvider>
      {isLoginPage || isPublicVideoSharePage || isPublicGuidePage || isPublicAdSharePage || isPublicContentGuidePage ? (
        <>{children}</>
      ) : (
        <AuthGuard>
          <div className="flex h-screen">
            <Sidebar />
            <main className="flex-1 overflow-auto bg-gray-50 dark:bg-gray-900 p-8">{children}</main>
          </div>
        </AuthGuard>
      )}
    </AuthProvider>
  )
}
