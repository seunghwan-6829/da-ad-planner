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
  // 데이터 추적: 로그인은 필요하지만 da-ad-planner 사이드바 없이 전체화면(레이아웃이 옆으로 길어 잘림 방지)
  const isDataTracking = pathname.startsWith('/data-tracking')

  return (
    <AuthProvider>
      {isLoginPage || isPublicVideoSharePage || isPublicGuidePage || isPublicAdSharePage || isPublicContentGuidePage ? (
        <>{children}</>
      ) : isDataTracking ? (
        <AuthGuard>{children}</AuthGuard>
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
