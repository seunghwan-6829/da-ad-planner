'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Megaphone, Clapperboard, Network, Sparkles, TrendingUp, ArrowRight, Loader2, Folder } from 'lucide-react'
import { getClients, Client } from '@/lib/api/clients'

type Target = { id: string; label: string; category?: string | null }

export default function DashboardPage() {
  const [loading, setLoading] = useState(true)
  const [change, setChange] = useState<{ newCount: number; endedCount: number }>({ newCount: 0, endedCount: 0 })
  const [total, setTotal] = useState(0)
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [targets, setTargets] = useState<Target[]>([])
  const [clients, setClients] = useState<Client[]>([])

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    try {
      const [chg, stats, tgs, cls] = await Promise.all([
        fetch('/api/meta-ad/changes?days=7').then((r) => (r.ok ? r.json() : { newCount: 0, endedCount: 0 })).catch(() => ({ newCount: 0, endedCount: 0 })),
        fetch('/api/meta-ad/stats').then((r) => (r.ok ? r.json() : { counts: {}, total: 0 })).catch(() => ({ counts: {}, total: 0 })),
        fetch('/api/meta-ad/targets').then((r) => (r.ok ? r.json() : [])).catch(() => []),
        getClients().catch(() => [] as Client[]),
      ])
      setChange({ newCount: chg.newCount || 0, endedCount: chg.endedCount || 0 })
      setTotal(stats.total || 0)
      setCounts(stats.counts || {})
      setTargets(Array.isArray(tgs) ? tgs : [])
      setClients(cls || [])
    } catch (e) {
      console.error('대시보드 로드 실패:', e)
    } finally {
      setLoading(false)
    }
  }

  const labelOf = (id: string) => targets.find((t) => t.id === id)?.label || '(브랜드)'
  const topBrands = Object.entries(counts)
    .map(([id, n]) => ({ id, label: labelOf(id), n }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 8)

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-gray-400">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> 불러오는 중…
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* 헤더 */}
      <div>
        <h1 className="text-3xl font-bold dark:text-gray-100">컨텐츠 디벨로퍼</h1>
        <p className="mt-2 text-gray-500 dark:text-gray-400">경쟁사 광고 수집부터 기획까지 한눈에 관리하세요</p>
      </div>

      {/* 빠른 이동 */}
      <div className="grid gap-4 md:grid-cols-3">
        <QuickCard href="/meta-ad-crawler" icon={<Megaphone className="h-6 w-6 text-primary" />} bg="bg-primary/10" title="메타 광고 크롤러" desc="경쟁사 광고 수집·열람" />
        <QuickCard href="/project-plans" icon={<Clapperboard className="h-6 w-6 text-indigo-600" />} bg="bg-indigo-100 dark:bg-indigo-900/30" title="기획안 제작" desc="브랜드별 기획안 관리" />
        <QuickCard href="/plan-mindmap" icon={<Network className="h-6 w-6 text-violet-600" />} bg="bg-violet-100 dark:bg-violet-900/30" title="기획 마인드맵" desc="소재를 7갈래로 분해" />
      </div>

      {/* 통계 */}
      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="이번 주 신규 광고" value={change.newCount} accent="text-green-600" icon={<Sparkles className="h-7 w-7 text-green-500" />} />
        <StatCard label="전체 수집 광고" value={total} accent="text-blue-600" icon={<Megaphone className="h-7 w-7 text-blue-500" />} />
        <StatCard label="추적 브랜드" value={targets.length} accent="text-violet-600" icon={<TrendingUp className="h-7 w-7 text-violet-500" />} />
        <StatCard label="등록 클라이언트" value={clients.length} accent="text-amber-600" icon={<Folder className="h-7 w-7 text-amber-500" />} />
      </div>

      {/* 2단: 브랜드별 수집 / 클라이언트 */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* 브랜드별 수집 광고 Top */}
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold dark:text-gray-100">브랜드별 수집 광고</h2>
              <p className="text-xs text-gray-400">
                이번 주 신규 <b className="text-green-600">{change.newCount}</b>
                {change.endedCount > 0 && (
                  <>
                    {' '}· 종료 <b className="text-gray-500">{change.endedCount}</b>
                  </>
                )}
              </p>
            </div>
            <Link href="/meta-ad-crawler" className="flex items-center gap-1 text-sm text-primary hover:underline">
              전체보기 <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          {topBrands.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-400">아직 수집된 광고가 없습니다.</p>
          ) : (
            <div className="space-y-2">
              {topBrands.map((b) => {
                const max = topBrands[0].n || 1
                return (
                  <div key={b.id} className="flex items-center gap-3">
                    <span className="w-28 shrink-0 truncate text-sm text-gray-700 dark:text-gray-200" title={b.label}>
                      {b.label}
                    </span>
                    <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(4, (b.n / max) * 100)}%` }} />
                    </div>
                    <span className="w-10 shrink-0 text-right text-sm font-semibold tabular-nums text-gray-600 dark:text-gray-300">{b.n}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* 클라이언트(기획안 제작) */}
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold dark:text-gray-100">기획안 제작 · 마인드맵</h2>
              <p className="text-xs text-gray-400">등록 클라이언트 {clients.length}곳</p>
            </div>
            <Link href="/project-plans" className="flex items-center gap-1 text-sm text-primary hover:underline">
              전체보기 <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          {clients.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-400">등록된 클라이언트가 없습니다.</p>
          ) : (
            <div className="space-y-1">
              {clients.slice(0, 8).map((c) => (
                <div key={c.id} className="flex items-center gap-2 rounded-lg p-2 hover:bg-gray-50 dark:hover:bg-gray-800">
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: c.color || '#3B82F6' }} />
                  <span className="flex-1 truncate text-sm dark:text-gray-200">{c.name}</span>
                  <Link href={`/project-plans?client=${c.id}`} className="rounded px-2 py-0.5 text-xs text-gray-400 hover:bg-gray-100 hover:text-primary dark:hover:bg-gray-700">
                    기획안
                  </Link>
                  <Link href="/plan-mindmap" className="rounded px-2 py-0.5 text-xs text-gray-400 hover:bg-gray-100 hover:text-violet-600 dark:hover:bg-gray-700">
                    마인드맵
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function QuickCard({ href, icon, bg, title, desc }: { href: string; icon: React.ReactNode; bg: string; title: string; desc: string }) {
  return (
    <Link href={href}>
      <div className="flex cursor-pointer items-center gap-4 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 shadow-sm transition-shadow hover:border-primary hover:shadow-lg">
        <div className={`rounded-full p-3 ${bg}`}>{icon}</div>
        <div>
          <h3 className="font-semibold dark:text-gray-100">{title}</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">{desc}</p>
        </div>
      </div>
    </Link>
  )
}

function StatCard({ label, value, accent, icon }: { label: string; value: number; accent: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
          <p className={`text-3xl font-bold ${accent}`}>{value.toLocaleString()}</p>
        </div>
        {icon}
      </div>
    </div>
  )
}
