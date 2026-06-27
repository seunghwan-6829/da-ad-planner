'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Loader2, Copy, Check, Download, Camera, Sparkles } from 'lucide-react'
import { getContentGuide, ContentGuide, CGScene } from '@/lib/api/content-guides'

export default function ContentGuideDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const [cg, setCg] = useState<ContentGuide | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'notfound'>('loading')

  useEffect(() => {
    if (!params?.id) return
    let alive = true
    getContentGuide(params.id)
      .then((d) => { if (!alive) return; if (d) { setCg(d); setState('ready') } else setState('notfound') })
      .catch(() => alive && setState('notfound'))
    return () => { alive = false }
  }, [params?.id])

  async function saveImage(url: string, idx: number) {
    try {
      const res = await fetch(url)
      const blob = await res.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `scene-${idx + 1}.jpg`
      a.click()
      URL.revokeObjectURL(a.href)
    } catch { window.open(url, '_blank') }
  }

  function sendToModelGuide(s: CGScene, idx: number) {
    try {
      const prev = JSON.parse(sessionStorage.getItem('model-guide-extra') || '[]')
      prev.push({ image: s.image, description: s.description, scene: idx + 1, at: Date.now() })
      sessionStorage.setItem('model-guide-extra', JSON.stringify(prev))
    } catch {}
    if (confirm("이 컷을 '모델 촬영 가이드 · 기타'로 보냈어요. 지금 이동할까요?")) router.push('/shooting-guide')
  }

  if (state === 'loading') return <div className="flex h-full items-center justify-center text-gray-400"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> 불러오는 중…</div>
  if (state === 'notfound' || !cg) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-gray-500">
        <p>컨텐츠 가이드를 찾을 수 없어요.</p>
        <button onClick={() => router.push('/content-guide')} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50">목록으로</button>
      </div>
    )
  }

  const scenes = cg.data?.scenes || []

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={() => router.push('/content-guide')} className="flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"><ArrowLeft className="h-3.5 w-3.5" /> 목록</button>
        <div>
          <h1 className="text-xl font-bold dark:text-gray-100">{cg.title || '컨텐츠 가이드'}</h1>
          {cg.source_brand && <p className="text-xs text-gray-400">출처: {cg.source_brand} · 씬 {scenes.length}개</p>}
        </div>
      </div>

      <div className="space-y-4">
        {scenes.map((s, i) => (
          <SceneRow key={i} idx={i} scene={s} onSave={() => saveImage(s.image, i)} onSend={() => sendToModelGuide(s, i)} />
        ))}
      </div>
    </div>
  )
}

function SceneRow({ idx, scene, onSave, onSend }: { idx: number; scene: CGScene; onSave: () => void; onSend: () => void }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="grid grid-cols-1 gap-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900 md:grid-cols-[40px_180px_1fr]">
      <div className="flex items-start justify-center">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">{idx + 1}</span>
      </div>
      <div className="space-y-2">
        <div className="aspect-[9/16] w-full overflow-hidden rounded-lg bg-black">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={scene.image} alt="" className="h-full w-full object-contain" />
        </div>
        <button onClick={onSave} className="flex w-full items-center justify-center gap-1 rounded-lg border border-gray-200 px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"><Download className="h-3.5 w-3.5" /> 이미지 저장</button>
      </div>
      <div className="space-y-3">
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="flex items-center gap-1 text-xs font-bold text-gray-400"><Sparkles className="h-3.5 w-3.5" /> 이미지 생성 프롬프트</span>
            <button onClick={() => { navigator.clipboard?.writeText(scene.prompt); setCopied(true); setTimeout(() => setCopied(false), 1500) }} className="flex items-center gap-1 text-xs text-primary hover:underline">{copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} {copied ? '복사됨' : '복사'}</button>
          </div>
          <p className="whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-sm leading-relaxed text-gray-700 dark:bg-gray-800/50 dark:text-gray-200">{scene.prompt || '—'}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <div className="mb-1 text-xs font-bold text-gray-400">이미지 설명</div>
            <p className="rounded-lg bg-gray-50 p-2.5 text-sm text-gray-700 dark:bg-gray-800/50 dark:text-gray-200">{scene.description || '—'}</p>
          </div>
          <div>
            <div className="mb-1 text-xs font-bold text-gray-400">주의할 점</div>
            <p className="rounded-lg bg-amber-50 p-2.5 text-sm text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">{scene.caution || '—'}</p>
          </div>
        </div>
        <button onClick={onSend} className="flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-sm font-medium text-primary hover:bg-primary/10"><Camera className="h-4 w-4" /> 모델 촬영 가이드로 보내기</button>
      </div>
    </div>
  )
}
