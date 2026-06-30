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
  // 데이터 추적: da-ad-planner 사이드바는 유지(매끄러운 섹션 전환·활성표시), main 패딩/배경만 제거해
  // pulseboard가 영역을 꽉 채우게. pulseboard CSS는 .pb-app 으로 스코프돼 사이드바에 영향 없음.
  const isDataTracking = pathname.startsWith('/data-tracking')

  return (
    <AuthProvider>
      {isLoginPage || isPublicVideoSharePage || isPublicGuidePage || isPublicAdSharePage || isPublicContentGuidePage ? (
        <>{children}</>
      ) : (
        <AuthGuard>
          <div className="flex h-screen">
            <Sidebar />
            <main className={isDataTracking ? 'flex-1 overflow-auto' : 'flex-1 overflow-auto bg-gray-50 dark:bg-gray-900 p-8'}>{children}</main>
          </div>
        </AuthGuard>
      )}
    </AuthProvider>
  )
}
