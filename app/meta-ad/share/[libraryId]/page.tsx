'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

type PublicAd = {
  library_id: string
  page_name: string | null
  started_on: string | null
  ad_text: string | null
  media_type: string | null
  media_url: string | null
  media_urls: string[] | null
  poster_url: string | null
  landing_url: string | null
  status: string | null
}

export default function PublicAdSharePage() {
  const params = useParams<{ libraryId: string }>()
  const libraryId = params?.libraryId
  const [ad, setAd] = useState<PublicAd | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'notfound'>('loading')
  const [idx, setIdx] = useState(0)

  useEffect(() => {
    if (!libraryId) return
    let alive = true
    fetch(`/api/meta-ad/public/${libraryId}`)
      .then(async (r) => {
        if (!r.ok) throw new Error('nf')
        return r.json()
      })
      .then((d) => {
        if (alive) {
          setAd(d)
          setState('ready')
        }
      })
      .catch(() => {
        if (alive) setState('notfound')
      })
    return () => {
      alive = false
    }
  }, [libraryId])

  if (state === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 text-sm text-gray-400">
        불러오는 중…
      </div>
    )
  }

  if (state === 'notfound' || !ad) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
        <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <div className="text-base font-bold text-gray-800">광고를 찾을 수 없어요</div>
          <p className="mt-1.5 text-sm text-gray-500">링크가 만료되었거나 삭제된 소재일 수 있습니다.</p>
        </div>
      </div>
    )
  }

  const brand = ad.page_name || '광고'
  const ended = ad.status === 'ended'
  const urls =
    ad.media_urls && ad.media_urls.length > 0
      ? ad.media_urls
      : ad.media_url
        ? [ad.media_url]
        : []
  const typeLabel = ad.media_type === 'video' ? '영상' : ad.media_type === 'carousel' ? '슬라이드' : '이미지'

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-md px-4 py-6 sm:py-10">
        {/* 헤더 */}
        <div className="mb-4 flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-900 text-sm font-bold text-white">
            {brand.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-bold text-gray-900">{brand}</div>
            <div className="flex items-center gap-1 text-xs">
              <span className={`h-1.5 w-1.5 rounded-full ${ended ? 'bg-gray-400' : 'bg-green-500'}`} />
              <span className={ended ? 'text-gray-400' : 'text-green-600'}>{ended ? '종료됨' : '활성'}</span>
              <span className="text-gray-300">·</span>
              <span className="text-gray-400">{typeLabel}</span>
            </div>
          </div>
        </div>

        {/* 미디어 */}
        <div className="relative mx-auto aspect-[9/16] w-full max-w-[360px] overflow-hidden rounded-2xl bg-black shadow-sm">
          {ad.media_type === 'video' && ad.media_url ? (
            <video
              src={ad.media_url}
              poster={ad.poster_url || undefined}
              controls
              playsInline
              preload="metadata"
              className="h-full w-full bg-black object-contain"
            />
          ) : urls.length > 0 ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={urls[idx]} alt="" className="h-full w-full bg-black object-contain" />
              {urls.length > 1 && (
                <>
                  <button
                    onClick={() => setIdx((i) => (i - 1 + urls.length) % urls.length)}
                    className="absolute left-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white hover:bg-black/75"
                    aria-label="이전"
                  >
                    ‹
                  </button>
                  <button
                    onClick={() => setIdx((i) => (i + 1) % urls.length)}
                    className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white hover:bg-black/75"
                    aria-label="다음"
                  >
                    ›
                  </button>
                  <span className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-bold text-white">
                    {idx + 1} / {urls.length}
                  </span>
                </>
              )}
            </>
          ) : (
            <div className="flex h-full w-full items-center justify-center text-gray-500">미디어 없음</div>
          )}
        </div>

        {/* 캡션 */}
        {ad.ad_text && (
          <div className="mt-4">
            <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-gray-400">제목 · 캡션</div>
            <p className="whitespace-pre-wrap rounded-xl bg-white p-4 text-sm leading-relaxed text-gray-700 shadow-sm">
              {ad.ad_text}
            </p>
          </div>
        )}

        {/* 메타 + 랜딩 */}
        <div className="mt-4 space-y-3 rounded-xl bg-white p-4 text-sm shadow-sm">
          <div className="flex justify-between">
            <span className="text-gray-400">시작일</span>
            <span className="font-medium text-gray-700">{ad.started_on || '—'}</span>
          </div>
          {ad.landing_url && (
            <a
              href={ad.landing_url}
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-lg bg-gray-900 px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-gray-700"
            >
              랜딩 페이지 열기 ↗
            </a>
          )}
        </div>

        <p className="mt-5 text-center text-[11px] text-gray-300">컨텐츠 디벨로퍼 · 광고 소재 공유</p>
      </div>
    </div>
  )
}
