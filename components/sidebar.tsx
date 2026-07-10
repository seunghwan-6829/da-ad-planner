'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  Activity,
  BarChart3,
  Bell,
  Camera,
  ChevronRight,
  Chrome,
  Clapperboard,
  Coffee,
  FileCode,
  Film,
  Images,
  LayoutDashboard,
  Lightbulb,
  ListChecks,
  Lock,
  LogOut,
  Megaphone,
  Network,
  Radio,
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
  { name: '인스타 성과', href: '/instagram', icon: BarChart3 },
  { name: '데이터 추적', href: '/data-tracking', icon: Activity },
  { name: '온드미디어 크롤러', href: '/owned-media', icon: Radio },
  { name: '메타 광고 크롤러', href: '/meta-ad-crawler', icon: Megaphone },
  { name: '구글 광고 크롤러', href: '/google-ads', icon: Chrome },
  { name: '네이버 카페 자동화', href: '/naver-cafe', icon: Coffee },
]

const navigationBottom = [
  { name: '제작 리스트', href: '/production-list', icon: ListChecks },
  { name: '기획안 제작', href: '/project-plans', icon: Clapperboard },
  { name: '기획 마인드맵', href: '/plan-mindmap', icon: Network },
  { name: '기획안 아이디어', href: '/plan-ideas', icon: Lightbulb },
  { name: '컨텐츠 가이드', href: '/content-guide', icon: Film },
  { name: '모델 촬영 가이드', href: '/shooting-guide', icon: Camera },
  // 참고용 보드류는 맨 하단(모델 촬영 가이드 아래)으로
  { name: 'BP소재', href: '/templates', icon: FileCode },
  { name: '이미지 보드', href: '/image-board', icon: Images },
  { name: '영상 보드', href: '/video-board', icon: Video },
]

type MetaChange = { newCount: number; endedCount: number; latest: string | null }

// 활성 메뉴 판정: '/'(대시보드)는 정확히 '/'일 때만. 그 외는 정확히 일치하거나 서브경로(href + '/')일 때만.
// → /data-tracking 에서는 '데이터 추적'만 active, '대시보드'는 절대 active 안 됨.
function isNavActive(pathname: string | null, href: string): boolean {
  const p = pathname || '/'
  if (href === '/') return p === '/'
  return p === href || p.startsWith(href + '/')
}

export function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const { user, profile, isAdmin, canMetaAd, signOut } = useAuth()

  // ⚠️ 하드 리로드(F5) 시 usePathname()이 일시적으로 '/'로 잡혀 '대시보드'가 잘못 활성화되는
  //    하이드레이션 타이밍 버그 방지 → 마운트/경로변경 후 실제 URL(window.location)로 활성 경로 동기화.
  const [activePath, setActivePath] = useState(pathname)
  useEffect(() => {
    setActivePath(window.location.pathname)
  }, [pathname])

  // 크롤러 권한 통일: can_meta_ad(또는 관리자)면 메타·구글·온드 3종 모두 노출.
  const crawlerHrefs = ['/meta-ad-crawler', '/owned-media', '/google-ads']
  // 네이버 카페 자동화: 모두에게 보이되 관리자 외에는 잠금(락 아이콘, 클릭 불가).
  const lockedHrefs = isAdmin ? [] : ['/naver-cafe']
  const topItems = navigationTop.filter((item) => !crawlerHrefs.includes(item.href) || canMetaAd)

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
    !activePath.startsWith('/meta-ad-crawler')

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
        <img src="/logo.png" alt="로고" className="h-7 w-auto rounded" />
        <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">컨텐츠 디벨로퍼</h1>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto p-4">
        {topItems.map((item) => {
          // 잠금 메뉴(예: 네이버 카페 자동화 — 관리자 전용): 보이긴 하지만 클릭 불가 + 락 아이콘.
          if (lockedHrefs.includes(item.href)) {
            return (
              <div
                key={item.name}
                title="관리자 전용 기능이에요"
                className="flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-gray-400 dark:text-gray-600"
              >
                <item.icon className="h-5 w-5" />
                {item.name}
                <Lock className="ml-auto h-3.5 w-3.5" />
              </div>
            )
          }
          const isActive = isNavActive(activePath, item.href)
          const className = cn(
            'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
            isActive ? 'bg-primary text-white' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
          )
          return (
            <Link
              key={item.name}
              href={item.href}
              className={className}
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
          const isActive = isNavActive(activePath, item.href)

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
              activePath === '/admin' ? 'bg-red-600 text-white' : 'text-red-600 hover:bg-red-50 dark:hover:bg-red-950'
            )}
          >
            <Shield className="h-5 w-5" />
            관리자
            {activePath === '/admin' && <ChevronRight className="ml-auto h-4 w-4" />}
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
