'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  BarChart3, Loader2, Plus, Trash2, RefreshCw, Users, Eye, ExternalLink,
  TrendingUp, TrendingDown, Image as ImageIcon, AlertCircle, Activity, Heart, MessageCircle, Bookmark, Share2, MapPin,
} from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import {
  getIgAccounts, getAccountSnapshots, getMedia, getLatestMediaMetrics, getLatestDemographics,
} from '@/lib/api/instagram'
import { IgAccount, IgAccountSnapshot, IgDemographicsSnapshot, IgMedia, IgMediaMetric } from '@/lib/ig/types'

const RANGES = [
  { key: 7, label: '7일' },
  { key: 30, label: '30일' },
  { key: 90, label: '90일' },
]

const num = (n: number | null | undefined) => (n ?? 0).toLocaleString()

export default function InstagramPage() {
  const { isAdmin } = useAuth()
  const [accounts, setAccounts] = useState<IgAccount[]>([])
  const [selected, setSelected] = useState<IgAccount | null>(null)
  const [loadingAccounts, setLoadingAccounts] = useState(true)
  const [banner, setBanner] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null)

  // 선택 계정 데이터
  const [range, setRange] = useState(30)
  const [snapshots, setSnapshots] = useState<IgAccountSnapshot[]>([])
  const [media, setMedia] = useState<IgMedia[]>([])
  const [metrics, setMetrics] = useState<Map<string, IgMediaMetric>>(new Map())
  const [demo, setDemo] = useState<Record<string, IgDemographicsSnapshot>>({})
  const [loadingData, setLoadingData] = useState(false)
  const [syncing, setSyncing] = useState(false)

  // 연동 결과 배너(쿼리스트링)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    if (q.get('connected')) setBanner({ type: 'ok', msg: `인스타그램 계정 ${q.get('connected')}개가 연동됐어요.` })
    else if (q.get('error')) {
      const e = q.get('error') || ''
      const msg =
        e === 'no_ig_account' ? '연결된 인스타 프로페셔널 계정을 찾지 못했어요. (페이지 연결/테스터 승인 확인)'
        : e === 'config' ? '메타 개발자 앱 연결이 아직 안 됐어요 — Vercel 환경변수에 META_APP_ID · META_APP_SECRET · OAUTH_REDIRECT_URI 3개를 등록하고 재배포하면 [계정 연동]이 활성화됩니다. (developers.facebook.com에서 앱 생성 → Facebook 로그인 제품 추가)'
        : e === 'state_mismatch' ? '보안 검증(state)에 실패했어요. 다시 시도해 주세요.'
        : `연동 실패: ${e}`
      setBanner({ type: 'err', msg })
    }
    if (q.get('connected') || q.get('error')) window.history.replaceState(null, '', '/instagram')
  }, [])

  const loadAccounts = useCallback(async () => {
    setLoadingAccounts(true)
    try {
      const list = await getIgAccounts()
      setAccounts(list)
      setSelected((cur) => cur || list[0] || null)
    } catch {
      /* 미설정 시 빈 목록 */
    } finally {
      setLoadingAccounts(false)
    }
  }, [])

  useEffect(() => { loadAccounts() }, [loadAccounts])

  const loadData = useCallback(async (acc: IgAccount, days: number) => {
    setLoadingData(true)
    try {
      const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString()
      const [snaps, med, mtr, dem] = await Promise.all([
        getAccountSnapshots(acc.id, since),
        getMedia(acc.id),
        getLatestMediaMetrics(acc.id),
        getLatestDemographics(acc.id),
      ])
      setSnapshots(snaps); setMedia(med); setMetrics(mtr); setDemo(dem)
    } catch {
      setSnapshots([]); setMedia([]); setMetrics(new Map()); setDemo({})
    } finally {
      setLoadingData(false)
    }
  }, [])

  useEffect(() => { if (selected) loadData(selected, range) }, [selected, range, loadData])

  async function handleSync() {
    if (!selected) return
    setSyncing(true)
    try {
      const res = await fetch('/api/instagram/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ account_id: selected.id }) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) setBanner({ type: 'err', msg: j.error || '동기화에 실패했어요.' })
      else {
        const skipped = (j.skipped || []).length
        setBanner({ type: 'ok', msg: `동기화 완료 (${j.calls}콜${skipped ? `, 일부 지표 ${skipped}개 스킵` : ''}).` })
        await loadData(selected, range)
        await loadAccounts()
      }
    } finally {
      setSyncing(false)
    }
  }

  async function handleDisconnect(acc: IgAccount) {
    if (!confirm(`@${acc.ig_username || acc.name} 연동을 해제할까요? (수집된 이력은 남습니다)`)) return
    await fetch('/api/instagram/accounts', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ account_id: acc.id }) })
    if (selected?.id === acc.id) setSelected(null)
    await loadAccounts()
  }

  function handleConnect() {
    window.location.href = '/api/auth/instagram/start'
  }

  const latest = snapshots[snapshots.length - 1]
  const first = snapshots[0]
  const delta = (key: keyof IgAccountSnapshot) =>
    latest && first ? (Number(latest[key] ?? 0) - Number(first[key] ?? 0)) : 0

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <div className="flex h-screen">
        {/* ── 좌: 계정 목록 ── */}
        <div className="w-72 border-r bg-white dark:bg-gray-900 dark:border-gray-800 flex flex-col">
          <div className="p-4 border-b dark:border-gray-800">
            <div className="flex items-center gap-2 mb-1">
              <BarChart3 className="h-5 w-5 text-pink-500" />
              <h1 className="text-lg font-bold dark:text-white">인스타 성과</h1>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">클라이언트 계정별 성과 시계열 대시보드</p>
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            {loadingAccounts ? (
              <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-pink-400" /></div>
            ) : accounts.length === 0 ? (
              <div className="text-center py-8">
                <BarChart3 className="h-8 w-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                <p className="text-sm text-gray-400 dark:text-gray-500">연동된 계정이 없습니다</p>
              </div>
            ) : (
              accounts.map((a) => (
                <div
                  key={a.id}
                  onClick={() => setSelected(a)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg mb-1 cursor-pointer transition-colors group ${selected?.id === a.id ? 'bg-pink-500 text-white' : 'hover:bg-gray-100 dark:hover:bg-gray-800'}`}
                >
                  {a.profile_picture_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.profile_picture_url} alt="" className="w-8 h-8 rounded-full object-cover" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white text-xs font-bold">{(a.ig_username || a.name || '?')[0]?.toUpperCase()}</div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium truncate ${selected?.id === a.id ? '' : 'dark:text-gray-200'}`}>@{a.ig_username || 'unknown'}</p>
                    <p className={`text-xs truncate ${selected?.id === a.id ? 'text-pink-200' : 'text-gray-400 dark:text-gray-500'}`}>
                      {a.status === 'token_expired' ? '⚠ 토큰 만료 — 재연동 필요' : a.name || ' '}
                    </p>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); handleDisconnect(a) }} className={`opacity-0 group-hover:opacity-100 p-1 rounded transition-opacity ${selected?.id === a.id ? 'hover:bg-pink-600' : 'hover:bg-gray-200 dark:hover:bg-gray-700'}`}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="p-3 border-t dark:border-gray-800">
            {isAdmin ? (
              <button onClick={handleConnect} className="w-full flex items-center justify-center gap-2 rounded-lg bg-pink-500 hover:bg-pink-600 text-white text-sm font-medium py-2">
                <Plus className="h-4 w-4" /> 계정 연동
              </button>
            ) : (
              <p className="text-[11px] text-center text-gray-400">계정 연동은 관리자만 가능해요</p>
            )}
            <p className="mt-2 text-[10px] leading-relaxed text-gray-400">
              메타 공식 Graph API 연동. 프로페셔널(비즈니스/크리에이터) 계정 + 페이지 연결 + 앱 테스터 승인이 필요해요.
            </p>
          </div>
        </div>

        {/* ── 우: 대시보드 ── */}
        <div className="flex-1 overflow-y-auto">
          {banner && (
            <div className={`m-4 flex items-start gap-2 rounded-lg border p-3 text-sm ${banner.type === 'ok' ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300' : 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300'}`}>
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" /> <span className="flex-1">{banner.msg}</span>
              <button onClick={() => setBanner(null)} className="text-xs underline">닫기</button>
            </div>
          )}

          {!selected ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <BarChart3 className="h-16 w-16 text-gray-200 dark:text-gray-700 mx-auto mb-4" />
                <h2 className="text-xl font-bold text-gray-400 dark:text-gray-500 mb-2">계정을 선택하세요</h2>
                <p className="text-sm text-gray-400 dark:text-gray-500">왼쪽에서 인스타그램 계정을 선택하면<br />성과 대시보드가 표시됩니다</p>
              </div>
            </div>
          ) : (
            <div className="p-6">
              {/* 헤더 */}
              <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
                <div className="flex items-center gap-4">
                  {selected.profile_picture_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={selected.profile_picture_url} alt="" className="w-14 h-14 rounded-full border-2 border-pink-300 object-cover" />
                  ) : (
                    <div className="w-14 h-14 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white text-xl font-bold">{(selected.ig_username || '?')[0]?.toUpperCase()}</div>
                  )}
                  <div>
                    <h2 className="text-xl font-bold dark:text-white">@{selected.ig_username || 'unknown'}</h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {selected.name || ''}{latest ? ` · 마지막 수집 ${new Date(latest.captured_at).toLocaleString('ko-KR')}` : ''}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex rounded-lg border dark:border-gray-700 overflow-hidden">
                    {RANGES.map((r) => (
                      <button key={r.key} onClick={() => setRange(r.key)} className={`px-3 py-1.5 text-xs ${range === r.key ? 'bg-pink-500 text-white' : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300'}`}>{r.label}</button>
                    ))}
                  </div>
                  <button onClick={handleSync} disabled={syncing} className="flex items-center gap-1.5 rounded-lg bg-pink-500 hover:bg-pink-600 disabled:opacity-50 text-white text-sm font-medium px-3 py-1.5">
                    {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} 지금 동기화
                  </button>
                </div>
              </div>

              {loadingData ? (
                <div className="flex justify-center py-20"><Loader2 className="h-7 w-7 animate-spin text-pink-500" /></div>
              ) : snapshots.length === 0 ? (
                <div className="rounded-xl border dark:border-gray-800 bg-white dark:bg-gray-900 p-10 text-center">
                  <Activity className="h-10 w-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
                  <p className="font-medium dark:text-gray-200">아직 수집된 데이터가 없어요</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">‘지금 동기화’를 누르면 첫 스냅샷을 떠요. 시계열은 매일 자동 누적됩니다.</p>
                  {selected.status === 'token_expired' && <p className="text-sm text-red-500 mt-2">⚠ 토큰이 만료됐어요. 관리자가 계정을 다시 연동해야 합니다.</p>}
                </div>
              ) : (
                <>
                  {/* 카드 */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                    <StatCard icon={<Users className="h-5 w-5 text-pink-500" />} label="팔로워" value={latest?.followers_count} delta={delta('followers_count')} bg="bg-pink-100 dark:bg-pink-900/30" />
                    <StatCard icon={<TrendingUp className="h-5 w-5 text-blue-500" />} label="팔로잉" value={latest?.follows_count} delta={delta('follows_count')} bg="bg-blue-100 dark:bg-blue-900/30" />
                    <StatCard icon={<ImageIcon className="h-5 w-5 text-purple-500" />} label="게시물" value={latest?.media_count} delta={delta('media_count')} bg="bg-purple-100 dark:bg-purple-900/30" />
                  </div>

                  {/* 추이 차트 */}
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
                    <ChartCard title="팔로워 성장" color="#ec4899" data={snapshots.map((s) => ({ t: new Date(s.captured_at).getTime(), v: s.followers_count }))} />
                    <ChartCard title="도달(reach)" color="#3b82f6" data={snapshots.map((s) => ({ t: new Date(s.captured_at).getTime(), v: s.reach }))} />
                    <ChartCard title="조회수(views)" color="#8b5cf6" data={snapshots.map((s) => ({ t: new Date(s.captured_at).getTime(), v: s.views }))} />
                  </div>

                  {/* 인기 게시물 */}
                  <TopPosts media={media} metrics={metrics} />

                  {/* 인구통계 */}
                  <Demographics demo={demo} />
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function StatCard({ icon, label, value, delta, bg }: { icon: React.ReactNode; label: string; value: number | null | undefined; delta: number; bg: string }) {
  const up = delta > 0, down = delta < 0
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border dark:border-gray-800 p-5">
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${bg}`}>{icon}</div>
        <div className="flex-1">
          <p className="text-2xl font-bold dark:text-white">{num(value)}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
        </div>
        {delta !== 0 && (
          <span className={`flex items-center gap-0.5 text-xs font-semibold ${up ? 'text-green-500' : down ? 'text-red-500' : 'text-gray-400'}`}>
            {up ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
            {up ? '+' : ''}{delta.toLocaleString()}
          </span>
        )}
      </div>
    </div>
  )
}

function ChartCard({ title, color, data }: { title: string; color: string; data: { t: number; v: number | null }[] }) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border dark:border-gray-800 p-4">
      <p className="text-sm font-bold dark:text-gray-200 mb-2">{title}</p>
      <LineChart data={data} color={color} />
    </div>
  )
}

function LineChart({ data, color, height = 120 }: { data: { t: number; v: number | null }[]; color: string; height?: number }) {
  const pts = data.filter((d) => d.v != null) as { t: number; v: number }[]
  if (pts.length < 2) {
    return <div className="flex items-center justify-center text-[11px] text-gray-400" style={{ height }}>데이터가 더 쌓이면 추이가 표시돼요</div>
  }
  const W = 600, H = height, pad = 10
  const xs = pts.map((p) => p.t), vs = pts.map((p) => p.v)
  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const minV = Math.min(...vs), maxV = Math.max(...vs)
  const x = (t: number) => pad + ((t - minX) / (maxX - minX || 1)) * (W - 2 * pad)
  const y = (v: number) => H - pad - ((v - minV) / (maxV - minV || 1)) * (H - 2 * pad)
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ')
  const area = `${line} L ${x(maxX).toFixed(1)} ${H - pad} L ${x(minX).toFixed(1)} ${H - pad} Z`
  const gid = `g-${color.replace('#', '')}`
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }} preserveAspectRatio="none">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(pts[pts.length - 1].t)} cy={y(pts[pts.length - 1].v)} r="3" fill={color} />
    </svg>
  )
}

function TopPosts({ media, metrics }: { media: IgMedia[]; metrics: Map<string, IgMediaMetric> }) {
  const eng = (m: IgMedia) => {
    const mt = metrics.get(m.ig_media_id)
    return (mt?.total_interactions ?? 0) || ((mt?.like_count ?? 0) + (mt?.comments_count ?? 0))
  }
  const rows = [...media].sort((a, b) => eng(b) - eng(a)).slice(0, 10)
  if (!rows.length) return null
  return (
    <div className="mb-6">
      <h3 className="text-lg font-bold dark:text-white mb-3">인기 게시물 (인게이지먼트순)</h3>
      <div className="overflow-x-auto rounded-xl border dark:border-gray-800 bg-white dark:bg-gray-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-400 border-b dark:border-gray-800">
              <th className="p-3">게시물</th>
              <th className="p-3">유형</th>
              <th className="p-3 text-right"><Heart className="h-3.5 w-3.5 inline" /></th>
              <th className="p-3 text-right"><MessageCircle className="h-3.5 w-3.5 inline" /></th>
              <th className="p-3 text-right"><Eye className="h-3.5 w-3.5 inline" /></th>
              <th className="p-3 text-right"><Bookmark className="h-3.5 w-3.5 inline" /></th>
              <th className="p-3 text-right"><Share2 className="h-3.5 w-3.5 inline" /></th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => {
              const mt = metrics.get(m.ig_media_id)
              return (
                <tr key={m.ig_media_id} className="border-b last:border-0 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      {(m.thumbnail_url || m.media_url) ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={m.thumbnail_url || m.media_url || ''} alt="" className="w-9 h-9 rounded object-cover bg-gray-100 dark:bg-gray-800" />
                      ) : <div className="w-9 h-9 rounded bg-gray-100 dark:bg-gray-800" />}
                      <span className="line-clamp-1 max-w-[220px] text-gray-600 dark:text-gray-300 text-xs">{m.caption || '—'}</span>
                    </div>
                  </td>
                  <td className="p-3 text-xs text-gray-500 dark:text-gray-400">{m.media_product_type || m.media_type || '—'}</td>
                  <td className="p-3 text-right dark:text-gray-200">{num(mt?.like_count ?? null)}</td>
                  <td className="p-3 text-right dark:text-gray-200">{num(mt?.comments_count ?? null)}</td>
                  <td className="p-3 text-right dark:text-gray-200">{num(mt?.reach ?? null)}</td>
                  <td className="p-3 text-right dark:text-gray-200">{num(mt?.saved ?? null)}</td>
                  <td className="p-3 text-right dark:text-gray-200">{num(mt?.shares ?? null)}</td>
                  <td className="p-3">
                    {m.permalink && <a href={m.permalink} target="_blank" rel="noopener noreferrer" className="text-pink-500 hover:underline"><ExternalLink className="h-3.5 w-3.5" /></a>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Demographics({ demo }: { demo: Record<string, IgDemographicsSnapshot> }) {
  const blocks: { type: string; title: string; icon: React.ReactNode }[] = [
    { type: 'age_gender', title: '연령·성별', icon: <Users className="h-4 w-4 text-pink-500" /> },
    { type: 'country', title: '상위 국가', icon: <MapPin className="h-4 w-4 text-blue-500" /> },
    { type: 'city', title: '상위 도시', icon: <MapPin className="h-4 w-4 text-purple-500" /> },
  ]
  const present = blocks.filter((b) => demo[b.type]?.breakdown && Object.keys(demo[b.type].breakdown).length)
  if (!present.length) return null
  return (
    <div>
      <h3 className="text-lg font-bold dark:text-white mb-3">팔로워 인구통계</h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {present.map((b) => (
          <div key={b.type} className="bg-white dark:bg-gray-900 rounded-xl border dark:border-gray-800 p-4">
            <p className="flex items-center gap-1.5 text-sm font-bold dark:text-gray-200 mb-3">{b.icon} {b.title}</p>
            <BarList data={demo[b.type].breakdown} />
          </div>
        ))}
      </div>
    </div>
  )
}

function BarList({ data }: { data: Record<string, number> }) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]).slice(0, 8)
  const max = Math.max(...entries.map((e) => e[1]), 1)
  return (
    <div className="space-y-2">
      {entries.map(([label, v]) => (
        <div key={label}>
          <div className="flex justify-between text-[11px] text-gray-500 dark:text-gray-400 mb-0.5">
            <span className="truncate">{label}</span><span>{v.toLocaleString()}</span>
          </div>
          <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
            <div className="h-full rounded-full bg-gradient-to-r from-pink-400 to-purple-500" style={{ width: `${(v / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}
