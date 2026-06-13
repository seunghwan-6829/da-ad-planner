'use client'

import { useEffect, useState } from 'react'
import { Loader2, Camera, Ratio, Lightbulb, Clapperboard } from 'lucide-react'
import { getPublicGuideByShareId, ShootingGuide } from '@/lib/api/shooting-guides'

export default function PublicGuidePage({ params }: { params: Promise<{ shareId: string }> }) {
  const [guide, setGuide] = useState<ShootingGuide | null>(null)
  const [loading, setLoading] = useState(true)
  const [zoom, setZoom] = useState<string | null>(null)

  useEffect(() => {
    params.then(async ({ shareId }) => {
      const data = await getPublicGuideByShareId(shareId)
      setGuide(data)
      setLoading(false)
    })
  }, [params])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f4f5f7]">
        <Loader2 className="h-8 w-8 animate-spin text-[#ff5a7a]" />
      </div>
    )
  }

  if (!guide) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f4f5f7] p-6">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-sm">
          <Camera className="mx-auto mb-4 h-10 w-10 text-gray-300" />
          <div className="text-lg font-semibold text-gray-900">촬영 가이드를 찾지 못했습니다.</div>
          <p className="mt-2 text-sm text-gray-500">링크가 만료되었거나 비공개 처리되었을 수 있습니다.</p>
        </div>
      </div>
    )
  }

  const shots = guide.shots || []

  return (
    <div className="min-h-screen bg-[#f4f5f7] text-[#1a1d23]">
      <div className="mx-auto max-w-[1060px] px-4 pb-16 pt-5 sm:px-5 sm:pt-7">
        {/* HERO */}
        <header className="rounded-[18px] bg-gradient-to-br from-[#ff7a90] via-[#ff5a7a] to-[#ff4d6d] p-6 text-white shadow-[0_10px_26px_rgba(255,77,109,0.26)] sm:p-7">
          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.12em] opacity-90">
            Model Shooting Guide
          </p>
          <h1 className="text-[22px] font-extrabold tracking-tight sm:text-[25px]">{guide.title}</h1>
        </header>

        {/* PREP */}
        <section className="mt-3.5 flex flex-wrap gap-3 rounded-2xl border border-[#e6e8ec] bg-white p-4 shadow-sm">
          <div className="flex items-start gap-2.5">
            <div className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px] bg-[#fff0f3] text-[#c41f44]">
              <Ratio className="h-4 w-4" />
            </div>
            <div>
              <div className="mb-0.5 text-[11px] font-bold uppercase tracking-wide text-gray-500">화면 비율</div>
              <div className="text-sm font-bold">{guide.ratio || '9:16'} 세로</div>
            </div>
          </div>
          {guide.tips && (
            <div className="flex flex-1 items-start gap-2.5">
              <div className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px] bg-[#fff0f3] text-[#c41f44]">
                <Lightbulb className="h-4 w-4" />
              </div>
              <div>
                <div className="mb-0.5 text-[11px] font-bold uppercase tracking-wide text-gray-500">촬영 팁</div>
                <div className="text-sm font-medium leading-snug text-[#2c2f36]">{guide.tips}</div>
              </div>
            </div>
          )}
        </section>

        {/* SECTION HEAD */}
        <div className="mx-1 mb-3.5 mt-6 flex items-baseline justify-between">
          <h2 className="text-[17px] font-extrabold tracking-tight">샷 리스트</h2>
          <span className="text-[13px] font-semibold text-gray-500">촬영 순서대로 · {shots.length}컷</span>
        </div>

        {/* SHOTS */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
          {shots.map((shot, i) => (
            <article
              key={shot.id}
              className="flex flex-row items-start gap-3 rounded-2xl border border-[#e6e8ec] bg-white p-2.5 shadow-sm sm:flex-col sm:p-3"
            >
              <div className="relative w-28 flex-none overflow-hidden rounded-xl bg-[#eceef1] sm:w-full">
                {shot.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={shot.image_url}
                    alt={shot.name || `컷 ${i + 1}`}
                    onClick={() => setZoom(shot.image_url)}
                    className="block w-full h-auto cursor-zoom-in"
                  />
                ) : (
                  <div className="flex aspect-[2/3] w-full items-center justify-center">
                    <Camera className="h-6 w-6 text-gray-300" />
                  </div>
                )}
                <span className="absolute left-1.5 top-1.5 rounded-full bg-black/80 px-2 py-[3px] text-[11px] font-extrabold tracking-wide text-white">
                  #{String(i + 1).padStart(2, '0')}
                </span>
                <span className="absolute bottom-1.5 right-1.5 rounded-md bg-white/90 px-1.5 py-[2px] text-[10px] font-extrabold text-[#1a1d23]">
                  {guide.ratio || '9:16'}
                </span>
              </div>

              <div className="flex min-w-0 flex-1 flex-col">
                {shot.name && <h3 className="mb-1.5 text-[15px] font-extrabold">{shot.name}</h3>}
                {shot.description && (
                  <p className="mb-2.5 text-sm font-semibold text-[#23262c]">{shot.description}</p>
                )}

                <div className="mb-2 flex flex-wrap gap-1.5">
                  {shot.framing && <Badge k="구도" v={shot.framing} />}
                  {shot.angle && <Badge k="앵글" v={shot.angle} />}
                  {shot.duration && <Badge k="길이" v={shot.duration} />}
                </div>

                {shot.direction && (
                  <p className="mt-auto flex items-start gap-1.5 border-t border-dashed border-[#e6e8ec] pt-2 text-[12.5px] text-gray-600">
                    <Clapperboard className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{shot.direction}</span>
                  </p>
                )}
              </div>
            </article>
          ))}
        </div>

        <p className="mt-6 text-center text-xs text-gray-400">레퍼런스 이미지는 AI 생성 예시 · 컨텐츠 디벨로퍼</p>
      </div>

      {/* 이미지 확대 라이트박스 */}
      {zoom && (
        <div
          className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-black/85 p-4"
          onClick={() => setZoom(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoom} alt="확대 이미지" className="max-h-[92vh] max-w-[92vw] rounded-lg object-contain" />
        </div>
      )}
    </div>
  )
}

function Badge({ k, v }: { k: string; v: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-lg bg-[#f3f4f6] px-2 py-1 text-[11.5px] font-semibold text-gray-700">
      <b className="font-extrabold text-gray-900">{k}</b>
      {v}
    </span>
  )
}
