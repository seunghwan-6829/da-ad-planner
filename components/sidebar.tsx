'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { 
  LayoutDashboard, 
  FileText, 
  Users, 
  FileCode,
  BookOpen,
  ChevronRight,
  ExternalLink,
  Video,
  FileAudio,
  FileEdit
} from 'lucide-react'
import { cn } from '@/lib/utils'

const navigation = [
  { name: '대시보드', href: '/', icon: LayoutDashboard },
  { name: '광고 기획서', href: '/plans', icon: FileText },
  { name: '광고주 관리', href: '/advertisers', icon: Users },
  { name: '템플릿', href: '/templates', icon: FileCode },
  { name: 'AI 학습', href: '/ai-test', icon: BookOpen },
]

const externalLinks = [
  { name: 'DA/숏폼 기획안', href: 'https://rebootadvert.vercel.app/', icon: Video },
  { name: 'SRT 소스 제작', href: 'https://srt-source-planner.vercel.app/', icon: FileAudio },
  { name: 'AI PDF 편집기', href: 'https://pdf-editor-sand-seven.vercel.app/', icon: FileEdit },
]

export function Sidebar() {
  const pathname = usePathname()

  return (
    <div className="flex h-full w-64 flex-col bg-white border-r">
      <div className="flex h-16 items-center px-6 border-b">
        <h1 className="text-xl font-bold text-primary">DA 광고 플래너</h1>
      </div>
      <nav className="flex-1 space-y-1 p-4 overflow-y-auto">
        {navigation.map((item) => {
          const isActive = pathname === item.href || 
            (item.href !== '/' && pathname.startsWith(item.href))
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary text-white'
                  : 'text-gray-700 hover:bg-gray-100'
              )}
            >
              <item.icon className="h-5 w-5" />
              {item.name}
              {isActive && <ChevronRight className="ml-auto h-4 w-4" />}
            </Link>
          )
        })}

        {/* 외부 링크 구분선 */}
        <div className="my-4 border-t pt-4">
          <p className="px-3 mb-2 text-xs font-medium text-gray-400 uppercase">
            외부 도구
          </p>
          {externalLinks.map((item) => (
            <a
              key={item.name}
              href={item.href}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors"
            >
              <item.icon className="h-5 w-5 text-gray-500" />
              {item.name}
              <ExternalLink className="ml-auto h-3 w-3 text-gray-400" />
            </a>
          ))}
        </div>
      </nav>
      <div className="p-4 border-t">
        <p className="text-xs text-gray-500">
          © 2026 DA Ad Planner
        </p>
      </div>
    </div>
  )
}
