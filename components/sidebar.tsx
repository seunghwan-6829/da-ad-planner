'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  ChevronRight,
  Clapperboard,
  FileCode,
  Images,
  Image as ImageIcon,
  LayoutDashboard,
  LogOut,
  Settings,
  Shield,
  User,
  Video,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/lib/auth-context'
import { Button } from '@/components/ui/button'

const navigationTop = [
  { name: '대시보드', href: '/', icon: LayoutDashboard },
  { name: 'BP소재', href: '/templates', icon: FileCode },
  { name: '영상 보드', href: '/video-board', icon: Video },
  { name: '이미지 보드', href: '/image-board', icon: Images },
]

const navigationBottom = [
  { name: '이미지 베리에이션', href: '/image-variation', icon: ImageIcon },
  { name: '영상 베리에이션', href: '/ai-variation', icon: Video },
  { name: '기획안 제작', href: '/project-plans', icon: Clapperboard },
]

export function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const { user, profile, isAdmin, signOut } = useAuth()

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
        {navigationTop.map((item) => {
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
