'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Loader2, Copy, Check, Sparkles } from 'lucide-react'
import { toStacks, CGGenItem } from '@/lib/api/content-guides'

type Scene = { image: string; prompt: string; description: string; caution: string; generated?: CGGenItem[] }
type Guide = { title: string | null; source_brand: string | null; data: { scenes: Scene[] } }

export default function ContentGuideSharePage() {
  const params = useParams<{ id: string }>()
  const [g, setG] = useState<Guide | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'notfound'>('loading')

  useEffect(() => {
    if (!params?.id) return
    let alive = true
    fetch(`/api/content-guide/public/${params.id}`)
      .then(async (r) => { if (!r.ok) throw new Error('nf'); return r.json() })
      .then((d) => { if (alive) { setG(d); setState('ready') } })
      .catch(() => alive && setState('notfound'))
    return () => { alive = false }
  }, [params?.id])

  if (state === 'loading') return <div className="flex min-h-screen items-center justify-center bg-gray-50 text-sm text-gray-400"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> 불러오는 중…</div>
  if (state === 'notfound' || !g) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
        <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <div className="text-base font-bold text-gray-800">컨텐츠 가이드를 찾을 수 없어요</div>
          <p className="mt-1.5 text-sm text-gray-500">링크가 만료되었거나 삭제됐을 수 있습니다.</p>
        </div>
      </div>
    )
  }

  const scenes = g.data?.scenes || []

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-3xl px-4 py-6 sm:py-10">
        <div className="mb-5">
          <h1 className="text-xl font-bold text-gray-900">{g.title || '컨텐츠 가이드'}</h1>
          <p className="text-xs text-gray-400">{g.source_brand ? `출처: ${g.source_brand} · ` : ''}씬 {scenes.length}개</p>
        </div>
        <div className="space-y-4">
          {scenes.map((s, i) => (
            <ShareScene key={i} idx={i} scene={s} />
          ))}
        </div>
        <p className="mt-6 text-center text-[11px] text-gray-300">컨텐츠 디벨로퍼 · 컨텐츠 가이드 공유</p>
      </div>
    </div>
  )
}

function ShareScene({ idx, scene }: { idx: number; scene: Scene }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="grid grid-cols-1 gap-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm md:grid-cols-[36px_120px_1fr]">
      <div className="flex items-start justify-center"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-900 text-sm font-bold text-white">{idx + 1}</span></div>
      <div className="aspect-[9/16] w-full overflow-hidden rounded-lg bg-black">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={scene.image} alt="" className="h-full w-full object-contain" />
      </div>
      <div className="space-y-2.5">
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="flex items-center gap-1 text-[11px] font-bold text-gray-400"><Sparkles className="h-3 w-3" /> 이미지 생성 프롬프트</span>
            <button onClick={() => { navigator.clipboard?.writeText(scene.prompt); setCopied(true); setTimeout(() => setCopied(false), 1500) }} className="flex items-center gap-1 text-[11px] text-blue-600 hover:underline">{copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} {copied ? '복사됨' : '복사'}</button>
          </div>
          <p className="whitespace-pre-wrap rounded-lg bg-gray-50 p-2.5 text-[12px] leading-relaxed text-gray-700">{scene.prompt || '—'}</p>
        </div>
        <div className="text-[12px]"><span className="font-bold text-gray-400">설명 </span><span className="text-gray-700">{scene.description || '—'}</span></div>
        <div className="rounded-lg bg-amber-50 p-2 text-[12px] text-amber-700"><b>주의</b> {scene.caution || '—'}</div>
        {toStacks(scene.generated).length > 0 && (
          <div>
            <div className="mb-1 text-[11px] font-bold text-gray-400">생성 이미지</div>
            <div className="grid grid-cols-3 gap-2">
              {toStacks(scene.generated).map((st, k) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={k} src={st[st.length - 1]} alt="" className="aspect-[9/16] w-full rounded-lg border border-gray-200 object-cover" />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
