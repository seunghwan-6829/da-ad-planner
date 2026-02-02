'use client'

import { useEffect, useState, useCallback } from 'react'
import { X, Image, Video, Sparkles, Loader2, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select } from '@/components/ui/select'
import { getAdvertisers } from '@/lib/api/advertisers'
import { Advertiser } from '@/lib/supabase'
import { cn } from '@/lib/utils'

type MediaType = 'image' | 'video'

interface PlanItem {
  title: string
  description: string
}

function parseStreamedPlans(text: string): PlanItem[] {
  const items: PlanItem[] = []
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  for (const line of lines) {
    const match = line.match(/^\d+\.\s*(.+?):\s*(.+)$/)
    if (match) {
      items.push({ title: match[1].trim(), description: match[2].trim() })
    }
  }
  return items.slice(0, 6)
}

export function PlanWriterFloat() {
  const [open, setOpen] = useState(false)
  const [mediaType, setMediaType] = useState<MediaType>('image')
  const [advertisers, setAdvertisers] = useState<Advertiser[]>([])
  const [selectedAdvertiserId, setSelectedAdvertiserId] = useState<string>('')
  const [streaming, setStreaming] = useState(false)
  const [streamedText, setStreamedText] = useState('')
  const [plans, setPlans] = useState<PlanItem[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    getAdvertisers().then(setAdvertisers).catch(() => setAdvertisers([]))
  }, [])

  const selectedAdvertiser = advertisers.find((a) => a.id === selectedAdvertiserId)
  const advertiserName = selectedAdvertiser?.name ?? ''

  const startStream = useCallback(async () => {
    setError('')
    setStreamedText('')
    setPlans([])
    setStreaming(true)
    try {
      const res = await fetch('/api/ai/plans/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mediaType,
          advertiserName: advertiserName || undefined,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? '요청 실패')
        setStreaming(false)
        return
      }
      const reader = res.body?.getReader()
      if (!reader) {
        setError('스트림을 읽을 수 없습니다.')
        setStreaming(false)
        return
      }
      const decoder = new TextDecoder()
      let full = ''
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split('\n\n')
        buffer = parts.pop() ?? ''
        for (const part of parts) {
          const dataLine = part.split('\n').find((l) => l.startsWith('data: '))
          if (!dataLine) continue
          try {
            const data = JSON.parse(dataLine.slice(6))
            if (data.text) {
              full += data.text
              setStreamedText(full)
            }
            if (data.done) {
              setPlans(parseStreamedPlans(full))
            }
            if (data.error) setError(data.error)
          } catch {
            // ignore
          }
        }
      }
      if (buffer) {
        const dataLine = buffer.split('\n').find((l) => l.startsWith('data: '))
        if (dataLine) {
          try {
            const data = JSON.parse(dataLine.slice(6))
            if (data.text) {
              full += data.text
              setStreamedText(full)
            }
            if (data.done) setPlans(parseStreamedPlans(full))
            if (data.error) setError(data.error)
          } catch {
            // ignore
          }
        }
      }
      setPlans((prev) => (prev.length > 0 ? prev : parseStreamedPlans(full)))
    } catch (err) {
      setError(err instanceof Error ? err.message : '스트리밍 오류')
    } finally {
      setStreaming(false)
    }
  }, [mediaType, advertiserName])

  const isImage = mediaType === 'image'

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-all hover:scale-105 hover:opacity-90"
        aria-label="기획서 작성"
      >
        <FileText className="h-6 w-6" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card
            className={cn(
              'flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden',
              isImage ? 'border-blue-200' : 'border-purple-200'
            )}
          >
            <CardHeader className={cn(
              'flex flex-row items-center justify-between border-b',
              isImage ? 'bg-blue-50' : 'bg-purple-50'
            )}>
              <div className="flex items-center gap-3">
                {isImage ? (
                  <Image className="h-6 w-6 text-blue-600" />
                ) : (
                  <Video className="h-6 w-6 text-purple-600" />
                )}
                <CardTitle className="text-lg">
                  {isImage ? '이미지 소재 기획서 작성' : '영상 소재 기획서 작성'}
                </CardTitle>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setOpen(false)}>
                <X className="h-5 w-5" />
              </Button>
            </CardHeader>

            <CardContent className="flex flex-1 flex-col gap-4 overflow-y-auto p-6">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm font-medium text-muted-foreground">소재 유형</span>
                <div className="flex rounded-lg border p-1">
                  <button
                    type="button"
                    onClick={() => setMediaType('image')}
                    className={cn(
                      'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium',
                      mediaType === 'image'
                        ? 'bg-blue-100 text-blue-800'
                        : 'text-muted-foreground hover:bg-gray-100'
                    )}
                  >
                    <Image className="h-4 w-4" />
                    이미지
                  </button>
                  <button
                    type="button"
                    onClick={() => setMediaType('video')}
                    className={cn(
                      'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium',
                      mediaType === 'video'
                        ? 'bg-purple-100 text-purple-800'
                        : 'text-muted-foreground hover:bg-gray-100'
                    )}
                  >
                    <Video className="h-4 w-4" />
                    영상
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground">업체 (선택)</label>
                <Select
                  value={selectedAdvertiserId}
                  onChange={(e) => setSelectedAdvertiserId(e.target.value)}
                  className="w-full max-w-xs"
                >
                  <option value="">업체 없이 작성</option>
                  {advertisers.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </Select>
              </div>

              <Button
                onClick={startStream}
                disabled={streaming}
                className={cn(
                  'w-fit',
                  isImage ? 'bg-blue-600 hover:bg-blue-700' : 'bg-purple-600 hover:bg-purple-700'
                )}
              >
                {streaming ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    6개 작성 중...
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-2 h-4 w-4" />
                    6개 한 번에 작성
                  </>
                )}
              </Button>

              {error && (
                <p className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">{error}</p>
              )}

              {streamedText && (
                <div className="space-y-2">
                  <span className="text-sm font-medium text-muted-foreground">실시간 작성</span>
                  <pre className={cn(
                    'max-h-48 overflow-y-auto rounded-lg border p-4 text-sm whitespace-pre-wrap',
                    isImage ? 'border-blue-200 bg-blue-50/50' : 'border-purple-200 bg-purple-50/50'
                  )}>
                    {streamedText}
                  </pre>
                </div>
              )}

              {plans.length > 0 && (
                <div className="space-y-2">
                  <span className="text-sm font-medium text-muted-foreground">생성된 기획 6개</span>
                  <div className="grid gap-2">
                    {plans.map((p, i) => (
                      <div
                        key={i}
                        className={cn(
                          'rounded-lg border p-3 text-left',
                          isImage ? 'border-blue-200 bg-blue-50/30' : 'border-purple-200 bg-purple-50/30'
                        )}
                      >
                        <p className="font-medium">{p.title}</p>
                        <p className="text-sm text-muted-foreground">{p.description}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </>
  )
}
