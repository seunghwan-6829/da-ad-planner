'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// 이 페이지는 메인 페이지로 리다이렉트합니다
export default function ClientPlansPage() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/project-plans')
  }, [router])

  return null
}
