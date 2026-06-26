'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  ArrowLeft, ExternalLink, Plus, Minus, Maximize2, Loader2, Save, Undo2, Redo2,
  Trash2, Type, Link2, Copy, Sparkles, X, PanelRightOpen, PanelRightClose, Check,
} from 'lucide-react'
import { getMindmap, updateMindmap, Mindmap, MMDoc, MMNode, MMEdge, MindmapData } from '@/lib/api/mindmaps'
import { getClient, Client } from '@/lib/api/clients'
import { aiFetch } from '@/lib/ai-fetch'

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const uid = () => Math.random().toString(36).slice(2, 9)
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))

const CAT_COLOR: Record<string, string> = {
  develop: '#3B82F6', storytelling: '#8B5CF6', script: '#10B981', plan: '#F59E0B',
  segment: '#EC4899', weakness: '#F43F5E', strength: '#14B8A6',
}

// 레거시/AI 출력(data)을 편집 캔버스 그래프(MMDoc v2)로 변환 — 2단 트리 배치
function buildDoc(raw: MindmapData | MMDoc | undefined, mm: Mindmap): MMDoc {
  if (raw && (raw as MMDoc).version === 2 && Array.isArray((raw as MMDoc).nodes)) return clone(raw as MMDoc)
  const legacy = (raw || { nodes: [] }) as MindmapData
  const nodes: MMNode[] = []
  const edges: MMEdge[] = []
  const centerId = 'center'
  nodes.push({
    id: centerId, type: 'center', x: 0, y: 0,
    title: mm.title || legacy.summary || '소재',
    media_url: legacy.media?.url ?? null, media_type: legacy.media?.type ?? null,
    poster: legacy.media?.poster ?? mm.source_thumb ?? null, w: 240,
  })
  const cats = legacy.nodes || []
  const R1 = 480
  cats.forEach((cat, i) => {
    const ang = -Math.PI / 2 + (i / Math.max(1, cats.length)) * 2 * Math.PI
    const cx = Math.round(Math.cos(ang) * R1)
    const cy = Math.round(Math.sin(ang) * R1)
    const catId = `cat-${i}`
    const color = CAT_COLOR[cat.key] || '#6366F1'
    nodes.push({ id: catId, type: 'category', x: cx, y: cy, title: cat.label, key: cat.key, color, w: 170 })
    edges.push({ id: `e-c${i}`, from: centerId, to: catId })
    const items = cat.items || []
    const R2 = 250
    items.forEach((it, j) => {
      const spread = Math.PI / 2.4
      const a = ang + (items.length > 1 ? (j / (items.length - 1) - 0.5) * spread : 0)
      nodes.push({
        id: `it-${i}-${j}`, type: 'item', x: Math.round(cx + Math.cos(a) * R2),
        y: Math.round(cy + Math.sin(a) * R2), text: it, color, w: 190,
      })
      edges.push({ id: `e-i${i}-${j}`, from: catId, to: `it-${i}-${j}` })
    })
  })
  // 나레이션 원문(실제 대본) 노드
  if (legacy.narration && legacy.narration.trim()) {
    nodes.push({ id: 'narration', type: 'narration', x: -820, y: 360, title: '나레이션 원문', text: legacy.narration, w: 330 })
    const si = cats.findIndex((c) => c.key === 'script')
    if (si >= 0) edges.push({ id: 'e-narr', from: `cat-${si}`, to: 'narration' })
  }
  // 차트 노드
  ;(legacy.charts || []).forEach((ch, k) => {
    nodes.push({
      id: `chart-${k}`, type: 'chart', x: 820, y: -260 + k * 300, title: ch.title || '데이터',
      w: 300, chart: { kind: ch.kind === 'line' ? 'line' : 'bar', data: (ch.data || []).filter((d) => d && d.label != null) },
    })
    edges.push({ id: `e-ch${k}`, from: 'center', to: `chart-${k}` })
  })
  return { version: 2, summary: legacy.summary, nodes, edges }
}

export default function MindmapCanvasPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const [mm, setMm] = useState<Mindmap | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'notfound'>('loading')

  const [doc, setDoc] = useState<MMDoc>({ version: 2, nodes: [], edges: [] })
  const docRef = useRef(doc)
  docRef.current = doc
  const [past, setPast] = useState<MMDoc[]>([])
  const [future, setFuture] = useState<MMDoc[]>([])
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [connectFrom, setConnectFrom] = useState<string | null>(null)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [copied, setCopied] = useState(false)

  // 우측 패널(기획안 생성)
  const [panelOpen, setPanelOpen] = useState(false)
  const [client, setClient] = useState<Client | null>(null)
  const [plan, setPlan] = useState<string | null>(null)
  const [planLoading, setPlanLoading] = useState(false)
  const [planCopied, setPlanCopied] = useState(false)

  const viewportRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState({ x: 0, y: 0, k: 1 })

  // 드래그 상태
  const panning = useRef(false)
  const nodeDrag = useRef<{ id: string; lastX: number; lastY: number; moved: boolean } | null>(null)
  const lastPan = useRef({ x: 0, y: 0 })

  // ── 로드 ──
  useEffect(() => {
    if (!params?.id) return
    let alive = true
    getMindmap(params.id)
      .then(async (d) => {
        if (!alive) return
        if (!d) { setState('notfound'); return }
        setMm(d)
        let built = buildDoc(d.data, d)
        // 구버전: 중앙 영상이 없으면 library_id 로 보강
        const center = built.nodes.find((n) => n.type === 'center')
        if (center && !center.media_url && d.library_id) {
          try {
            const ad = await fetch(`/api/meta-ad/public/${d.library_id}`).then((r) => (r.ok ? r.json() : null))
            if (ad && alive) {
              center.media_url = ad.media_url || null
              center.media_type = ad.media_type || null
              center.poster = center.poster || ad.poster_url || null
              built = { ...built }
            }
          } catch {}
        }
        setDoc(built)
        setState('ready')
        if (d.client_id) getClient(d.client_id).then((c) => alive && setClient(c)).catch(() => {})
      })
      .catch(() => alive && setState('notfound'))
    return () => { alive = false }
  }, [params?.id])

  // 첫 로드 시 화면 맞춤
  const fitView = useCallback(() => {
    const el = viewportRef.current
    const ns = docRef.current.nodes
    if (!el || !ns.length) return
    const HW = 170, HH = 130
    const xs = ns.map((n) => n.x), ys = ns.map((n) => n.y)
    const minX = Math.min(...xs) - HW, maxX = Math.max(...xs) + HW
    const minY = Math.min(...ys) - HH, maxY = Math.max(...ys) + HH
    const w = maxX - minX, h = maxY - minY
    const k = clamp(Math.min(el.clientWidth / w, el.clientHeight / h) * 0.95, 0.15, 1.4)
    setView({ k, x: el.clientWidth / 2 - ((minX + maxX) / 2) * k, y: el.clientHeight / 2 - ((minY + maxY) / 2) * k })
  }, [])
  useEffect(() => { if (state === 'ready') setTimeout(fitView, 30) }, [state, fitView])

  // ── 휠: 일반=이동 / Ctrl·Cmd=확대축소(브라우저 줌 차단) ──
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    function onWheel(e: WheelEvent) {
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) {
        const rect = el!.getBoundingClientRect()
        const mx = e.clientX - rect.left, my = e.clientY - rect.top
        const factor = Math.exp(-e.deltaY * 0.0018)
        setView((v) => {
          const k2 = clamp(v.k * factor, 0.15, 3)
          const wx = (mx - v.x) / v.k, wy = (my - v.y) / v.k
          return { k: k2, x: mx - wx * k2, y: my - wy * k2 }
        })
      } else {
        setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }))
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // ── 히스토리 ──
  const beginHistory = useCallback(() => {
    setPast((p) => [...p.slice(-60), clone(docRef.current)])
    setFuture([])
    setDirty(true)
  }, [])
  const mutate = useCallback((producer: (d: MMDoc) => MMDoc) => {
    beginHistory()
    setDoc((d) => producer(clone(d)))
  }, [beginHistory])
  const undo = useCallback(() => {
    setPast((p) => {
      if (!p.length) return p
      setFuture((f) => [clone(docRef.current), ...f])
      setDoc(p[p.length - 1]); setDirty(true); setEditingId(null)
      return p.slice(0, -1)
    })
  }, [])
  const redo = useCallback(() => {
    setFuture((f) => {
      if (!f.length) return f
      setPast((p) => [...p, clone(docRef.current)])
      setDoc(f[0]); setDirty(true); setEditingId(null)
      return f.slice(1)
    })
  }, [])

  // ── 노드/화면 드래그 ──
  function onBgMouseDown(e: React.MouseEvent) {
    if ((e.target as HTMLElement)?.dataset?.bg !== '1') return
    setSelectedId(null)
    setConnectFrom(null)
    panning.current = true
    lastPan.current = { x: e.clientX, y: e.clientY }
  }
  function onNodeMouseDown(e: React.MouseEvent, n: MMNode) {
    e.stopPropagation()
    if (connectFrom) {
      if (connectFrom === 'pick') { setConnectFrom(n.id); return } // 첫 노드 = 출발점
      if (connectFrom !== n.id) {
        mutate((d) => {
          if (!d.edges.some((ed) => ed.from === connectFrom && ed.to === n.id))
            d.edges.push({ id: uid(), from: connectFrom, to: n.id })
          return d
        })
      }
      setConnectFrom(null)
      return
    }
    setSelectedId(n.id)
    nodeDrag.current = { id: n.id, lastX: e.clientX, lastY: e.clientY, moved: false }
  }
  useEffect(() => {
    function move(e: MouseEvent) {
      if (panning.current) {
        const dx = e.clientX - lastPan.current.x, dy = e.clientY - lastPan.current.y
        lastPan.current = { x: e.clientX, y: e.clientY }
        setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }))
        return
      }
      const nd = nodeDrag.current
      if (nd) {
        if (!nd.moved) { nd.moved = true; beginHistory() }
        const k = view.k || 1
        const dx = (e.clientX - nd.lastX) / k, dy = (e.clientY - nd.lastY) / k
        nd.lastX = e.clientX; nd.lastY = e.clientY
        setDoc((d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === nd.id ? { ...n, x: n.x + dx, y: n.y + dy } : n)) }))
        setDirty(true)
      }
    }
    function up() { panning.current = false; nodeDrag.current = null }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
  }, [view.k, beginHistory])

  // ── 키보드 ──
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement
      const typing = ['input', 'textarea'].includes((t?.tagName || '').toLowerCase()) || t?.isContentEditable
      if (typing) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        e.shiftKey ? redo() : undo()
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault(); redo()
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        const n = docRef.current.nodes.find((x) => x.id === selectedId)
        if (n && n.type !== 'center') { e.preventDefault(); deleteNode(selectedId) }
      } else if (e.key === 'Escape') {
        setConnectFrom(null); setEditingId(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId, undo, redo])

  // ── 편집 동작 ──
  function addNote() {
    const el = viewportRef.current
    const cx = el ? (el.clientWidth / 2 - view.x) / view.k : 0
    const cy = el ? (el.clientHeight / 2 - view.y) / view.k : 0
    const id = uid()
    mutate((d) => { d.nodes.push({ id, type: 'note', x: cx, y: cy, text: '새 메모', color: '#64748B', w: 200 }); return d })
    setSelectedId(id); setEditingId(id)
  }
  function deleteNode(id: string) {
    mutate((d) => ({ ...d, nodes: d.nodes.filter((n) => n.id !== id), edges: d.edges.filter((e) => e.from !== id && e.to !== id) }))
    setSelectedId(null)
  }
  function commitEdit(id: string, value: string) {
    mutate((d) => ({
      ...d,
      nodes: d.nodes.map((n) => {
        if (n.id !== id) return n
        return n.type === 'category' ? { ...n, title: value } : { ...n, text: value }
      }),
    }))
    setEditingId(null)
  }

  // ── 줌 버튼 ──
  function zoomBy(factor: number) {
    const el = viewportRef.current
    if (!el) return
    const mx = el.clientWidth / 2, my = el.clientHeight / 2
    setView((v) => {
      const k2 = clamp(v.k * factor, 0.15, 3)
      const wx = (mx - v.x) / v.k, wy = (my - v.y) / v.k
      return { k: k2, x: mx - wx * k2, y: my - wy * k2 }
    })
  }

  // ── 저장 / 이탈 가드 ──
  async function save(): Promise<boolean> {
    if (!mm) return false
    setSaving(true)
    try {
      await updateMindmap(mm.id, { data: doc })
      setDirty(false)
      return true
    } catch {
      alert('저장에 실패했습니다.')
      return false
    } finally {
      setSaving(false)
    }
  }
  function requestLeave() { dirty ? setConfirmLeave(true) : router.push('/plan-mindmap') }
  useEffect(() => {
    function bu(e: BeforeUnloadEvent) { if (dirty) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', bu)
    return () => window.removeEventListener('beforeunload', bu)
  }, [dirty])

  // ── 기획안 생성(우측 패널) ──
  async function generatePlan() {
    setPlanLoading(true)
    try {
      const cats = doc.nodes.filter((n) => n.type === 'category')
      const nodesForPlan = cats.map((c) => ({
        label: c.title,
        items: doc.edges.filter((e) => e.from === c.id).map((e) => doc.nodes.find((n) => n.id === e.to)).filter((n) => n && n.type === 'item').map((n) => n!.text),
      }))
      const notes = doc.nodes.filter((n) => n.type === 'note' && n.text).map((n) => ({ label: '메모', items: [n.text] }))
      const res = await aiFetch('/api/ai/plan-from-mindmap', {
        method: 'POST',
        body: JSON.stringify({
          mindmap: { summary: doc.summary, nodes: [...nodesForPlan, ...notes] },
          brief: { brand_brief: client?.brand_brief || '', strengths: client?.strengths || '', selling_points: client?.selling_points || '' },
          brand_name: client?.name || mm?.source_brand || '우리 브랜드',
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { alert(j.error || '기획안 생성 실패'); return }
      setPlan(j.plan || '')
    } catch {
      alert('기획안 생성 중 오류가 발생했어요.')
    } finally {
      setPlanLoading(false)
    }
  }

  if (state === 'loading') {
    return <div className="flex h-full items-center justify-center text-gray-400"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> 마인드맵 불러오는 중…</div>
  }
  if (state === 'notfound' || !mm) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-gray-500">
        <p>마인드맵을 찾을 수 없어요.</p>
        <button onClick={() => router.push('/plan-mindmap')} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50">목록으로</button>
      </div>
    )
  }

  const sourceUrl = mm.library_id ? `https://www.facebook.com/ads/library/?id=${mm.library_id}` : null
  const nodeById = (id: string) => doc.nodes.find((n) => n.id === id)

  return (
    <div className="relative -m-8 h-screen overflow-hidden bg-[radial-gradient(circle,#e5e7eb_1px,transparent_1px)] [background-size:22px_22px] dark:bg-gray-950">
      {/* 상단 바 */}
      <div className="absolute left-0 right-0 top-0 z-30 flex items-center justify-between gap-2 border-b border-gray-200 bg-white/90 px-4 py-2.5 backdrop-blur dark:border-gray-800 dark:bg-gray-900/90">
        <div className="flex min-w-0 items-center gap-3">
          <button onClick={requestLeave} className="flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">
            <ArrowLeft className="h-3.5 w-3.5" /> 목록
          </button>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold dark:text-gray-100">{mm.title || '기획 마인드맵'}{dirty && <span className="ml-1 text-amber-500">●</span>}</p>
            {mm.source_brand && <p className="truncate text-[11px] text-gray-400">출처: {mm.source_brand}</p>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {sourceUrl && (
            <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">
              <ExternalLink className="h-3.5 w-3.5" /> 원본 광고
            </a>
          )}
          <button onClick={save} disabled={saving || !dirty} className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-40">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} 저장
          </button>
          <button onClick={() => setPanelOpen((o) => !o)} className="flex items-center gap-1 rounded-lg border border-violet-300 bg-violet-50 px-2.5 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-100 dark:border-violet-800 dark:bg-violet-900/30 dark:text-violet-300">
            {panelOpen ? <PanelRightClose className="h-3.5 w-3.5" /> : <PanelRightOpen className="h-3.5 w-3.5" />} 기획안
          </button>
        </div>
      </div>

      {/* 좌상단 툴바 (빨간 박스 위치) */}
      <div className="absolute left-4 top-16 z-30 flex items-center gap-1 rounded-xl border border-gray-200 bg-white/95 p-1 shadow-lg backdrop-blur dark:border-gray-700 dark:bg-gray-900/95">
        <ToolBtn onClick={addNote} title="텍스트 블록 추가"><Type className="h-4 w-4" /></ToolBtn>
        <ToolBtn onClick={() => setConnectFrom((c) => (c ? null : selectedId || 'pick'))} active={!!connectFrom} title="연결 (노드 두 개 클릭)"><Link2 className="h-4 w-4" /></ToolBtn>
        <ToolBtn onClick={() => selectedId && deleteNode(selectedId)} disabled={!selectedId || nodeById(selectedId)?.type === 'center'} title="선택 삭제"><Trash2 className="h-4 w-4" /></ToolBtn>
        <div className="mx-0.5 h-5 w-px bg-gray-200 dark:bg-gray-700" />
        <ToolBtn onClick={undo} disabled={!past.length} title="실행취소 (Ctrl+Z)"><Undo2 className="h-4 w-4" /></ToolBtn>
        <ToolBtn onClick={redo} disabled={!future.length} title="다시실행 (Ctrl+Shift+Z)"><Redo2 className="h-4 w-4" /></ToolBtn>
      </div>
      {connectFrom && (
        <div className="absolute left-4 top-28 z-30 rounded-lg bg-violet-600 px-2.5 py-1.5 text-[11px] text-white shadow">연결할 노드 {connectFrom === 'pick' ? '두 개' : '하나 더'}를 클릭하세요 (Esc 취소)</div>
      )}

      {/* 캔버스 */}
      <div ref={viewportRef} data-bg="1" onMouseDown={onBgMouseDown} className="absolute inset-0 cursor-grab active:cursor-grabbing">
        <div className="absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
          {/* 엣지(선) — 노드 좌표를 직접 참조하므로 노드 이동 시 같이 움직임 */}
          <svg style={{ position: 'absolute', left: 0, top: 0, width: 1, height: 1, overflow: 'visible', pointerEvents: 'none' }}>
            {doc.edges.map((e) => {
              const a = nodeById(e.from), b = nodeById(e.to)
              if (!a || !b) return null
              return <line key={e.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={b.color || a.color || '#9CA3AF'} strokeWidth={2} strokeOpacity={0.4} />
            })}
          </svg>

          {doc.nodes.map((n) => (
            <NodeView
              key={n.id}
              n={n}
              selected={selectedId === n.id}
              editing={editingId === n.id}
              connectArmed={!!connectFrom}
              onMouseDown={(e) => onNodeMouseDown(e, n)}
              onDoubleClick={() => n.type !== 'center' && n.type !== 'chart' && setEditingId(n.id)}
              onCommit={(v) => commitEdit(n.id, v)}
              onCancel={() => setEditingId(null)}
            />
          ))}
        </div>
      </div>

      {/* 줌 컨트롤 */}
      <div className="absolute bottom-5 right-5 z-30 flex items-center gap-1 rounded-xl border border-gray-200 bg-white/95 p-1 shadow-lg backdrop-blur dark:border-gray-700 dark:bg-gray-900/95" style={{ right: panelOpen ? 360 : 20 }}>
        <ToolBtn onClick={() => zoomBy(1 / 1.2)} title="축소"><Minus className="h-4 w-4" /></ToolBtn>
        <button onClick={fitView} className="min-w-[52px] rounded-lg px-2 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800">{Math.round(view.k * 100)}%</button>
        <ToolBtn onClick={() => zoomBy(1.2)} title="확대"><Plus className="h-4 w-4" /></ToolBtn>
        <div className="mx-0.5 h-5 w-px bg-gray-200 dark:bg-gray-700" />
        <ToolBtn onClick={fitView} title="화면 맞춤"><Maximize2 className="h-4 w-4" /></ToolBtn>
      </div>

      {/* 조작 안내 */}
      <div className="absolute bottom-5 left-5 z-20 rounded-lg bg-black/60 px-2.5 py-1.5 text-[11px] text-white">
        휠=이동 · Ctrl+휠=확대/축소 · 노드 드래그=이동 · 더블클릭=편집
      </div>

      {/* 우측 패널: 기획안 생성 */}
      {panelOpen && (
        <div className="absolute bottom-0 right-0 top-12 z-20 flex w-[340px] flex-col border-l border-gray-200 bg-white shadow-xl dark:border-gray-800 dark:bg-gray-900">
          <div className="flex items-center justify-between border-b px-4 py-3 dark:border-gray-800">
            <span className="flex items-center gap-1.5 text-sm font-bold dark:text-gray-100"><Sparkles className="h-4 w-4 text-violet-500" /> 마인드맵 → 기획안</span>
            <button onClick={() => setPanelOpen(false)} className="rounded p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"><X className="h-4 w-4" /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {/* 브랜드 브리프 */}
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 text-xs">
              <div className="mb-1 font-bold text-gray-500 dark:text-gray-400">브랜드 브리프 {client?.name ? `· ${client.name}` : ''}</div>
              {client && (client.brand_brief || client.strengths || client.selling_points) ? (
                <div className="space-y-1 text-gray-600 dark:text-gray-300">
                  {client.brand_brief && <p><b>소개</b> {client.brand_brief}</p>}
                  {client.strengths && <p><b>강점</b> {client.strengths}</p>}
                  {client.selling_points && <p><b>소구점</b> {client.selling_points}</p>}
                </div>
              ) : (
                <p className="text-gray-400">
                  브리프가 비어 있어요.{' '}
                  <button onClick={() => router.push('/project-plans')} className="text-primary underline">기획안 제작</button>
                  에서 먼저 입력하면 더 정확한 기획안이 나와요.
                </p>
              )}
            </div>
            <button onClick={generatePlan} disabled={planLoading} className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50">
              {planLoading ? <><Loader2 className="h-4 w-4 animate-spin" /> 생성 중…</> : <><Sparkles className="h-4 w-4" /> 이 마인드맵으로 기획안 생성</>}
            </button>
            {plan && (
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-bold text-gray-400">생성된 기획안</span>
                  <button
                    onClick={() => { navigator.clipboard?.writeText(plan); setPlanCopied(true); setTimeout(() => setPlanCopied(false), 1500) }}
                    className="flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    {planCopied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} {planCopied ? '복사됨' : '복사'}
                  </button>
                </div>
                <pre className="whitespace-pre-wrap rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs leading-relaxed text-gray-700 dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-200" style={{ fontFamily: 'inherit' }}>{plan}</pre>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 미저장 이탈 가드 */}
      {confirmLeave && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setConfirmLeave(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-gray-900 p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-bold text-gray-900 dark:text-gray-100">저장하지 않은 변경이 있어요</div>
            <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">마인드맵 편집 내용이 저장되지 않았습니다.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => { setConfirmLeave(false); router.push('/plan-mindmap') }} className="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-1.5 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">닫기</button>
              <button onClick={async () => { const ok = await save(); if (ok) router.push('/plan-mindmap') }} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white hover:opacity-90">저장하고 닫기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ToolBtn({ children, onClick, disabled, active, title }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; active?: boolean; title?: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded-lg p-2 transition-colors disabled:opacity-30 ${active ? 'bg-violet-600 text-white' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'}`}
    >
      {children}
    </button>
  )
}

function NodeView({
  n, selected, editing, connectArmed, onMouseDown, onDoubleClick, onCommit, onCancel,
}: {
  n: MMNode; selected: boolean; editing: boolean; connectArmed: boolean
  onMouseDown: (e: React.MouseEvent) => void; onDoubleClick: () => void; onCommit: (v: string) => void; onCancel: () => void
}) {
  const [val, setVal] = useState(n.type === 'category' ? n.title || '' : n.text || '')
  useEffect(() => { setVal(n.type === 'category' ? n.title || '' : n.text || '') }, [editing])

  const ring = selected ? 'ring-2 ring-primary' : ''
  const base = `absolute -translate-x-1/2 -translate-y-1/2 rounded-xl shadow-md ${connectArmed ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'} ${ring}`
  const style: React.CSSProperties = { left: n.x, top: n.y, width: n.w || 200 }

  // 중앙(영상)
  if (n.type === 'center') {
    return (
      <div className={`${base} border-2 border-primary bg-white p-3 dark:bg-gray-900`} style={{ ...style, width: n.w || 240 }} onMouseDown={onMouseDown}>
        <div className="aspect-video w-full overflow-hidden rounded-lg bg-black">
          {n.media_type === 'video' && n.media_url ? (
            <video src={n.media_url} poster={n.poster || undefined} controls playsInline preload="metadata" className="h-full w-full bg-black object-contain" onMouseDown={(e) => e.stopPropagation()} />
          ) : n.poster ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={n.poster} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs text-gray-400">소재</div>
          )}
        </div>
        <p className="mt-2 line-clamp-2 text-sm font-bold text-gray-900 dark:text-gray-100">{n.title}</p>
      </div>
    )
  }

  // 차트
  if (n.type === 'chart') {
    return (
      <div className={`${base} border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900`} style={style} onMouseDown={onMouseDown}>
        <div className="mb-1.5 text-xs font-bold text-gray-700 dark:text-gray-200">📊 {n.title}</div>
        <Chart chart={n.chart} />
      </div>
    )
  }

  // 나레이션 원문
  if (n.type === 'narration') {
    return (
      <div className={`${base} border border-violet-200 bg-violet-50/70 p-3 dark:border-violet-900 dark:bg-violet-950/30`} style={style} onMouseDown={onMouseDown} onDoubleClick={onDoubleClick}>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-bold text-violet-700 dark:text-violet-300">🎙️ {n.title}</span>
          <button onMouseDown={(e) => e.stopPropagation()} onClick={() => navigator.clipboard?.writeText(n.text || '')} className="text-[10px] text-violet-600 hover:underline">복사</button>
        </div>
        {editing ? (
          <EditBox val={val} setVal={setVal} onCommit={() => onCommit(val)} onCancel={onCancel} rows={6} />
        ) : (
          <p className="max-h-40 overflow-y-auto whitespace-pre-wrap text-[12px] leading-snug text-gray-700 dark:text-gray-200">{n.text}</p>
        )}
      </div>
    )
  }

  // 카테고리 / 항목 / 메모
  const accent = n.color || '#6366F1'
  const isCat = n.type === 'category'
  return (
    <div
      className={`${base} border-2 bg-white p-2.5 dark:bg-gray-900`}
      style={{ ...style, borderColor: isCat ? accent : n.type === 'note' ? '#CBD5E1' : `${accent}55` }}
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
    >
      {isCat ? (
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: accent }} />
          {editing ? <EditBox val={val} setVal={setVal} onCommit={() => onCommit(val)} onCancel={onCancel} rows={1} /> : <span className="text-sm font-bold text-gray-900 dark:text-gray-100">{n.title}</span>}
        </div>
      ) : editing ? (
        <EditBox val={val} setVal={setVal} onCommit={() => onCommit(val)} onCancel={onCancel} rows={2} />
      ) : (
        <p className={`text-[12px] leading-snug ${n.type === 'note' ? 'text-gray-600 dark:text-gray-300' : 'text-gray-700 dark:text-gray-200'}`}>{n.text}</p>
      )}
    </div>
  )
}

function EditBox({ val, setVal, onCommit, onCancel, rows }: { val: string; setVal: (v: string) => void; onCommit: () => void; onCancel: () => void; rows: number }) {
  return (
    <textarea
      autoFocus
      value={val}
      rows={rows}
      onMouseDown={(e) => e.stopPropagation()}
      onChange={(e) => setVal(e.target.value)}
      onBlur={onCommit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onCommit() }
        if (e.key === 'Escape') onCancel()
      }}
      className="w-full resize-none rounded border border-primary/40 bg-white p-1 text-[12px] dark:bg-gray-800 dark:text-gray-100"
    />
  )
}

function Chart({ chart }: { chart?: { kind: 'bar' | 'line'; data: { label: string; value: number }[] } }) {
  if (!chart || !chart.data?.length) return <p className="text-[11px] text-gray-400">데이터 없음</p>
  const W = 264, H = 92, pad = 6
  const max = Math.max(1, ...chart.data.map((d) => d.value))
  if (chart.kind === 'line') {
    const stepX = (W - pad * 2) / Math.max(1, chart.data.length - 1)
    const pts = chart.data.map((d, i) => `${pad + i * stepX},${H - pad - (d.value / max) * (H - pad * 2)}`).join(' ')
    return (
      <svg width={W} height={H} className="overflow-visible">
        <polyline points={pts} fill="none" stroke="#8B5CF6" strokeWidth={2} />
        {chart.data.map((d, i) => (
          <circle key={i} cx={pad + i * stepX} cy={H - pad - (d.value / max) * (H - pad * 2)} r={2.5} fill="#8B5CF6" />
        ))}
        {chart.data.map((d, i) => (
          <text key={i} x={pad + i * stepX} y={H} fontSize={7} textAnchor="middle" fill="#9CA3AF">{d.label}</text>
        ))}
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
