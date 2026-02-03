'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { Loader2, X, AlertTriangle } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { user, profile, loading, isApproved } = useAuth()
  const [showNoPermission, setShowNoPermission] = useState(false)
  const [ready, setReady] = useState(false)

  // 타임아웃으로 무한 로딩 방지
  useEffect(() => {
    const timer = setTimeout(() => {
      setReady(true)
    }, 3000)

    if (!loading) {
      setReady(true)
      clearTimeout(timer)
    }

    return () => clearTimeout(timer)
  }, [loading])

  // 인증 체크
  useEffect(() => {
    if (!ready) return

    // 로그인 안 됨 -> 로그인 페이지로
    if (!user) {
      router.replace('/login')
      return
    }

    // 로그인은 됐는데 승인 안 됨 -> 권한 없음 표시
    if (user && profile && !isApproved) {
      setShowNoPermission(true)
    }
  }, [ready, user, profile, isApproved, router])

  // 로딩 중
  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">로딩 중...</p>
        </div>
      </div>
    )
  }

  // 유저 없으면 (로그인 페이지로 리다이렉트 중)
  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <>
      {children}
      
      {/* 권한 없음 모달 */}
      {showNoPermission && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-sm mx-4 shadow-xl">
            <div className="flex items-center justify-center mb-4">
              <div className="w-12 h-12 rounded-full bg-yellow-100 flex items-center justify-center">
                <AlertTriangle className="h-6 w-6 text-yellow-600" />
              </div>
            </div>
            <h3 className="text-lg font-semibold text-center mb-2">
              권한이 없습니다
            </h3>
            <p className="text-sm text-gray-600 text-center mb-4">
              관리자 승인 후 서비스를 이용할 수 있습니다.<br />
              승인이 완료되면 다시 로그인해주세요.
            </p>
            <div className="flex justify-center">
              <button
                onClick={() => {
                  setShowNoPermission(false)
                  window.location.href = '/login'
                }}
                className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90"
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
