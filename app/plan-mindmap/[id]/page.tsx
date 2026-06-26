'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, ExternalLink, Plus, Minus, Maximize2, Loader2, Hand } from 'lucide-react'
import { getMindmap, Mindmap } from '@/lib/api/mindmaps'

const WORLD_W = 1320
const WORLD_H = 940
const CENTER = { x: WORLD_W / 2, y: WORLD_H / 2 }
const RADIUS = 350

// 7노드 표시 순서 + 색
const NODE_STYLE: Record<string, { dot: string; ring: string }> = {
  develop: { dot: '#3B82F6', ring: 'border-blue-300' },
  storytelling: { dot: '#8B5CF6', ring: 'border-violet-300' },
  script: { dot: '#10B981', ring: 'border-emerald-300' },
  plan: { dot: '#F59E0B', ring: 'border-amber-300' },
  segment: { dot: '#EC4899', ring: 'border-pink-300' },
  weakness: { dot: '#F43F5E', ring: 'border-rose-300' },
  strength: { dot: '#14B8A6', ring: 'border-teal-300' },
}
const ORDER = ['develop', 'storytelling', 'script', 'plan', 'segment', 'weakness', 'strength']

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export default function MindmapCanvasPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const [mm, setMm] = useState<Mindmap | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'notfound'>('loading')

  const viewportRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState({ x: 0, y: 0, k: 1 })
  const dragging = useRef(false)
  const last = useRef({ x: 0, y: 0 })
  const spaceHeld = useRef(false)
  const [grabbing, setGrabbing] = useState(false)

  useEffect(() => {
    if (!params?.id) return
    let alive = true
    getMindmap(params.id)
      .then((d) => {
        if (!alive) return
        if (d) {
          setMm(d)
          setState('ready')
        } else setState('notfound')
      })
      .catch(() => alive && setState('notfound'))
    return () => {
      alive = false
    }
  }, [params?.id])

  const fitView = useCallback(() => {
    const el = viewportRef.current
    if (!el) return
    const W = el.clientWidth
    const H = el.clientHeight
    const k = Math.min(W / WORLD_W, H / WORLD_H) * 0.92
    setView({ k, x: (W - WORLD_W * k) / 2, y: (H - WORLD_H * k) / 2 })
  }, [])

  // 데이터 로드 후 1회 화면 맞춤
  useEffect(() => {
    if (state === 'ready') fitView()
  }, [state, fitView])

  // 휠 줌(커서 기준) — passive:false 로 네이티브 등록해야 preventDefault 가능
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    function onWheel(e: WheelEvent) {
      e.preventDefault()
      const rect = el!.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const factor = Math.exp(-e.deltaY * 0.0015)
      setView((v) => {
        const k2 = clamp(v.k * factor, 0.2, 3)
        const wx = (mx - v.x) / v.k
        const wy = (my - v.y) / v.k
        return { k: k2, x: mx - wx * k2, y: my - wy * k2 }
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // Space 누르면 손바닥(팬) 모드
  useEffect(() => {
    function down(e: KeyboardEvent) {
      if (e.code === 'Space') {
        spaceHeld.current = true
        setGrabbing(true)
        e.preventDefault()
      }
    }
    function up(e: KeyboardEvent) {
      if (e.code === 'Space') {
        spaceHeld.current = false
        if (!dragging.current) setGrabbing(false)
      }
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  // 팬: 빈 영역 드래그 또는 Space/Alt/Ctrl/가운데버튼 + 드래그
  function onMouseDown(e: React.MouseEvent) {
    const onBackground = (e.target as HTMLElement)?.dataset?.bg === '1'
    const panMod = e.altKey || e.ctrlKey || spaceHeld.current || e.button === 1
    if (!onBackground && !panMod) return
    e.preventDefault()
    dragging.current = true
    last.current = { x: e.clientX, y: e.clientY }
    setGrabbing(true)
  }
  useEffect(() => {
    function move(e: MouseEvent) {
      if (!dragging.current) return
      const dx = e.clientX - last.current.x
      const dy = e.clientY - last.current.y
      last.current = { x: e.clientX, y: e.clientY }
      setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }))
    }
    function up() {
      dragging.current = false
      if (!spaceHeld.current) setGrabbing(false)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [])

  function zoomBy(factor: number) {
    const el = viewportRef.current
    if (!el) return
    const mx = el.clientWidth / 2
    const my = el.clientHeight / 2
    setView((v) => {
      const k2 = clamp(v.k * factor, 0.2, 3)
      const wx = (mx - v.x) / v.k
      const wy = (my - v.y) / v.k
      return { k: k2, x: mx - wx * k2, y: my - wy * k2 }
    })
  }

  if (state === 'loading') {
    return (
      <div className="flex h-full items-center justify-center text-gray-400">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> 마인드맵 불러오는 중…
      </div>
    )
  }
  if (state === 'notfound' || !mm) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-gray-500">
        <p>마인드맵을 찾을 수 없어요.</p>
        <button onClick={() => router.push('/plan-mindmap')} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50">
          목록으로
        </button>
      </div>
    )
  }

  const nodes = [...(mm.data?.nodes || [])].sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key))
  const positioned = nodes.map((node, i) => {
    const angle = -Math.PI / 2 + (i / Math.max(1, nodes.length)) * 2 * Math.PI
    return { node, x: CENTER.x + RADIUS * Math.cos(angle), y: CENTER.y + RADIUS * Math.sin(angle) }
  })
  const sourceUrl = mm.library_id ? `https://www.facebook.com/ads/library/?id=${mm.library_id}` : null

  return (
    <div className="relative -m-8 h-[calc(100vh)] overflow-hidden bg-[radial-gradient(circle,#e5e7eb_1px,transparent_1px)] [background-size:22px_22px] dark:bg-gray-950">
      {/* 상단 바 */}
      <div className="absolute left-0 right-0 top-0 z-20 flex items-center justify-between gap-2 border-b border-gray-200 bg-white/90 px-4 py-2.5 backdrop-blur dark:border-gray-800 dark:bg-gray-900/90">
        <div className="flex min-w-0 items-center gap-3">
          <button
            onClick={() => router.push('/plan-mindmap')}
            className="flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> 목록
          </button>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold dark:text-gray-100">{mm.title || '기획 마인드맵'}</p>
            {mm.source_brand && <p className="truncate text-[11px] text-gray-400">출처: {mm.source_brand}</p>}
          </div>
        </div>
        {sourceUrl && (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex shrink-0 items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            <ExternalLink className="h-3.5 w-3.5" /> 원본 광고
          </a>
        )}
      </div>

      {/* 캔버스 뷰포트 */}
      <div
        ref={viewportRef}
        data-bg="1"
        onMouseDown={onMouseDown}
        className={`absolute inset-0 ${grabbing ? 'cursor-grabbing' : 'cursor-grab'}`}
      >
        <div
          className="absolute left-0 top-0 origin-top-left"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`, width: WORLD_W, height: WORLD_H }}
        >
          {/* 연결선 */}
          <svg width={WORLD_W} height={WORLD_H} className="pointer-events-none absolute left-0 top-0">
            {positioned.map((p) => (
              <line
                key={p.node.key}
                x1={CENTER.x}
                y1={CENTER.y}
                x2={p.x}
                y2={p.y}
                stroke={NODE_STYLE[p.node.key]?.dot || '#9CA3AF'}
                strokeWidth={2}
                strokeOpacity={0.4}
              />
            ))}
          </svg>

          {/* 중앙 노드(소재) */}
          <div
            className="absolute w-60 -translate-x-1/2 -translate-y-1/2 rounded-2xl border-2 border-primary bg-white p-3 shadow-lg dark:bg-gray-900"
            style={{ left: CENTER.x, top: CENTER.y }}
          >
            <div className="aspect-video w-full overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-800">
              {mm.source_thumb ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={mm.source_thumb} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs text-gray-400">소재</div>
              )}
            </div>
            <p className="mt-2 line-clamp-2 text-sm font-bold text-gray-900 dark:text-gray-100">{mm.title || '경쟁 소재'}</p>
            {mm.data?.summary && <p className="mt-1 line-clamp-3 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">{mm.data.summary}</p>}
          </div>

          {/* 7개 가지 노드 */}
          {positioned.map((p) => {
            const st = NODE_STYLE[p.node.key] || { dot: '#9CA3AF', ring: 'border-gray-300' }
            return (
              <div
                key={p.node.key}
                className={`absolute w-56 -translate-x-1/2 -translate-y-1/2 rounded-xl border-2 ${st.ring} bg-white p-3 shadow-md dark:bg-gray-900`}
                style={{ left: p.x, top: p.y }}
              >
                <div className="mb-1.5 flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: st.dot }} />
                  <span className="text-sm font-bold text-gray-900 dark:text-gray-100">{p.node.label}</span>
                </div>
                <ul className="space-y-1">
                  {(p.node.items || []).map((it, i) => (
                    <li key={i} className="flex gap-1 text-[12px] leading-snug text-gray-600 dark:text-gray-300">
                      <span style={{ color: st.dot }}>·</span>
                      <span>{it}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      </div>

      {/* 줌 컨트롤 */}
      <div className="absolute bottom-5 right-5 z-20 flex items-center gap-1 rounded-xl border border-gray-200 bg-white/95 p-1 shadow-lg backdrop-blur dark:border-gray-700 dark:bg-gray-900/95">
        <button onClick={() => zoomBy(1 / 1.2)} className="rounded-lg p-2 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800" title="축소">
          <Minus className="h-4 w-4" />
        </button>
        <button onClick={fitView} className="min-w-[52px] rounded-lg px-2 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800" title="화면 맞춤">
          {Math.round(view.k * 100)}%
        </button>
        <button onClick={() => zoomBy(1.2)} className="rounded-lg p-2 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800" title="확대">
          <Plus className="h-4 w-4" />
        </button>
        <div className="mx-0.5 h-5 w-px bg-gray-200 dark:bg-gray-700" />
        <button onClick={fitView} className="rounded-lg p-2 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800" title="화면 맞춤">
          <Maximize2 className="h-4 w-4" />
        </button>
      </div>

      {/* 조작 안내 */}
      <div className="absolute bottom-5 left-5 z-20 flex items-center gap-1.5 rounded-lg bg-black/60 px-2.5 py-1.5 text-[11px] text-white">
        <Hand className="h-3 w-3" /> 휠=확대/축소 · 드래그(또는 Space/Alt/Ctrl+드래그)=이동
      </div>
    </div>
  )
}
