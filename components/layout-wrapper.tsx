'use client'

import { usePathname } from 'next/navigation'
import { AuthProvider } from '@/lib/auth-context'
import { AuthGuard } from '@/components/auth-guard'
import { Sidebar } from '@/components/sidebar'

export function LayoutWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isLoginPage = pathname === '/login'

  return (
    <AuthProvider>
      {isLoginPage ? (
        // 로그인 페이지는 사이드바 없이
        <>{children}</>
      ) : (
        // 그 외 페이지는 사이드바와 함께
        <AuthGuard>
          <div className="flex h-screen">
            <Sidebar />
            <main className="flex-1 overflow-auto bg-gray-50 p-8">
              {children}
            </main>
          </div>
        </AuthGuard>
      )}
    </AuthProvider>
  )
}
