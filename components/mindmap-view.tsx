'use client'

// 기획 마인드맵 읽기전용 뷰어(외부 공유용). 에디터(app/plan-mindmap/[id])의 시각을 그대로 쓰되
// 편집/툴바/드래그/저장/AI 생성 전부 제거. 팬·줌·영상재생만 허용. 에디터는 건드리지 않음(안전).

import { useEffect, useRef, useState, useCallback } from 'react'
import type { MMDoc, MMNode, MindmapData, Mindmap } from '@/lib/api/mindmaps'

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))

// 유튜브/인스타 URL → 임베드 URL(중앙 노드 재생).
export function embedSrcOf(u?: string | null): string | null {
  if (!u) return null
  const yt =
    u.match(/[?&]v=([\w-]{6,})/)?.[1] ||
    u.match(/youtu\.be\/([\w-]{6,})/)?.[1] ||
    u.match(/\/shorts\/([\w-]{6,})/)?.[1] ||
    u.match(/youtube\.com\/embed\/([\w-]{6,})/)?.[1]
  if (yt) return `https://www.youtube.com/embed/${yt}?playsinline=1`
  const ig = u.match(/instagram\.com\/(?:reel|reels|p|tv)\/([\w-]+)/)?.[1]
  if (ig) return `https://www.instagram.com/reel/${ig}/embed/`
  return null
}

const CAT_COLOR: Record<string, string> = {
  develop: '#3B82F6', storytelling: '#8B5CF6', script: '#10B981', plan: '#F59E0B',
  segment: '#EC4899', segment2: '#EC4899', weakness: '#F43F5E', strength: '#14B8A6',
}

function halfH(n: MMNode) {
  if (n.h) return n.h / 2
  if (n.type === 'center') return 170
  if (n.type === 'narration') return 110
  if (n.type === 'chart' || n.type === 'image') return 80
  if (n.type === 'category') return 70 + (n.items?.length || 0) * 9
  return 40
}

// 레거시/AI(data)을 편집 캔버스 그래프(MMDoc v2)로 변환 — 에디터 buildDoc 과 동일 로직.
export function buildViewDoc(raw: MindmapData | MMDoc | undefined, mm: Pick<Mindmap, 'title' | 'source_thumb'>): MMDoc {
  if (raw && (raw as MMDoc).version === 2 && Array.isArray((raw as MMDoc).nodes)) return clone(raw as MMDoc)
  const legacy = (raw || { nodes: [] }) as MindmapData
  const nodes: MMNode[] = []
  const edges: { id: string; from: string; to: string }[] = []
  nodes.push({
    id: 'center', type: 'center', x: 0, y: 0, title: mm.title || legacy.summary || '소재',
    media_url: legacy.media?.url ?? null, media_type: legacy.media?.type ?? null,
    poster: legacy.media?.poster ?? mm.source_thumb ?? null, w: 210,
  })
  const all = legacy.nodes || []
  const cats = all.filter((n) => n.key !== 'segment2')
  const seg2 = all.find((n) => n.key === 'segment2')
  type B =
    | { kind: 'category'; cat: { key: string; label: string; items: string[] } }
    | { kind: 'narration' }
    | { kind: 'segment2' }
    | { kind: 'chart'; ch: NonNullable<MindmapData['charts']>[number] }
  const order: B[] = []
  cats.forEach((cat) => {
    order.push({ kind: 'category', cat })
    if (cat.key === 'script') order.push({ kind: 'narration' })
    if (cat.key === 'segment' && seg2) order.push({ kind: 'segment2' })
  })
  ;(legacy.charts || []).forEach((ch) => order.push({ kind: 'chart', ch }))

  const total = order.length || 1
  const RX = 380 + total * 13
  const RY = 290 + total * 10
  let scriptId = 'center'
  let segmentId = 'center'
  order.forEach((b, idx) => {
    const ang = -Math.PI / 2 + (idx / total) * 2 * Math.PI
    const x = Math.round(Math.cos(ang) * RX)
    const y = Math.round(Math.sin(ang) * RY)
    const id = `b-${idx}`
    if (b.kind === 'category') {
      nodes.push({ id, type: 'category', x, y, title: b.cat.label, items: b.cat.items || [], key: b.cat.key, color: CAT_COLOR[b.cat.key] || '#6366F1', w: 210 })
      if (b.cat.key === 'script') scriptId = id
      if (b.cat.key === 'segment') segmentId = id
      edges.push({ id: `e-${idx}`, from: 'center', to: id })
    } else if (b.kind === 'narration') {
      nodes.push({ id, type: 'narration', x, y, title: '나레이션 원문', text: legacy.narration, w: 300 })
      edges.push({ id: `e-${idx}`, from: scriptId, to: id })
    } else if (b.kind === 'segment2') {
      nodes.push({ id, type: 'category', x, y, title: seg2!.label || '추가 세그먼트', items: seg2!.items || [], key: 'segment2', color: CAT_COLOR.segment, w: 210 })
      edges.push({ id: `e-${idx}`, from: segmentId, to: id })
    } else {
      nodes.push({ id, type: 'chart', x, y, title: b.ch.title || '데이터', w: 280, chart: { kind: b.ch.kind === 'line' ? 'line' : 'bar', data: (b.ch.data || []).filter((d) => d && d.label != null) } })
      edges.push({ id: `e-${idx}`, from: 'center', to: id })
    }
  })
  return { version: 2, summary: legacy.summary, nodes, edges }
}

function Chart({ chart, width, height }: { chart?: { kind: 'bar' | 'line'; data: { label: string; value: number }[] }; width?: number; height?: number }) {
  if (!chart || !chart.data?.length) return <p className="text-[11px] text-gray-400">데이터 없음</p>
  const W = Math.max(150, width || 254), H = Math.max(60, height || 92), pad = 6
  const max = Math.max(1, ...chart.data.map((d) => d.value))
  if (chart.kind === 'line') {
    const stepX = (W - pad * 2) / Math.max(1, chart.data.length - 1)
    const pts = chart.data.map((d, i) => `${pad + i * stepX},${H - pad - (d.value / max) * (H - pad * 2)}`).join(' ')
    return (
      <svg width={W} height={H} className="overflow-visible">
        <polyline points={pts} fill="none" stroke="#8B5CF6" strokeWidth={2} />
        {chart.data.map((d, i) => <circle key={i} cx={pad + i * stepX} cy={H - pad - (d.value / max) * (H - pad * 2)} r={2.5} fill="#8B5CF6" />)}
        {chart.data.map((d, i) => <text key={i} x={pad + i * stepX} y={H} fontSize={7} textAnchor="middle" fill="#9CA3AF">{d.label}</text>)}
      </svg>
    )
  }
  const bw = (W - pad * 2) / chart.data.length
  return (
    <svg width={W} height={H} className="overflow-visible">
      {chart.data.map((d, i) => {
        const h = (d.value / max) * (H - pad * 2 - 8)
        return (
          <g key={i}>
            <rect x={pad + i * bw + bw * 0.15} y={H - pad - h - 8} width={bw * 0.7} height={h} rx={2} fill="#6366F1" />
            <text x={pad + i * bw + bw / 2} y={H - pad - h - 10} fontSize={7} textAnchor="middle" fill="#6B7280">{d.value}</text>
            <text x={pad + i * bw + bw / 2} y={H} fontSize={7} textAnchor="middle" fill="#9CA3AF">{d.label}</text>
          </g>
        )
      })}
    </svg>
  )
}

// 읽기전용 노드(핸들·편집·드래그 없음)
function ViewNode({ n, centerAspect, onCenterAspect }: { n: MMNode; centerAspect: number; onCenterAspect: (r: number) => void }) {
  const base = 'absolute -translate-x-1/2 -translate-y-1/2 select-none overflow-hidden rounded-xl shadow-md'
  const style: React.CSSProperties = { left: n.x, top: n.y, width: n.w || 200, ...(n.h ? { height: n.h } : {}) }
  const stop = (e: React.MouseEvent) => e.stopPropagation() // 컨트롤/링크는 팬 시작 안 시킴

  if (n.type === 'center') {
    return (
      <div className={`${base} border-2 border-primary bg-white p-2.5 dark:bg-gray-900`} style={{ ...style, width: n.w || 210 }}>
        <div className="w-full overflow-hidden rounded-lg bg-black" style={{ aspectRatio: String(centerAspect) }}>
          {n.media_type === 'video' && n.media_url ? (
            embedSrcOf(n.media_url) ? (
              <iframe src={embedSrcOf(n.media_url)!} title="" scrolling="no" allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share" allowFullScreen className="h-full w-full bg-black" onMouseDown={stop} onLoad={() => onCenterAspect(9 / 16)} />
            ) : (
              <video src={n.media_url} poster={n.poster || undefined} controls playsInline preload="metadata" className="h-full w-full bg-black object-contain" onMouseDown={stop} onLoadedMetadata={(e) => { const v = e.currentTarget; if (v.videoWidth && v.videoHeight) onCenterAspect(v.videoWidth / v.videoHeight) }} />
            )
          ) : n.poster ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={n.poster} alt="" className="h-full w-full object-contain" onLoad={(e) => { const i = e.currentTarget; if (i.naturalWidth && i.naturalHeight) onCenterAspect(i.naturalWidth / i.naturalHeight) }} />
          ) : <div className="flex h-full w-full items-center justify-center text-xs text-gray-400">소재</div>}
        </div>
        <p className="mt-2 line-clamp-2 text-sm font-bold text-gray-900 dark:text-gray-100">{n.title}</p>
      </div>
    )
  }

  if (n.type === 'image') {
    return (
      <div className={`${base} border-2 border-transparent bg-transparent p-0 shadow-none`} style={style}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={n.media_url || ''} alt="" draggable={false} className="block w-full rounded-lg" style={n.h ? { height: '100%', objectFit: 'contain' } : { height: 'auto' }} />
      </div>
    )
  }

  if (n.type === 'chart') {
    return (
      <div className={`${base} flex flex-col border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900`} style={style}>
        <div className="mb-1.5 shrink-0 text-xs font-bold text-gray-700 dark:text-gray-200">📊 {n.title}</div>
        <div className="min-h-0 flex-1"><Chart chart={n.chart} width={(n.w || 280) - 30} height={n.h ? n.h - 48 : undefined} /></div>
      </div>
    )
  }

  if (n.type === 'narration') {
    return (
      <div className={`${base} flex flex-col border-2 border-violet-300 bg-white p-2.5 dark:border-violet-800 dark:bg-gray-900`} style={style}>
        <div className="mb-1.5 flex shrink-0 items-center justify-between">
          <span className="flex items-center gap-1.5 text-[13px] font-bold text-gray-900 dark:text-gray-100"><span className="h-2.5 w-2.5 shrink-0 rounded-full bg-violet-500" />{n.title}</span>
          {n.text ? <button onMouseDown={stop} onClick={() => navigator.clipboard?.writeText(n.text || '')} className="text-[10px] text-violet-600 hover:underline">복사</button> : null}
        </div>
        {n.text ? <p className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap text-[12px] leading-snug text-gray-700 dark:text-gray-200">{n.text}</p>
          : <p className="text-[12px] italic leading-snug text-gray-400">나레이션이 없는 소재입니다</p>}
      </div>
    )
  }

  const accent = n.color || '#6366F1'
  if (n.type === 'category') {
    return (
      <div className={`${base} border-2 bg-white p-2.5 dark:bg-gray-900`} style={{ ...style, borderColor: accent }}>
        <div className="mb-1.5 flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: accent }} />
          <span className="text-[13px] font-bold text-gray-900 dark:text-gray-100">{n.title}</span>
        </div>
        <ul className="space-y-0.5">{(n.items || []).map((it, i) => <li key={i} className="flex gap-1 text-[12px] leading-snug text-gray-600 dark:text-gray-300"><span style={{ color: accent }}>·</span><span>{it}</span></li>)}</ul>
      </div>
    )
  }

  // note
  return (
    <div className={`${base} border-2 bg-white p-2.5 dark:bg-gray-900`} style={{ ...style, borderColor: n.color && n.color !== '#64748B' ? n.color : '#CBD5E1' }}>
      <p className="whitespace-pre-wrap text-[12px] leading-snug text-gray-600 dark:text-gray-300">{n.text}</p>
    </div>
  )
}

export function MindmapCanvasView({ doc }: { doc: MMDoc }) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState({ x: 0, y: 0, k: 1 })
  const [centerAspect, setCenterAspect] = useState(9 / 16)
  const panning = useRef(false)
  const lastPan = useRef({ x: 0, y: 0 })
  const nodeById = (id: string) => doc.nodes.find((n) => n.id === id)

  const fitView = useCallback(() => {
    const el = viewportRef.current
    const ns = doc.nodes
    if (!el || !ns.length) return
    const HW = 150, HH = 130
    const xs = ns.map((n) => n.x), ys = ns.map((n) => n.y)
    const minX = Math.min(...xs) - HW, maxX = Math.max(...xs) + HW
    const minY = Math.min(...ys) - HH, maxY = Math.max(...ys) + HH
    const w = maxX - minX, h = maxY - minY
    const k = clamp(Math.min(el.clientWidth / w, el.clientHeight / h), 0.2, 1.6)
    setView({ k, x: el.clientWidth / 2 - ((minX + maxX) / 2) * k, y: el.clientHeight / 2 - ((minY + maxY) / 2) * k })
  }, [doc])
  useEffect(() => { const t = setTimeout(fitView, 40); return () => clearTimeout(t) }, [fitView])

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    function onWheel(e: WheelEvent) {
      e.preventDefault()
      if (e.ctrlKey || e.metaKey || e.altKey) {
        const rect = el!.getBoundingClientRect()
        const mx = e.clientX - rect.left, my = e.clientY - rect.top
        const factor = Math.exp(-e.deltaY * 0.0018)
        setView((v) => { const k2 = clamp(v.k * factor, 0.15, 3); const wx = (mx - v.x) / v.k, wy = (my - v.y) / v.k; return { k: k2, x: mx - wx * k2, y: my - wy * k2 } })
      } else {
        setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }))
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  useEffect(() => {
    function move(e: MouseEvent) {
      if (!panning.current) return
      const dx = e.clientX - lastPan.current.x, dy = e.clientY - lastPan.current.y
      lastPan.current = { x: e.clientX, y: e.clientY }
      setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }))
    }
    function up() { panning.current = false }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
  }, [])

  function zoomBy(factor: number) {
    const el = viewportRef.current
    if (!el) return
    const mx = el.clientWidth / 2, my = el.clientHeight / 2
    setView((v) => { const k2 = clamp(v.k * factor, 0.15, 3); const wx = (mx - v.x) / v.k, wy = (my - v.y) / v.k; return { k: k2, x: mx - wx * k2, y: my - wy * k2 } })
  }

  return (
    <div
      ref={viewportRef}
      onMouseDown={(e) => { panning.current = true; lastPan.current = { x: e.clientX, y: e.clientY } }}
      className="relative h-full w-full cursor-grab overflow-hidden bg-[radial-gradient(circle,#e5e7eb_1px,transparent_1px)] [background-size:22px_22px] active:cursor-grabbing dark:bg-gray-950"
    >
      <div className="absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
        <svg style={{ position: 'absolute', left: 0, top: 0, width: 1, height: 1, overflow: 'visible', pointerEvents: 'none' }}>
          {doc.edges.map((e) => {
            const a = nodeById(e.from), b = nodeById(e.to)
            if (!a || !b) return null
            return <line key={e.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={b.color || a.color || '#9CA3AF'} strokeWidth={2} strokeOpacity={0.4} />
          })}
        </svg>
        {doc.nodes.map((n) => <ViewNode key={n.id} n={n} centerAspect={centerAspect} onCenterAspect={setCenterAspect} />)}
      </div>

      {/* 줌 컨트롤(뷰어용) */}
      <div className="absolute bottom-4 right-4 z-10 flex items-center gap-1 rounded-xl border border-gray-200 bg-white/95 p-1 shadow-lg backdrop-blur dark:border-gray-700 dark:bg-gray-900/95">
        <button onClick={() => zoomBy(1 / 1.2)} title="축소" className="rounded-lg px-2.5 py-1.5 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800">−</button>
        <button onClick={fitView} className="min-w-[52px] rounded-lg px-2 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800">{Math.round(view.k * 100)}%</button>
        <button onClick={() => zoomBy(1.2)} title="확대" className="rounded-lg px-2.5 py-1.5 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800">+</button>
      </div>
      <div className="pointer-events-none absolute bottom-4 left-4 z-10 rounded-lg bg-black/55 px-2.5 py-1.5 text-[11px] text-white">휠=이동 · Ctrl(또는 Alt)+휠=확대/축소 · 드래그=이동</div>
    </div>
  )
}
