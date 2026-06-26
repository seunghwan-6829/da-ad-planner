'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  BarChart3,
  Bell,
  Camera,
  ChevronRight,
  Clapperboard,
  FileCode,
  Images,
  Image as ImageIcon,
  LayoutDashboard,
  Lightbulb,
  LogOut,
  Megaphone,
  Network,
  Settings,
  Shield,
  User,
  Video,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/lib/auth-context'
import { Button } from '@/components/ui/button'

const navigationTop = [
  { name: '대시보드', href: '/', icon: LayoutDashboard },
  { name: 'BP소재', href: '/templates', icon: FileCode },
  { name: '영상 보드', href: '/video-board', icon: Video },
  { name: '이미지 보드', href: '/image-board', icon: Images },
  { name: '인스타 성과', href: '/instagram', icon: BarChart3 },
  { name: '메타 광고 크롤러', href: '/meta-ad-crawler', icon: Megaphone },
]

const navigationBottom = [
  { name: '이미지 베리에이션', href: '/image-variation', icon: ImageIcon },
  { name: '영상 베리에이션', href: '/ai-variation', icon: Video },
  { name: '기획안 제작', href: '/project-plans', icon: Clapperboard },
  { name: '기획 마인드맵', href: '/plan-mindmap', icon: Network },
  { name: '기획안 아이디어', href: '/plan-ideas', icon: Lightbulb },
  { name: '촬영 가이드', href: '/shooting-guide', icon: Camera },
]

type MetaChange = { newCount: number; endedCount: number; latest: string | null }

export function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const { user, profile, isAdmin, canMetaAd, signOut } = useAuth()

  // '메타 광고 크롤러'는 권한(can_meta_ad) 또는 관리자만 노출
  const topItems = navigationTop.filter((item) => item.href !== '/meta-ad-crawler' || canMetaAd)

  // #6 메타 광고 5일 알림: 신규/종료 변화가 있으면 하단 배지. 닫으면 그 시그니처는 다시 안 뜸(새 변화 시 재등장).
  const [change, setChange] = useState<MetaChange | null>(null)
  const [dismissed, setDismissed] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    try {
      setDismissed(localStorage.getItem('ma-alert-seen'))
    } catch {}
    fetch('/api/meta-ad/changes')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setChange(j))
      .catch(() => {})
  }, [user])

  const showAlert =
    !!change &&
    change.newCount + change.endedCount > 0 &&
    change.latest != null &&
    dismissed !== change.latest &&
    !pathname.startsWith('/meta-ad-crawler')

  function dismissAlert() {
    if (change?.latest) {
      try {
        localStorage.setItem('ma-alert-seen', change.latest)
      } catch {}
      setDismissed(change.latest)
    }
  }

  function handleSignOut() {
    signOut()
  }

  return (
    <div className="flex h-full w-64 flex-col border-r bg-white dark:bg-gray-950 dark:border-gray-800">
      <div className="flex h-16 items-center border-b dark:border-gray-800 px-6 gap-2">
        <img src="/logo.png" alt="로고" className="h-7 rounded" style={{ aspectRatio: '390/300' }} />
        <h1 className="text-lg font-bold text-primary">컨텐츠 디벨로퍼</h1>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto p-4">
        {topItems.map((item) => {
          const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href))

          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive ? 'bg-primary text-white' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
              )}
            >
              <item.icon className="h-5 w-5" />
              {item.name}
              {isActive && <ChevronRight className="ml-auto h-4 w-4" />}
            </Link>
          )
        })}

        <div className="my-3 border-t dark:border-gray-800 pt-3">
          <p className="mb-2 px-3 text-xs font-medium uppercase text-gray-400 dark:text-gray-500">제작 도구</p>
        </div>

        {navigationBottom.map((item) => {
          const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href))

          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive ? 'bg-primary text-white' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
              )}
            >
              <item.icon className="h-5 w-5" />
              {item.name}
              {isActive && <ChevronRight className="ml-auto h-4 w-4" />}
            </Link>
          )
        })}

        {isAdmin && (
          <Link
            href="/admin"
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              pathname === '/admin' ? 'bg-red-600 text-white' : 'text-red-600 hover:bg-red-50 dark:hover:bg-red-950'
            )}
          >
            <Shield className="h-5 w-5" />
            관리자
            {pathname === '/admin' && <ChevronRight className="ml-auto h-4 w-4" />}
          </Link>
        )}
      </nav>

      {showAlert && change && (
        <div className="px-4 pt-3">
          <div className="relative rounded-xl border border-primary/30 bg-primary/5 dark:bg-primary/10 p-3">
            <button
              onClick={dismissAlert}
              className="absolute right-1.5 top-1.5 rounded p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              aria-label="알림 닫기"
            >
              <X className="h-3.5 w-3.5" />
            </button>
            <Link href="/meta-ad-crawler" className="block pr-4">
              <div className="mb-1 flex items-center gap-1.5 text-xs font-bold text-primary">
                <Bell className="h-3.5 w-3.5" /> 경쟁사 광고 변화
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-300">
                최근 5일
                {change.newCount > 0 && (
                  <> · 신규 <b className="text-green-600">{change.newCount}</b></>
                )}
                {change.endedCount > 0 && (
                  <> · 종료 <b className="text-gray-500">{change.endedCount}</b></>
                )}
              </p>
            </Link>
          </div>
        </div>
      )}

      <div className="space-y-3 border-t dark:border-gray-800 p-4">
        {user && profile ? (
          <Link href="/mypage" className="flex items-center gap-3 px-2 rounded-lg py-1 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
              <User className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium dark:text-gray-200">{profile.name || profile.email}</p>
              <p className="text-xs text-muted-foreground">
                {profile.role === 'admin' ? '관리자' : profile.role === 'approved' ? '승인됨' : '대기중'}
              </p>
            </div>
            <Settings className="h-4 w-4 text-gray-400" />
          </Link>
        ) : null}

        {user ? (
          <Button variant="outline" size="sm" className="w-full dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800" onClick={handleSignOut}>
            <LogOut className="mr-2 h-4 w-4" />
            로그아웃
          </Button>
        ) : (
          <Button size="sm" className="w-full" onClick={() => router.push('/login')}>
            로그인
          </Button>
        )}

        <p className="text-center text-xs text-gray-500 dark:text-gray-600">© 2026 컨텐츠 디벨로퍼</p>
      </div>
    </div>
  )
}
