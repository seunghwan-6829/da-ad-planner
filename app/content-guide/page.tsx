'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Film, Loader2, Copy, Check, Download, Camera, Sparkles, RefreshCw, Megaphone } from 'lucide-react'
import { aiFetch } from '@/lib/ai-fetch'

type Scene = { image: string; prompt: string; description: string; caution: string }

export default function ContentGuidePage() {
  const router = useRouter()
  const [libraryId, setLibraryId] = useState<string | null>(null)
  const [brand, setBrand] = useState<string | null>(null)
  const [scenes, setScenes] = useState<Scene[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const started = useRef(false)

  useEffect(() => {
    let id: string | null = null
    try { id = sessionStorage.getItem('content-guide-seed') } catch {}
    if (id) {
      setLibraryId(id)
      if (!started.current) { started.current = true; generate(id) }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function generate(id: string) {
    setLoading(true); setError(null)
    try {
      const res = await aiFetch('/api/ai/content-guide', { method: 'POST', body: JSON.stringify({ library_id: id }) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setError(j.error || '생성에 실패했어요.'); return }
      setScenes(j.scenes || [])
      setBrand(j.brand || null)
    } catch {
      setError('생성 중 오류가 발생했어요.')
    } finally {
      setLoading(false)
    }
  }

  async function saveImage(url: string, idx: number) {
    try {
      const res = await fetch(url)
      const blob = await res.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `scene-${idx + 1}.jpg`
      a.click()
      URL.revokeObjectURL(a.href)
    } catch {
      window.open(url, '_blank')
    }
  }

  function sendToModelGuide(s: Scene, idx: number) {
    try {
      const prev = JSON.parse(sessionStorage.getItem('model-guide-extra') || '[]')
      prev.push({ image: s.image, description: s.description, scene: idx + 1, at: Date.now() })
      sessionStorage.setItem('model-guide-extra', JSON.stringify(prev))
    } catch {}
    if (confirm(`이 컷을 '모델 촬영 가이드 · 기타'로 보냈어요. 지금 이동할까요?`)) router.push('/shooting-guide')
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold dark:text-gray-100"><Film className="h-6 w-6 text-primary" /> 컨텐츠 가이드</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">소재의 장면별로 이미지를 다시 만들기 위한 프롬프트·설명·주의점을 스토리보드로 정리합니다.{brand && <> · <b>{brand}</b></>}</p>
        </div>
        {libraryId && (
          <button onClick={() => generate(libraryId)} disabled={loading} className="flex shrink-0 items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} 다시 생성
          </button>
        )}
      </div>

      {!libraryId ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-300 py-20 text-center dark:border-gray-700">
          <Megaphone className="mb-3 h-12 w-12 text-gray-300" />
          <p className="font-medium text-gray-600 dark:text-gray-300">메타 광고 크롤러에서 소재를 열고 <b>컨텐츠 가이드</b> 버튼을 눌러주세요.</p>
          <p className="mt-1 text-sm text-gray-400">선택한 영상의 장면을 분석해 스토리보드를 만들어 드려요.</p>
          <button onClick={() => router.push('/meta-ad-crawler')} className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90">메타 광고 크롤러로 이동</button>
        </div>
      ) : loading ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <Loader2 className="mb-2 h-7 w-7 animate-spin" />
          <p className="text-sm">장면을 분석해 스토리보드를 만드는 중… (수십 초)</p>
        </div>
      ) : error ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">{error}</div>
      ) : (
        <div className="space-y-4">
          {scenes.map((s, i) => (
            <SceneRow key={i} idx={i} scene={s} onSave={() => saveImage(s.image, i)} onSend={() => sendToModelGuide(s, i)} />
          ))}
        </div>
      )}
    </div>
  )
}

function SceneRow({ idx, scene, onSave, onSend }: { idx: number; scene: Scene; onSave: () => void; onSend: () => void }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="grid grid-cols-1 gap-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900 md:grid-cols-[40px_220px_1fr]">
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
        <button onClick={onSend} className="flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-sm font-medium text-primary hover:bg-primary/10">
          <Camera className="h-4 w-4" /> 모델 촬영 가이드로 보내기
        </button>
      </div>
    </div>
  )
}
