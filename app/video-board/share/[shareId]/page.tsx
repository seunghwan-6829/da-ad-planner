'use client'

import { useEffect, useState } from 'react'
import { Download, Loader2, PlaySquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { getPublicVideoBoardItemByShareId } from '@/lib/api/video-board'
import { VideoBoardItem } from '@/lib/supabase'

function formatDuration(seconds: number | null) {
  if (!seconds) return '-'
  const mins = Math.floor(seconds / 60)
  const secs = Math.round(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function triggerDownload(url: string, fileName: string) {
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
}

export default function SharedVideoBoardPage({ params }: { params: Promise<{ shareId: string }> }) {
  const [item, setItem] = useState<VideoBoardItem | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    params.then(async ({ shareId }) => {
      const data = await getPublicVideoBoardItemByShareId(shareId)
      setItem(data)
      setLoading(false)
    })
  }, [params])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!item) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <Card className="w-full max-w-lg">
          <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
            <PlaySquare className="h-10 w-10 text-slate-300" />
            <div>
              <div className="text-lg font-semibold text-slate-900">공유된 영상을 찾지 못했습니다.</div>
              <p className="mt-2 text-sm text-slate-500">링크가 만료되었거나 비공개 처리되었을 수 있습니다.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-5xl space-y-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-slate-400">Shared Video</p>
            <h1 className="mt-2 text-3xl font-semibold text-slate-900">{item.title || '공유 영상'}</h1>
            <p className="mt-2 text-sm text-slate-500">
              길이 {formatDuration(item.duration)} / {item.width || '-'}x{item.height || '-'}
            </p>
          </div>
          <Button onClick={() => triggerDownload(item.video_url, `${item.share_id}.mp4`)}>
            <Download className="mr-2 h-4 w-4" />
            영상 다운로드
          </Button>
        </div>

        <div className="grid gap-8 lg:grid-cols-[380px,1fr]">
          <Card className="overflow-hidden">
            <CardContent className="space-y-4 p-4">
              <div className="overflow-hidden rounded-3xl border bg-black">
                <video src={item.video_url} poster={item.poster_url || undefined} controls className="aspect-[9/16] w-full object-cover" />
              </div>
              <div className="flex flex-wrap gap-2 text-sm">
                {item.category?.name ? <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">{item.category.name}</span> : null}
                {item.group?.name ? <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">{item.group.name}</span> : null}
              </div>
            </CardContent>
          </Card>

          <div className="space-y-4">
            {item.summary ? (
              <Card>
                <CardContent className="space-y-2 p-5">
                  <div className="text-sm font-semibold text-slate-900">요약</div>
                  <div className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{item.summary}</div>
                </CardContent>
              </Card>
            ) : null}

            {item.timeline_notes ? (
              <Card>
                <CardContent className="space-y-2 p-5">
                  <div className="text-sm font-semibold text-slate-900">타임코드 메모</div>
                  <div className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{item.timeline_notes}</div>
                </CardContent>
              </Card>
            ) : null}

            {item.script_notes ? (
              <Card>
                <CardContent className="space-y-2 p-5">
                  <div className="text-sm font-semibold text-slate-900">대본 / 화면 구성</div>
                  <div className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{item.script_notes}</div>
                </CardContent>
              </Card>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
