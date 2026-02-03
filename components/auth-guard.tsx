'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { Loader2, Lock, LogIn } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/lib/auth-context'

// 로그인 없이 접근 가능한 페이지
const publicPaths = ['/login']

// 대시보드만 볼 수 있는 경로 (승인 없이)
const dashboardOnlyPaths = ['/']

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { user, profile, loading, isApproved } = useAuth()
  const [showModal, setShowModal] = useState(false)

  const isPublicPath = publicPaths.includes(pathname)
  const isDashboardOnly = dashboardOnlyPaths.includes(pathname)

  useEffect(() => {
    if (loading) return

    // 로그인 안 된 상태에서 비공개 페이지 접근
    if (!user && !isPublicPath) {
      router.push('/login')
      return
    }

    // 로그인 됐지만 승인 안 된 상태에서 기능 페이지 접근
    if (user && !isApproved && !isPublicPath && !isDashboardOnly) {
      setShowModal(true)
    } else {
      setShowModal(false)
    }
  }, [user, isApproved, loading, pathname, router, isPublicPath, isDashboardOnly])

  // 로딩 중
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  // 로그인 페이지
  if (isPublicPath) {
    return <>{children}</>
  }

  // 로그인 안 됨
  if (!user) {
    return null
  }

  return (
    <>
      {children}
      
      {/* 권한 없음 모달 */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 text-center">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Lock className="h-8 w-8 text-red-600" />
            </div>
            <h2 className="text-xl font-bold mb-2">접근 권한이 없습니다</h2>
            <p className="text-muted-foreground mb-6">
              이 기능을 사용하려면 관리자의 승인이 필요합니다.
              <br />
              승인을 기다려주세요.
            </p>
            <div className="flex gap-3">
              <Button 
                variant="outline" 
                className="flex-1"
                onClick={() => {
                  setShowModal(false)
                  router.push('/')
                }}
              >
                대시보드로 이동
              </Button>
              <Button 
                className="flex-1"
                onClick={() => {
                  setShowModal(false)
                  router.back()
                }}
              >
                뒤로가기
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-4">
              현재 상태: {profile?.role === 'pending' ? '승인 대기중' : profile?.role}
            </p>
          </div>
        </div>
      )}
    </>
  )
}
