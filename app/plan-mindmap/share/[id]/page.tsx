'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Loader2, Eye, Network } from 'lucide-react'
import type { MMDoc, MindmapData } from '@/lib/api/mindmaps'
import { MindmapCanvasView, buildViewDoc } from '@/components/mindmap-view'

type PublicMM = {
  id: string
  title: string | null
  source_brand: string | null
  source_thumb: string | null
  library_id: string | null
  data: MindmapData | MMDoc
}
type AdMedia = { media_url?: string; media_type?: string; poster_url?: string; transcript?: string }

export default function MindmapSharePage() {
  const params = useParams<{ id: string }>()
  const [mm, setMm] = useState<PublicMM | null>(null)
  const [doc, setDoc] = useState<MMDoc | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'notfound'>('loading')

  useEffect(() => {
    if (!params?.id) return
    let alive = true
    fetch(`/api/plan-mindmap/public/${params.id}`)
      .then(async (r) => { if (!r.ok) throw new Error('nf'); return r.json() })
      .then(async (d: PublicMM) => {
        if (!alive) return
        // 중앙 영상/나레이션 보강(레거시·미디어 누락 시) — 공개 광고 라우트 재사용.
        let ad: AdMedia | null = null
        if (d.library_id) {
          try { ad = await fetch(`/api/meta-ad/public/${d.library_id}`).then((r) => (r.ok ? r.json() : null)) } catch {}
        }
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
        const built = buildViewDoc(raw, d)
        if (isV2 && ad) {
          const center = built.nodes.find((n) => n.type === 'center')
          if (center && !center.media_url) { center.media_url = ad.media_url || null; center.media_type = ad.media_type || null; center.poster = center.poster || ad.poster_url || null }
        }
        if (alive) { setMm(d); setDoc(built); setState('ready') }
      })
      .catch(() => alive && setState('notfound'))
    return () => { alive = false }
  }, [params?.id])

  if (state === 'loading') {
    return <div className="flex min-h-screen items-center justify-center bg-gray-50 text-sm text-gray-400 dark:bg-gray-950"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> 불러오는 중…</div>
  }
  if (state === 'notfound' || !doc) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6 dark:bg-gray-950">
        <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="text-base font-bold text-gray-800 dark:text-gray-100">마인드맵을 찾을 수 없어요</div>
          <p className="mt-1.5 text-sm text-gray-500 dark:text-gray-400">링크가 만료되었거나 삭제됐을 수 있습니다.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col bg-gray-50 dark:bg-gray-950">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-200 bg-white/90 px-4 py-2.5 backdrop-blur dark:border-gray-800 dark:bg-gray-900/90">
        <div className="flex min-w-0 items-center gap-2">
          <Network className="h-5 w-5 shrink-0 text-violet-500" />
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-gray-900 dark:text-gray-100">{mm?.title || '기획 마인드맵'}</p>
            {mm?.source_brand && <p className="truncate text-[11px] text-gray-400">출처: {mm.source_brand}</p>}
          </div>
        </div>
        <span className="flex shrink-0 items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] font-medium text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
          <Eye className="h-3.5 w-3.5" /> 읽기 전용
        </span>
      </header>
      <div className="min-h-0 flex-1"><MindmapCanvasView doc={doc} /></div>
      <p className="shrink-0 bg-white py-1 text-center text-[10px] text-gray-300 dark:bg-gray-900 dark:text-gray-600">컨텐츠 디벨로퍼 · 기획 마인드맵 공유</p>
    </div>
  )
}
