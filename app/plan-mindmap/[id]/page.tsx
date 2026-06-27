'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  ArrowLeft, ExternalLink, Plus, Minus, Maximize2, Loader2, Save, Undo2, Redo2,
  Trash2, Type, Link2, Unlink, ImagePlus, Sparkles, X, ChevronsLeft, ChevronsRight, BoxSelect, PanelLeftOpen,
} from 'lucide-react'
import { getMindmap, updateMindmap, Mindmap, MMDoc, MMNode, MMEdge, MindmapData } from '@/lib/api/mindmaps'
import { getClient, Client } from '@/lib/api/clients'
import { supabase } from '@/lib/supabase'
import { aiFetch } from '@/lib/ai-fetch'

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const uid = () => Math.random().toString(36).slice(2, 9)
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
const SOURCE_W = 360

// 기획안 섹션(각각 병렬 스트리밍 → 동시 타이핑). 대본은 우측 한 면.
const PLAN_LEFT = [
  { key: 'concept', label: '한 줄 컨셉' },
  { key: 'target', label: '타겟 세그먼트' },
  { key: 'selling', label: '핵심 소구점' },
  { key: 'hook', label: '후킹 (0~3초)' },
  { key: 'flow', label: '전개' },
  { key: 'cta', label: 'CTA' },
]
const PLAN_KEYS = [...PLAN_LEFT.map((s) => s.key), 'script']

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

// 레거시/AI 출력(data)을 편집 캔버스 그래프(MMDoc v2)로 변환.
// 가지들을 중앙 둘레에 균등 배치(겹침 방지)하되, 나레이션은 '대본' 옆, 추가세그먼트는 '세그먼트' 옆에 인접 배치.
function buildDoc(raw: MindmapData | MMDoc | undefined, mm: Mindmap): MMDoc {
  if (raw && (raw as MMDoc).version === 2 && Array.isArray((raw as MMDoc).nodes)) return clone(raw as MMDoc)
  const legacy = (raw || { nodes: [] }) as MindmapData
  const nodes: MMNode[] = []
  const edges: MMEdge[] = []
  nodes.push({
    id: 'center', type: 'center', x: 0, y: 0, title: mm.title || legacy.summary || '소재',
    media_url: legacy.media?.url ?? null, media_type: legacy.media?.type ?? null,
    poster: legacy.media?.poster ?? mm.source_thumb ?? null, w: 210,
  })
  const all = legacy.nodes || []
  const cats = all.filter((n) => n.key !== 'segment2')
  const seg2 = all.find((n) => n.key === 'segment2')

  type B = { kind: 'category'; cat: { key: string; label: string; items: string[] } } | { kind: 'narration' } | { kind: 'segment2' } | { kind: 'chart'; ch: NonNullable<MindmapData['charts']>[number] }
  const order: B[] = []
  cats.forEach((cat) => {
    order.push({ kind: 'category', cat })
    if (cat.key === 'script') order.push({ kind: 'narration' }) // 항상 생성(없으면 안내문)
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
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [connectFrom, setConnectFrom] = useState<string | null>(null)
  const [disconnectFrom, setDisconnectFrom] = useState<string | null>(null)
  const [marqueeMode, setMarqueeMode] = useState(false)
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [centerAspect, setCenterAspect] = useState(9 / 16)
  const [sourceTabOpen, setSourceTabOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [adMeta, setAdMeta] = useState<{ started_on?: string; first_seen_at?: string; last_seen_at?: string; country?: string; status?: string; media_type?: string; landing_url?: string } | null>(null)

  const [panelOpen, setPanelOpen] = useState(false)
  const [client, setClient] = useState<Client | null>(null)
  const [planModal, setPlanModal] = useState(false)
  const [sections, setSections] = useState<Record<string, string>>({})
  const [secLoading, setSecLoading] = useState<Record<string, boolean>>({})

  const viewportRef = useRef<HTMLDivElement>(null)
  const centerVideoRef = useRef<HTMLVideoElement | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [view, setView] = useState({ x: 0, y: 0, k: 1 })

  const panning = useRef(false)
  const lastPan = useRef({ x: 0, y: 0 })
  const nodeDrag = useRef<{ ids: string[]; lastX: number; lastY: number; moved: boolean } | null>(null)
  const marqueeRef = useRef<{ sx: number; sy: number } | null>(null)
  const resizing = useRef<{ id: string; dir: string; sw: number; sh: number; sx: number; sy: number; nx: number; ny: number; ratio: number; moved: boolean } | null>(null)

  useEffect(() => {
    if (!params?.id) return
    let alive = true
    getMindmap(params.id)
      .then(async (d) => {
        if (!alive) return
        if (!d) { setState('notfound'); return }
        setMm(d)
        // 소재 광고 메타데이터(별도 탭에서 보여줌 + 미디어/나레이션 보강)
        let ad: { media_url?: string; media_type?: string; poster_url?: string; transcript?: string; started_on?: string; first_seen_at?: string; last_seen_at?: string; country?: string; status?: string; landing_url?: string } | null = null
        if (d.library_id) {
          try { ad = await fetch(`/api/meta-ad/public/${d.library_id}`).then((r) => (r.ok ? r.json() : null)) } catch {}
        }
        if (ad && alive) setAdMeta(ad)
        const isV2 = !!d.data && (d.data as MMDoc).version === 2
        let raw = d.data as MindmapData | MMDoc | undefined
        if (!isV2) {
          const r = { ...((raw as MindmapData) || { nodes: [] }) } as MindmapData
          if (ad) {
            r.media = r.media || { url: ad.media_url, type: ad.media_type, poster: ad.poster_url }
            if (!r.narration && ad.transcript) r.narration = ad.transcript
          }
          raw = r
        }
        const built = buildDoc(raw, d)
        if (isV2) {
          const center = built.nodes.find((n) => n.type === 'center')
          if (center && !center.media_url && ad) { center.media_url = ad.media_url || null; center.media_type = ad.media_type || null; center.poster = center.poster || ad.poster_url || null }
        }
        setDoc(built)
        if (built.plan && Object.keys(built.plan).length) setSections(built.plan)
        setState('ready')
        if (d.client_id) getClient(d.client_id).then((c) => alive && setClient(c)).catch(() => {})
      })
      .catch(() => alive && setState('notfound'))
    return () => { alive = false }
  }, [params?.id])

  const fitView = useCallback(() => {
    const el = viewportRef.current
    const ns = docRef.current.nodes
    if (!el || !ns.length) return
    const HW = 150, HH = 130
    const xs = ns.map((n) => n.x), ys = ns.map((n) => n.y)
    const minX = Math.min(...xs) - HW, maxX = Math.max(...xs) + HW
    const minY = Math.min(...ys) - HH, maxY = Math.max(...ys) + HH
    const w = maxX - minX, h = maxY - minY
    const k = clamp(Math.min(el.clientWidth / w, el.clientHeight / h), 0.2, 1.6)
    setView({ k, x: el.clientWidth / 2 - ((minX + maxX) / 2) * k, y: el.clientHeight / 2 - ((minY + maxY) / 2) * k })
  }, [])
  useEffect(() => { if (state === 'ready') setTimeout(fitView, 40) }, [state, fitView])
  useEffect(() => { if (state === 'ready') setTimeout(fitView, 60) }, [sourceTabOpen]) // eslint-disable-line react-hooks/exhaustive-deps

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
  }, [state])

  const beginHistory = useCallback(() => { setPast((p) => [...p.slice(-60), clone(docRef.current)]); setFuture([]); setDirty(true) }, [])
  const mutate = useCallback((producer: (d: MMDoc) => MMDoc) => { beginHistory(); setDoc((d) => producer(clone(d))) }, [beginHistory])
  const undo = useCallback(() => { setPast((p) => { if (!p.length) return p; setFuture((f) => [clone(docRef.current), ...f]); setDoc(p[p.length - 1]); setDirty(true); setEditingId(null); return p.slice(0, -1) }) }, [])
  const redo = useCallback(() => { setFuture((f) => { if (!f.length) return f; setPast((p) => [...p, clone(docRef.current)]); setDoc(f[0]); setDirty(true); setEditingId(null); return f.slice(1) }) }, [])

  function onBgMouseDown(e: React.MouseEvent) {
    if ((e.target as HTMLElement)?.dataset?.bg !== '1') return
    if (marqueeMode) {
      const rect = viewportRef.current!.getBoundingClientRect()
      marqueeRef.current = { sx: e.clientX, sy: e.clientY }
      setMarquee({ x: e.clientX - rect.left, y: e.clientY - rect.top, w: 0, h: 0 })
    } else {
      setSelectedIds([]); setConnectFrom(null); setDisconnectFrom(null)
      panning.current = true; lastPan.current = { x: e.clientX, y: e.clientY }
    }
  }

  function onNodeMouseDown(e: React.MouseEvent, n: MMNode) {
    e.stopPropagation()
    if (connectFrom) {
      if (connectFrom === 'pick') { setConnectFrom(n.id); return }
      if (connectFrom !== n.id) mutate((d) => {
        if (!d.edges.some((ed) => (ed.from === connectFrom && ed.to === n.id) || (ed.from === n.id && ed.to === connectFrom)))
          d.edges.push({ id: uid(), from: connectFrom, to: n.id })
        // 색상 상속: 기본색(회색 #64748B) 노드 ↔ 색 있는 노드 연결 시, 회색 노드가 부모 색을 복사.
        // 이미 둘 다 색이 있으면(카테고리끼리) 변경하지 않음.
        const DEF = '#64748B'
        const fromN = d.nodes.find((x) => x.id === connectFrom)
        const toN = d.nodes.find((x) => x.id === n.id)
        if (fromN && toN) {
          const fromDef = !fromN.color || fromN.color === DEF
          const toDef = !toN.color || toN.color === DEF
          if (fromDef && !toDef) fromN.color = toN.color
          else if (toDef && !fromDef) toN.color = fromN.color
        }
        return d
      })
      setConnectFrom(null); return
    }
    if (disconnectFrom) {
      if (disconnectFrom === 'pick') { setDisconnectFrom(n.id); return }
      if (disconnectFrom !== n.id) mutate((d) => ({ ...d, edges: d.edges.filter((ed) => !((ed.from === disconnectFrom && ed.to === n.id) || (ed.from === n.id && ed.to === disconnectFrom))) }))
      setDisconnectFrom(null); return
    }
    const already = selectedIds.includes(n.id)
    const dragIds = already ? selectedIds : [n.id]
    if (!already) setSelectedIds([n.id])
    nodeDrag.current = { ids: dragIds, lastX: e.clientX, lastY: e.clientY, moved: false }
  }

  function onResizeStart(e: React.MouseEvent, n: MMNode, dir: string) {
    e.stopPropagation()
    const el = (e.currentTarget as HTMLElement).closest('[data-node]') as HTMLElement | null
    const sw = el?.offsetWidth || n.w || 200
    const sh = el?.offsetHeight || 120
    resizing.current = { id: n.id, dir, sw, sh, sx: e.clientX, sy: e.clientY, nx: n.x, ny: n.y, ratio: sw / Math.max(1, sh), moved: false }
  }

  useEffect(() => {
    function move(e: MouseEvent) {
      if (resizing.current) {
        const r = resizing.current
        if (!r.moved) { r.moved = true; beginHistory() }
        const k = view.k || 1
        const dx = (e.clientX - r.sx) / k, dy = (e.clientY - r.sy) / k
        let w = r.sw, h = r.sh
        const corner = r.dir.length === 2
        if (corner) {
          const signX = r.dir.includes('e') ? 1 : -1
          w = clamp(r.sw + signX * dx, 130, 900)
          h = w / r.ratio // 대각선 = 비율 유지
        } else {
          if (r.dir === 'e') w = clamp(r.sw + dx, 130, 900)
          if (r.dir === 'w') w = clamp(r.sw - dx, 130, 900)
          if (r.dir === 's') h = clamp(r.sh + dy, 70, 900)
          if (r.dir === 'n') h = clamp(r.sh - dy, 70, 900)
        }
        let nx = r.nx, ny = r.ny
        if (r.dir.includes('e')) nx = r.nx + (w - r.sw) / 2
        if (r.dir.includes('w')) nx = r.nx - (w - r.sw) / 2
        if (r.dir.includes('s')) ny = r.ny + (h - r.sh) / 2
        if (r.dir.includes('n')) ny = r.ny - (h - r.sh) / 2
        setDoc((d) => ({ ...d, nodes: d.nodes.map((nn) => (nn.id === r.id ? { ...nn, w, h, x: nx, y: ny } : nn)) }))
        setDirty(true); return
      }
      if (panning.current) {
        const dx = e.clientX - lastPan.current.x, dy = e.clientY - lastPan.current.y
        lastPan.current = { x: e.clientX, y: e.clientY }
        setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy })); return
      }
      if (marqueeRef.current) {
        const rect = viewportRef.current!.getBoundingClientRect()
        const x0 = marqueeRef.current.sx - rect.left, y0 = marqueeRef.current.sy - rect.top
        const x1 = e.clientX - rect.left, y1 = e.clientY - rect.top
        setMarquee({ x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) }); return
      }
      const nd = nodeDrag.current
      if (nd) {
        if (!nd.moved) { nd.moved = true; beginHistory() }
        const k = view.k || 1
        const dx = (e.clientX - nd.lastX) / k, dy = (e.clientY - nd.lastY) / k
        nd.lastX = e.clientX; nd.lastY = e.clientY
        setDoc((d) => ({ ...d, nodes: d.nodes.map((n) => (nd.ids.includes(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n)) }))
        setDirty(true)
      }
    }
    function up(e: MouseEvent) {
      if (marqueeRef.current) {
        const rect = viewportRef.current!.getBoundingClientRect()
        const x0 = marqueeRef.current.sx - rect.left, y0 = marqueeRef.current.sy - rect.top
        const x1 = e.clientX - rect.left, y1 = e.clientY - rect.top
        const rL = (Math.min(x0, x1) - view.x) / view.k, rR = (Math.max(x0, x1) - view.x) / view.k
        const rT = (Math.min(y0, y1) - view.y) / view.k, rB = (Math.max(y0, y1) - view.y) / view.k
        const ids = docRef.current.nodes.filter((n) => {
          const hw = (n.w || 200) / 2, hh = halfH(n)
          return n.x - hw <= rR && n.x + hw >= rL && n.y - hh <= rB && n.y + hh >= rT
        }).map((n) => n.id)
        setSelectedIds(ids); marqueeRef.current = null; setMarquee(null); setMarqueeMode(false)
      }
      panning.current = false; nodeDrag.current = null; resizing.current = null
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
  }, [view.x, view.y, view.k, beginHistory])

  function deleteSelected() {
    const ids = selectedIds.filter((id) => { const n = docRef.current.nodes.find((x) => x.id === id); return n && n.type !== 'center' })
    if (!ids.length) return
    mutate((d) => ({ ...d, nodes: d.nodes.filter((n) => !ids.includes(n.id)), edges: d.edges.filter((e) => !ids.includes(e.from) && !ids.includes(e.to)) }))
    setSelectedIds([])
  }
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement
      if (['input', 'textarea'].includes((t?.tagName || '').toLowerCase()) || t?.isContentEditable) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo() }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo() }
      else if (e.key === 'Delete' || e.key === 'Backspace') { if (selectedIds.length) { e.preventDefault(); deleteSelected() } }
      else if (e.key === 'Escape') { setConnectFrom(null); setDisconnectFrom(null); setEditingId(null); setMarqueeMode(false) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedIds, undo, redo])

  function addNote() {
    const el = viewportRef.current
    const cx = el ? (el.clientWidth / 2 - view.x) / view.k : 0
    const cy = el ? (el.clientHeight / 2 - view.y) / view.k : 0
    const id = uid()
    mutate((d) => { d.nodes.push({ id, type: 'note', x: cx, y: cy, text: '새 메모', color: '#64748B', w: 200 }); return d })
    setSelectedIds([id]); setEditingId(id)
  }
  async function addImage(file: File) {
    setUploading(true)
    try {
      const ext = (file.name.split('.').pop() || 'png').toLowerCase()
      const path = `mindmap-img/${uid()}.${ext}`
      const { error } = await supabase.storage.from('shooting-guides').upload(path, file, { contentType: file.type || 'image/png', upsert: true })
      if (error) { alert('이미지 업로드 실패: ' + error.message); return }
      const url = supabase.storage.from('shooting-guides').getPublicUrl(path).data.publicUrl
      const el = viewportRef.current
      const cx = el ? (el.clientWidth / 2 - view.x) / view.k : 0
      const cy = el ? (el.clientHeight / 2 - view.y) / view.k : 0
      const id = uid()
      mutate((d) => { d.nodes.push({ id, type: 'image', x: cx, y: cy, media_url: url, w: 220 }); return d })
      setSelectedIds([id])
    } catch (e) {
      alert('이미지 추가 중 오류: ' + (e instanceof Error ? e.message : ''))
    } finally {
      setUploading(false)
    }
  }
  function commitEdit(id: string, value: string) {
    mutate((d) => ({ ...d, nodes: d.nodes.map((n) => { if (n.id !== id) return n; if (n.type === 'category') return { ...n, items: value.split('\n').map((s) => s.trim()).filter(Boolean) }; return { ...n, text: value } }) }))
    setEditingId(null)
  }

  function zoomBy(factor: number) {
    const el = viewportRef.current
    if (!el) return
    const mx = el.clientWidth / 2, my = el.clientHeight / 2
    setView((v) => { const k2 = clamp(v.k * factor, 0.15, 3); const wx = (mx - v.x) / v.k, wy = (my - v.y) / v.k; return { k: k2, x: mx - wx * k2, y: my - wy * k2 } })
  }

  function openSource() { centerVideoRef.current?.pause(); setSourceTabOpen(true) }

  async function save(): Promise<boolean> {
    if (!mm) return false
    setSaving(true)
    try { await updateMindmap(mm.id, { data: doc }); setDirty(false); return true }
    catch { alert('저장에 실패했습니다.'); return false }
    finally { setSaving(false) }
  }
  function requestLeave() { dirty ? setConfirmLeave(true) : router.push('/plan-mindmap') }
  useEffect(() => { function bu(e: BeforeUnloadEvent) { if (dirty) { e.preventDefault(); e.returnValue = '' } } window.addEventListener('beforeunload', bu); return () => window.removeEventListener('beforeunload', bu) }, [dirty])

  // 한 섹션을 스트리밍으로 받아 해당 박스에 실시간 타이핑. 완료 텍스트를 반환(저장용).
  async function streamSection(key: string): Promise<string> {
    setSecLoading((s) => ({ ...s, [key]: true }))
    try {
      const cur = docRef.current
      const cats = cur.nodes.filter((n) => n.type === 'category')
      const nodesForPlan = cats.map((c) => ({ label: c.title, items: c.items || [] }))
      const notes = cur.nodes.filter((n) => n.type === 'note' && n.text).map((n) => ({ label: '메모', items: [n.text!] }))
      const narration = cur.nodes.find((n) => n.type === 'narration')?.text || ''
      const res = await aiFetch('/api/ai/plan-from-mindmap', {
        method: 'POST',
        body: JSON.stringify({
          section: key,
          mindmap: { summary: cur.summary, nodes: [...nodesForPlan, ...notes] },
          reference_narration: narration,
          brief: { selling_points: client?.selling_points || '', segment: client?.segment || '' },
          brand_name: client?.name || mm?.source_brand || '우리 브랜드',
        }),
      })
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}))
        const msg = j.error || '생성 실패'
        setSections((s) => ({ ...s, [key]: msg }))
        return msg
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let acc = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        acc += decoder.decode(value, { stream: true })
        setSections((s) => ({ ...s, [key]: acc }))
      }
      return acc
    } catch {
      const msg = '오류가 발생했어요.'
      setSections((s) => ({ ...s, [key]: msg }))
      return msg
    } finally {
      setSecLoading((s) => ({ ...s, [key]: false }))
    }
  }

  // 모든 섹션을 "동시에" 병렬 생성 → 완료되면 doc.plan 에 저장(닫아도 다시 열기 가능)
  async function generatePlan() {
    setPlanModal(true)
    setSections({})
    setSecLoading({})
    const results = await Promise.all(PLAN_KEYS.map(async (k) => [k, await streamSection(k)] as const))
    const final = Object.fromEntries(results) as Record<string, string>
    if (mm) {
      const newDoc = { ...docRef.current, plan: final }
      setDoc(newDoc)
      try { await updateMindmap(mm.id, { data: newDoc }); setDirty(false) } catch {}
    }
  }

  if (state === 'loading') return <div className="flex h-full items-center justify-center text-gray-400"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> 마인드맵 불러오는 중…</div>
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
  const center = doc.nodes.find((n) => n.type === 'center')
  const off = sourceTabOpen ? SOURCE_W : 0
  const hint = connectFrom ? `연결할 노드 ${connectFrom === 'pick' ? '두 개' : '하나 더'}를 클릭 (Esc 취소)`
    : disconnectFrom ? `연결을 끊을 노드 ${disconnectFrom === 'pick' ? '두 개' : '하나 더'}를 클릭 (Esc 취소)`
      : marqueeMode ? '빈 곳을 드래그해 여러 노드를 선택 (Esc 취소)' : ''

  return (
    <div className="relative -m-8 h-screen overflow-hidden bg-[radial-gradient(circle,#e5e7eb_1px,transparent_1px)] [background-size:22px_22px] dark:bg-gray-950">
      <input ref={fileRef} type="file" accept="image/*,image/gif" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) addImage(f); e.target.value = '' }} />

      {/* 상단 바 */}
      <div className="absolute left-0 right-0 top-0 z-40 flex items-center justify-between gap-2 border-b border-gray-200 bg-white/90 px-4 py-2.5 backdrop-blur dark:border-gray-800 dark:bg-gray-900/90">
        <div className="flex min-w-0 items-center gap-3">
          <button onClick={requestLeave} className="flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"><ArrowLeft className="h-3.5 w-3.5" /> 목록</button>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold dark:text-gray-100">{mm.title || '기획 마인드맵'}{dirty && <span className="ml-1 text-amber-500">●</span>}</p>
            {mm.source_brand && <p className="truncate text-[11px] text-gray-400">출처: {mm.source_brand}</p>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {sourceUrl && <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"><ExternalLink className="h-3.5 w-3.5" /> 원본 광고</a>}
          <button onClick={save} disabled={saving || !dirty} className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-40">{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} 저장</button>
        </div>
      </div>

      {/* 별도 탭(소재 미리보기) */}
      {sourceTabOpen && (
        <div className="absolute bottom-0 left-0 top-12 z-30 flex flex-col border-r border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900" style={{ width: SOURCE_W }}>
          <div className="flex items-center justify-between border-b px-5 py-4 dark:border-gray-800">
            <span className="text-sm font-bold dark:text-gray-100">소재 미리보기</span>
            <button onClick={() => setSourceTabOpen(false)} className="flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"><X className="h-3.5 w-3.5" /> 탭 닫기</button>
          </div>
          <div className="flex-1 overflow-y-auto p-5">
            <div className="mx-auto w-full max-w-[300px] overflow-hidden rounded-xl bg-black" style={{ aspectRatio: String(centerAspect) }}>
              {center?.media_type === 'video' && center?.media_url ? (
                <video src={center.media_url} poster={center.poster || undefined} controls autoPlay playsInline className="h-full w-full bg-black object-contain" />
              ) : center?.poster ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={center.poster} alt="" className="h-full w-full object-contain" />
              ) : <div className="flex h-full w-full items-center justify-center text-xs text-gray-400">소재 없음</div>}
            </div>
            <p className="mt-3 text-sm font-semibold dark:text-gray-100">{center?.title}</p>
            {adMeta && (
              <div className="mt-3 space-y-2 rounded-lg border border-gray-200 p-3 text-xs dark:border-gray-700">
                <div className="grid grid-cols-2 gap-y-2">
                  <div><div className="text-[10px] text-gray-400">시작일</div><div className="font-medium text-gray-700 dark:text-gray-200">{adMeta.started_on || '—'}</div></div>
                  <div><div className="text-[10px] text-gray-400">국가</div><div className="font-medium text-gray-700 dark:text-gray-200">{adMeta.country || '—'}</div></div>
                  <div><div className="text-[10px] text-gray-400">상태</div><div className="font-medium text-gray-700 dark:text-gray-200">{adMeta.status === 'ended' ? '종료' : '활성'}</div></div>
                  <div><div className="text-[10px] text-gray-400">유형</div><div className="font-medium text-gray-700 dark:text-gray-200">{adMeta.media_type === 'video' ? '영상' : adMeta.media_type === 'carousel' ? '슬라이드' : '이미지'}</div></div>
                </div>
                <div className="space-y-1 border-t pt-2 dark:border-gray-700">
                  {mm.library_id && <a href={`https://www.facebook.com/ads/library/?id=${mm.library_id}`} target="_blank" rel="noopener noreferrer" className="block truncate text-blue-600 underline">광고 라이브러리 ↗</a>}
                  {adMeta.landing_url ? <a href={adMeta.landing_url} target="_blank" rel="noopener noreferrer" className="block truncate text-blue-600 underline">랜딩 페이지 ↗</a> : <span className="block text-gray-400">랜딩 페이지 없음</span>}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 좌상단 툴바 */}
      <div className="absolute top-16 z-30 flex items-center gap-1 rounded-xl border border-gray-200 bg-white/95 p-1 shadow-lg backdrop-blur dark:border-gray-700 dark:bg-gray-900/95" style={{ left: off + 16 }}>
        <ToolBtn onClick={() => { setMarqueeMode((m) => !m); setConnectFrom(null); setDisconnectFrom(null) }} active={marqueeMode} title="드래그 선택 (여러 노드)"><BoxSelect className="h-4 w-4" /></ToolBtn>
        <ToolBtn onClick={addNote} title="텍스트 블록 추가"><Type className="h-4 w-4" /></ToolBtn>
        <ToolBtn onClick={() => fileRef.current?.click()} disabled={uploading} title="이미지/GIF 추가">{uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}</ToolBtn>
        <ToolBtn onClick={() => { setConnectFrom((c) => (c ? null : selectedIds[0] || 'pick')); setDisconnectFrom(null); setMarqueeMode(false) }} active={!!connectFrom} title="연결 (노드 두 개 클릭)"><Link2 className="h-4 w-4" /></ToolBtn>
        <ToolBtn onClick={() => { setDisconnectFrom((c) => (c ? null : selectedIds[0] || 'pick')); setConnectFrom(null); setMarqueeMode(false) }} active={!!disconnectFrom} title="연결 끊기 (노드 두 개 클릭)"><Unlink className="h-4 w-4" /></ToolBtn>
        <ToolBtn onClick={deleteSelected} disabled={!selectedIds.some((id) => nodeById(id)?.type !== 'center')} title="선택 삭제"><Trash2 className="h-4 w-4" /></ToolBtn>
        <div className="mx-0.5 h-5 w-px bg-gray-200 dark:bg-gray-700" />
        <ToolBtn onClick={undo} disabled={!past.length} title="실행취소 (Ctrl+Z)"><Undo2 className="h-4 w-4" /></ToolBtn>
        <ToolBtn onClick={redo} disabled={!future.length} title="다시실행 (Ctrl+Shift+Z)"><Redo2 className="h-4 w-4" /></ToolBtn>
      </div>
      {hint && <div className="absolute top-28 z-30 rounded-lg bg-violet-600 px-2.5 py-1.5 text-[11px] text-white shadow" style={{ left: off + 16 }}>{hint}</div>}

      {/* 캔버스 */}
      <div ref={viewportRef} data-bg="1" onMouseDown={onBgMouseDown} className={`absolute bottom-0 right-0 top-0 ${marqueeMode ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'}`} style={{ left: off }}>
        <div className="absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
          <svg style={{ position: 'absolute', left: 0, top: 0, width: 1, height: 1, overflow: 'visible', pointerEvents: 'none' }}>
            {doc.edges.map((e) => {
              const a = nodeById(e.from), b = nodeById(e.to)
              if (!a || !b) return null
              return <line key={e.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={b.color || a.color || '#9CA3AF'} strokeWidth={2} strokeOpacity={0.4} />
            })}
          </svg>
          {doc.nodes.map((n) => (
            <NodeView
              key={n.id} n={n} selected={selectedIds.includes(n.id)} editing={editingId === n.id}
              armed={!!connectFrom || !!disconnectFrom} centerAspect={centerAspect} onCenterAspect={setCenterAspect} centerVideoRef={centerVideoRef}
              onMouseDown={(e) => onNodeMouseDown(e, n)}
              onDoubleClick={() => (n.type === 'category' || n.type === 'note' || n.type === 'narration') && setEditingId(n.id)}
              onCommit={(v) => commitEdit(n.id, v)} onCancel={() => setEditingId(null)}
              onResizeStart={(e, dir) => onResizeStart(e, n, dir)} onOpenSource={openSource}
            />
          ))}
        </div>
        {marquee && <div className="pointer-events-none absolute z-20 rounded border-2 border-primary/60 bg-primary/10" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />}
      </div>

      {/* 우측 플로팅 탭 */}
      <button onClick={() => setPanelOpen((o) => !o)} title="기획안 패널" className="absolute top-1/2 z-30 flex h-16 w-7 -translate-y-1/2 items-center justify-center rounded-l-lg border border-r-0 border-gray-200 bg-white text-violet-600 shadow-md hover:bg-violet-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800" style={{ right: panelOpen ? 340 : 0 }}>
        {panelOpen ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
      </button>

      {/* 줌 컨트롤 */}
      <div className="absolute bottom-5 z-30 flex items-center gap-1 rounded-xl border border-gray-200 bg-white/95 p-1 shadow-lg backdrop-blur dark:border-gray-700 dark:bg-gray-900/95" style={{ right: panelOpen ? 360 : 20 }}>
        <ToolBtn onClick={() => zoomBy(1 / 1.2)} title="축소"><Minus className="h-4 w-4" /></ToolBtn>
        <button onClick={fitView} className="min-w-[52px] rounded-lg px-2 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800">{Math.round(view.k * 100)}%</button>
        <ToolBtn onClick={() => zoomBy(1.2)} title="확대"><Plus className="h-4 w-4" /></ToolBtn>
        <div className="mx-0.5 h-5 w-px bg-gray-200 dark:bg-gray-700" />
        <ToolBtn onClick={fitView} title="화면 맞춤"><Maximize2 className="h-4 w-4" /></ToolBtn>
      </div>

      <div className="absolute bottom-5 z-20 rounded-lg bg-black/60 px-2.5 py-1.5 text-[11px] text-white" style={{ left: off + 20 }}>휠=이동 · <b>Alt(또는 Ctrl)+휠=확대/축소</b> · 노드 드래그=이동 · 더블클릭=편집 · 가장자리=크기조절</div>

      {/* 우측 패널 */}
      {panelOpen && (
        <div className="absolute bottom-0 right-0 top-12 z-30 flex w-[340px] flex-col border-l border-gray-200 bg-white shadow-xl dark:border-gray-800 dark:bg-gray-900">
          <div className="flex items-center justify-between border-b px-4 pb-3.5 pt-5 dark:border-gray-800">
            <span className="flex items-center gap-1.5 text-sm font-bold dark:text-gray-100"><Sparkles className="h-4 w-4 text-violet-500" /> 마인드맵 → 기획안</span>
            <button onClick={() => setPanelOpen(false)} className="rounded p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"><X className="h-4 w-4" /></button>
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 text-xs">
              <div className="mb-1 font-bold text-gray-500 dark:text-gray-400">브랜드 브리프 {client?.name ? `· ${client.name}` : ''}</div>
              {client && (client.selling_points || client.segment) ? (
                <div className="space-y-1 text-gray-600 dark:text-gray-300">
                  {client.selling_points && <p><b>소구점</b> {client.selling_points}</p>}
                  {client.segment && <p><b>세그먼트</b> {client.segment}</p>}
                </div>
              ) : <p className="text-gray-400">브리프가 비어 있어요. <button onClick={() => router.push('/project-plans')} className="text-primary underline">기획안 제작</button>에서 먼저 입력하면 더 정확해져요.</p>}
            </div>
            {Object.keys(sections).length ? (
              <div className="flex gap-2">
                <button onClick={() => setPlanModal(true)} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-violet-700"><Sparkles className="h-4 w-4" /> 기획안 보기</button>
                <button onClick={generatePlan} title="다시 생성" className="rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">다시</button>
              </div>
            ) : (
              <button onClick={generatePlan} className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-violet-700"><Sparkles className="h-4 w-4" /> 이 마인드맵으로 기획안 생성</button>
            )}
            <p className="text-[11px] text-gray-400">별도 창에서 섹션별로 동시에 작성돼요. 생성 후 자동 저장 — 닫아도 &apos;기획안 보기&apos;로 다시 열 수 있어요.</p>
          </div>
        </div>
      )}

      {/* 기획안 플로팅 — 섹션별 박스 동시 타이핑, 대본은 우측 한 면 */}
      {planModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={() => setPlanModal(false)}>
          <div className="flex max-h-[90vh] w-[94vw] max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b px-5 py-3 dark:border-gray-800">
              <span className="flex items-center gap-1.5 text-sm font-bold dark:text-gray-100"><Sparkles className="h-4 w-4 text-violet-500" /> 기획안 · {client?.name || mm?.source_brand || ''}</span>
              <div className="flex items-center gap-2">
                <button onClick={generatePlan} className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">다시 생성</button>
                <button onClick={() => setPlanModal(false)} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"><X className="h-5 w-5" /></button>
              </div>
            </div>
            <div className="grid flex-1 gap-3 overflow-hidden p-4 md:grid-cols-2">
              <div className="grid auto-rows-min gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
                {PLAN_LEFT.map((s) => <PlanBox key={s.key} label={s.label} text={sections[s.key] || ''} loading={!!secLoading[s.key]} />)}
              </div>
              <div className="overflow-y-auto">
                <PlanBox label="대본 (나레이션)" text={sections.script || ''} loading={!!secLoading.script} tall />
              </div>
            </div>
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
  return <button onClick={onClick} disabled={disabled} title={title} className={`rounded-lg p-2 transition-colors disabled:opacity-30 ${active ? 'bg-violet-600 text-white' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'}`}>{children}</button>
}

function PlanBox({ label, text, loading, tall }: { label: string; text: string; loading: boolean; tall?: boolean }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className={`flex flex-col rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/40 ${tall ? 'h-full min-h-[320px]' : 'h-[240px]'}`}>
      <div className="mb-1 flex items-center justify-between">
        <span className="flex items-center gap-1 text-xs font-bold text-gray-500 dark:text-gray-300">{label}{loading && <Loader2 className="h-3 w-3 animate-spin" />}</span>
        {text && <button onClick={() => { navigator.clipboard?.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1200) }} className="text-[11px] text-primary hover:underline">{copied ? '복사됨' : '복사'}</button>}
      </div>
      <pre className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap text-[12px] leading-relaxed text-gray-700 dark:text-gray-200" style={{ fontFamily: 'inherit' }}>{text || (loading ? '작성 중…' : '—')}</pre>
    </div>
  )
}

// 8방향 크기조절 핸들(노드 가장자리/모서리). 모서리는 비율 유지.
function Handles({ onStart }: { onStart: (e: React.MouseEvent, dir: string) => void }) {
  const edge = 'absolute z-10 bg-primary/0 hover:bg-primary/30'
  const corner = 'absolute z-20 h-3 w-3 bg-primary/0 hover:bg-primary/40'
  return (
    <>
      <div onMouseDown={(e) => onStart(e, 'n')} className={`${edge} left-2 right-2 top-0 h-1.5 cursor-ns-resize`} />
      <div onMouseDown={(e) => onStart(e, 's')} className={`${edge} bottom-0 left-2 right-2 h-1.5 cursor-ns-resize`} />
      <div onMouseDown={(e) => onStart(e, 'e')} className={`${edge} bottom-2 right-0 top-2 w-1.5 cursor-ew-resize`} />
      <div onMouseDown={(e) => onStart(e, 'w')} className={`${edge} bottom-2 left-0 top-2 w-1.5 cursor-ew-resize`} />
      <div onMouseDown={(e) => onStart(e, 'nw')} className={`${corner} left-0 top-0 cursor-nwse-resize`} />
      <div onMouseDown={(e) => onStart(e, 'ne')} className={`${corner} right-0 top-0 cursor-nesw-resize`} />
      <div onMouseDown={(e) => onStart(e, 'sw')} className={`${corner} bottom-0 left-0 cursor-nesw-resize`} />
      <div onMouseDown={(e) => onStart(e, 'se')} className={`${corner} bottom-0 right-0 cursor-nwse-resize`} />
    </>
  )
}

function NodeView({
  n, selected, editing, armed, centerAspect, onCenterAspect, centerVideoRef, onMouseDown, onDoubleClick, onCommit, onCancel, onResizeStart, onOpenSource,
}: {
  n: MMNode; selected: boolean; editing: boolean; armed: boolean; centerAspect: number; onCenterAspect: (r: number) => void; centerVideoRef: React.RefObject<HTMLVideoElement | null>
  onMouseDown: (e: React.MouseEvent) => void; onDoubleClick: () => void; onCommit: (v: string) => void; onCancel: () => void
  onResizeStart: (e: React.MouseEvent, dir: string) => void; onOpenSource: () => void
}) {
  const [val, setVal] = useState('')
  useEffect(() => { setVal(n.type === 'category' ? (n.items || []).join('\n') : n.text || '') }, [editing]) // eslint-disable-line react-hooks/exhaustive-deps

  const ring = selected ? 'ring-2 ring-primary' : ''
  const base = `absolute -translate-x-1/2 -translate-y-1/2 select-none overflow-hidden rounded-xl shadow-md ${armed ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'} ${ring}`
  const style: React.CSSProperties = { left: n.x, top: n.y, width: n.w || 200, ...(n.h ? { height: n.h } : {}) }

  if (n.type === 'center') {
    return (
      <div data-node className={`${base} border-2 border-primary bg-white p-2.5 dark:bg-gray-900`} style={{ ...style, width: n.w || 210 }} onMouseDown={onMouseDown}>
        <button onMouseDown={(e) => e.stopPropagation()} onClick={onOpenSource} title="소재를 옆 창으로 열기" className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-md bg-black/60 px-2 py-1 text-[11px] font-bold text-white hover:bg-black/80"><PanelLeftOpen className="h-3.5 w-3.5" /> 별도 탭</button>
        <div className="w-full overflow-hidden rounded-lg bg-black" style={{ aspectRatio: String(centerAspect) }}>
          {n.media_type === 'video' && n.media_url ? (
            <video ref={centerVideoRef} src={n.media_url} poster={n.poster || undefined} controls playsInline preload="metadata" className="h-full w-full bg-black object-contain" onMouseDown={(e) => e.stopPropagation()} onLoadedMetadata={(e) => { const v = e.currentTarget; if (v.videoWidth && v.videoHeight) onCenterAspect(v.videoWidth / v.videoHeight) }} />
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
    // 투명 PNG/GIF 그대로(흰 배경 X). 비율 유지(object-contain).
    return (
      <div data-node className={`${base} border-2 border-transparent bg-transparent p-0 shadow-none`} style={style} onMouseDown={onMouseDown}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={n.media_url || ''} alt="" draggable={false} className="block w-full rounded-lg" style={n.h ? { height: '100%', objectFit: 'contain' } : { height: 'auto' }} />
        <Handles onStart={onResizeStart} />
      </div>
    )
  }

  if (n.type === 'chart') {
    return (
      <div data-node className={`${base} flex flex-col border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900`} style={style} onMouseDown={onMouseDown}>
        <div className="mb-1.5 shrink-0 text-xs font-bold text-gray-700 dark:text-gray-200">📊 {n.title}</div>
        <div className="min-h-0 flex-1">
          <Chart chart={n.chart} width={(n.w || 280) - 30} height={n.h ? n.h - 48 : undefined} />
        </div>
        <Handles onStart={onResizeStart} />
      </div>
    )
  }

  if (n.type === 'narration') {
    return (
      <div data-node className={`${base} flex flex-col border-2 border-violet-300 bg-white p-2.5 dark:border-violet-800 dark:bg-gray-900`} style={style} onMouseDown={onMouseDown} onDoubleClick={onDoubleClick}>
        <div className="mb-1.5 flex shrink-0 items-center justify-between">
          <span className="flex items-center gap-1.5 text-[13px] font-bold text-gray-900 dark:text-gray-100"><span className="h-2.5 w-2.5 shrink-0 rounded-full bg-violet-500" />{n.title}</span>
          {n.text ? <button onMouseDown={(e) => e.stopPropagation()} onClick={() => navigator.clipboard?.writeText(n.text || '')} className="text-[10px] text-violet-600 hover:underline">복사</button> : null}
        </div>
        {editing ? <EditBox val={val} setVal={setVal} onCommit={() => onCommit(val)} onCancel={onCancel} />
          : n.text ? <p className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap text-[12px] leading-snug text-gray-700 dark:text-gray-200">{n.text}</p>
            : <p className="text-[12px] italic leading-snug text-gray-400">나레이션이 없는 소재입니다</p>}
        <Handles onStart={onResizeStart} />
      </div>
    )
  }

  const accent = n.color || '#6366F1'
  if (n.type === 'category') {
    return (
      <div data-node className={`${base} border-2 bg-white p-2.5 dark:bg-gray-900`} style={{ ...style, borderColor: accent }} onMouseDown={onMouseDown} onDoubleClick={onDoubleClick}>
        <div className="mb-1.5 flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: accent }} />
          <span className="text-[13px] font-bold text-gray-900 dark:text-gray-100">{n.title}</span>
        </div>
        {editing ? <EditBox val={val} setVal={setVal} onCommit={() => onCommit(val)} onCancel={onCancel} />
          : <ul className="space-y-0.5">{(n.items || []).map((it, i) => <li key={i} className="flex gap-1 text-[12px] leading-snug text-gray-600 dark:text-gray-300"><span style={{ color: accent }}>·</span><span>{it}</span></li>)}</ul>}
        <Handles onStart={onResizeStart} />
      </div>
    )
  }

  return (
    <div data-node className={`${base} border-2 bg-white p-2.5 dark:bg-gray-900`} style={{ ...style, borderColor: n.color && n.color !== '#64748B' ? n.color : '#CBD5E1' }} onMouseDown={onMouseDown} onDoubleClick={onDoubleClick}>
      {editing ? <EditBox val={val} setVal={setVal} onCommit={() => onCommit(val)} onCancel={onCancel} />
        : <p className="whitespace-pre-wrap text-[12px] leading-snug text-gray-600 dark:text-gray-300">{n.text}</p>}
      <Handles onStart={onResizeStart} />
    </div>
  )
}

function EditBox({ val, setVal, onCommit, onCancel }: { val: string; setVal: (v: string) => void; onCommit: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = ref.current
    if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; el.focus(); el.setSelectionRange(el.value.length, el.value.length) }
  }, [])
  // 테두리/배경 없이 제자리에서 편집(촌스러운 검정 박스 X) + 내용에 맞춰 자동 높이(글자 다 보임)
  return (
    <textarea
      ref={ref}
      value={val}
      onMouseDown={(e) => e.stopPropagation()}
      onChange={(e) => { setVal(e.target.value); const el = e.currentTarget; el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px' }}
      onBlur={onCommit}
      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onCommit() } if (e.key === 'Escape') onCancel() }}
      className="w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-[12px] leading-snug text-gray-700 outline-none ring-0 focus:outline-none focus:ring-0 dark:text-gray-200"
    />
  )
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
