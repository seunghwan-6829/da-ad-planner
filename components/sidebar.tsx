'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  BookOpen,
  ChevronRight,
  Clapperboard,
  ExternalLink,
  FileAudio,
  FileCode,
  FileEdit,
  FileText,
  Images,
  Image as ImageIcon,
  LayoutDashboard,
  LogOut,
  Shield,
  User,
  Users,
  Video,
  Wand2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/lib/auth-context'
import { Button } from '@/components/ui/button'

const navigationTop = [
  { name: '대시보드', href: '/', icon: LayoutDashboard },
  { name: 'AI 광고 기획서', href: '/plans', icon: FileText },
  { name: '광고주 관리', href: '/advertisers', icon: Users },
  { name: 'BP소재', href: '/templates', icon: FileCode },
  { name: '이미지 보드', href: '/image-board', icon: Images },
]

const navigationBottom = [
  { name: '이미지 베리에이션', href: '/image-variation', icon: ImageIcon },
  { name: '영상 베리에이션', href: '/ai-variation', icon: Video },
  { name: '영상 분석 및 제작', href: '/video-production', icon: Wand2 },
  { name: '기획안 제작', href: '/project-plans', icon: Clapperboard },
  { name: 'AI 학습', href: '/ai-test', icon: BookOpen },
]

const externalLinks = [
  { name: 'DA/숏폼 기획안', href: 'https://rebootadvert.vercel.app/', icon: Video },
  { name: 'SRT 소스 제작', href: 'https://srt-source-planner.vercel.app/', icon: FileAudio },
  { name: 'AI PDF 편집기', href: 'https://pdf-editor-sand-seven.vercel.app/', icon: FileEdit },
]

export function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const { user, profile, isAdmin, signOut } = useAuth()

  function handleSignOut() {
    signOut()
  }

  return (
    <div className="flex h-full w-64 flex-col border-r bg-white">
      <div className="flex h-16 items-center border-b px-6">
        <h1 className="text-xl font-bold text-primary">DA 광고 플래너</h1>
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
                isActive ? 'bg-primary text-white' : 'text-gray-700 hover:bg-gray-100'
              )}
            >
              <item.icon className="h-5 w-5" />
              {item.name}
              {isActive && <ChevronRight className="ml-auto h-4 w-4" />}
            </Link>
          )
        })}

        <div className="my-3 border-t pt-3">
          <p className="mb-2 px-3 text-xs font-medium uppercase text-gray-400">제작 도구</p>
        </div>

        {navigationBottom.map((item) => {
          const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href))

          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive ? 'bg-primary text-white' : 'text-gray-700 hover:bg-gray-100'
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
              pathname === '/admin' ? 'bg-red-600 text-white' : 'text-red-600 hover:bg-red-50'
            )}
          >
            <Shield className="h-5 w-5" />
            관리자
            {pathname === '/admin' && <ChevronRight className="ml-auto h-4 w-4" />}
          </Link>
        )}

        <div className="my-4 border-t pt-4">
          <p className="mb-2 px-3 text-xs font-medium uppercase text-gray-400">외부 도구</p>
          {externalLinks.map((item) => (
            <a
              key={item.name}
              href={item.href}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100"
            >
              <item.icon className="h-5 w-5 text-gray-500" />
              {item.name}
              <ExternalLink className="ml-auto h-3 w-3 text-gray-400" />
            </a>
          ))}
        </div>
      </nav>

      <div className="space-y-3 border-t p-4">
        {user && profile && (
          <div className="flex items-center gap-3 px-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
              <User className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{profile.name || profile.email}</p>
              <p className="text-xs text-muted-foreground">
                {profile.role === 'admin' ? '관리자' : profile.role === 'approved' ? '승인됨' : '대기중'}
              </p>
            </div>
          </div>
        )}

        {user ? (
          <Button variant="outline" size="sm" className="w-full" onClick={handleSignOut}>
            <LogOut className="mr-2 h-4 w-4" />
            로그아웃
          </Button>
        ) : (
          <Button size="sm" className="w-full" onClick={() => router.push('/login')}>
            로그인
          </Button>
        )}

        <p className="text-center text-xs text-gray-500">© 2026 DA Ad Planner</p>
      </div>
    </div>
  )
}
