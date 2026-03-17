'use client'

import { useEffect, useRef, useState } from 'react'
import { Clapperboard, Film, Loader2, Radio, Sparkles, Upload, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

interface VideoMetadata {
  duration: number
  width: number
  height: number
  sizeBytes: number
  mimeType: string
}

interface SampledFrame {
  dataUrl: string
  timestampLabel: string
}

interface AnalysisSections {
  overview: string
  sceneBreakdown: string
  creativeOpportunities: string
  remixConcept: string
  remixScript: string
  alternateScript: string
  productionPlan: string
  riskNotes: string
}

const EMPTY_SECTIONS: AnalysisSections = {
  overview: '',
  sceneBreakdown: '',
  creativeOpportunities: '',
  remixConcept: '',
  remixScript: '',
  alternateScript: '',
  productionPlan: '',
  riskNotes: '',
}

function formatSeconds(seconds: number) {
  if (!Number.isFinite(seconds)) return '-'
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.round(seconds % 60)
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
}

function formatFileSize(sizeBytes: number) {
  if (!sizeBytes) return '-'
  return `${(sizeBytes / 1024 / 1024).toFixed(2)}MB`
}

function onceEvent<T extends Event>(target: EventTarget, eventName: string) {
  return new Promise<T>((resolve, reject) => {
    const onSuccess = (event: Event) => {
      cleanup()
      resolve(event as T)
    }

    const onError = () => {
      cleanup()
      reject(new Error(`${eventName} 이벤트를 처리하지 못했습니다.`))
    }

    const cleanup = () => {
      target.removeEventListener(eventName, onSuccess)
      target.removeEventListener('error', onError)
    }

    target.addEventListener(eventName, onSuccess, { once: true })
    target.addEventListener('error', onError, { once: true })
  })
}

async function extractFramesFromVideo(file: File) {
  const objectUrl = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.preload = 'metadata'
  video.muted = true
  video.playsInline = true
  video.src = objectUrl

  await onceEvent(video, 'loadedmetadata')

  const metadata: VideoMetadata = {
    duration: video.duration || 0,
    width: video.videoWidth || 0,
    height: video.videoHeight || 0,
    sizeBytes: file.size,
    mimeType: file.type || 'video/mp4',
  }

  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) {
    URL.revokeObjectURL(objectUrl)
    throw new Error('프레임 추출용 캔버스를 만들지 못했습니다.')
  }

  const targetWidth = Math.min(video.videoWidth || 1280, 960)
  const targetHeight = Math.max(
    1,
    Math.round(((video.videoHeight || 720) / Math.max(video.videoWidth || 1280, 1)) * targetWidth)
  )
  canvas.width = targetWidth
  canvas.height = targetHeight

  const rawTimestamps =
    metadata.duration > 1
      ? [0.12, 0.32, 0.55, 0.8].map((ratio) =>
          Math.min(metadata.duration * ratio, Math.max(metadata.duration - 0.15, 0))
        )
      : [0]

  const timestamps = Array.from(new Set(rawTimestamps.map((time) => Number(time.toFixed(2)))))
  const frames: SampledFrame[] = []

  for (const timestamp of timestamps) {
    video.currentTime = timestamp
    await onceEvent(video, 'seeked')
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    frames.push({
      dataUrl: canvas.toDataURL('image/jpeg', 0.82),
      timestampLabel: `${formatSeconds(timestamp)} 구간`,
    })
  }

  return { objectUrl, metadata, frames }
}

function SectionCard({
  title,
  description,
  content,
  emphasis = false,
}: {
  title: string
  description?: string
  content: string
  emphasis?: boolean
}) {
  return (
    <Card className={emphasis ? 'border-blue-300 shadow-sm' : 'border-slate-200'}>
      <CardHeader className="pb-3">
        <CardTitle className={emphasis ? 'text-lg text-slate-950' : 'text-base'}>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>
        <div className="whitespace-pre-wrap text-sm leading-6 text-slate-700">
          {content || '아직 결과가 없습니다.'}
        </div>
      </CardContent>
    </Card>
  )
}

export default function VideoProductionPage() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [videoMetadata, setVideoMetadata] = useState<VideoMetadata | null>(null)
  const [sampledFrames, setSampledFrames] = useState<SampledFrame[]>([])
  const [brandContext, setBrandContext] = useState('')
  const [creativeGoal, setCreativeGoal] = useState('')
  const [preparing, setPreparing] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [analysisSections, setAnalysisSections] = useState<AnalysisSections>(EMPTY_SECTIONS)
  const [rawResponse, setRawResponse] = useState('')
  const [modelName, setModelName] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    return () => {
      if (videoUrl) {
        URL.revokeObjectURL(videoUrl)
      }
    }
  }, [videoUrl])

  async function handleVideoUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    setPreparing(true)
    setError('')
    setVideoFile(file)
    setAnalysisSections(EMPTY_SECTIONS)
    setRawResponse('')
    setModelName('')

    try {
      if (videoUrl) {
        URL.revokeObjectURL(videoUrl)
      }

      const prepared = await extractFramesFromVideo(file)
      setVideoUrl(prepared.objectUrl)
      setVideoMetadata(prepared.metadata)
      setSampledFrames(prepared.frames)
    } catch (uploadError) {
      console.error(uploadError)
      setError(uploadError instanceof Error ? uploadError.message : '영상 준비에 실패했습니다.')
      setVideoFile(null)
      setVideoUrl(null)
      setVideoMetadata(null)
      setSampledFrames([])
    } finally {
      setPreparing(false)
      event.target.value = ''
    }
  }

  async function handleAnalyze() {
    if (!videoFile || sampledFrames.length === 0 || !videoMetadata) {
      setError('영상을 먼저 업로드해 주세요.')
      return
    }

    setAnalyzing(true)
    setError('')
    setAnalysisSections(EMPTY_SECTIONS)
    setRawResponse('')

    try {
      const response = await fetch('/api/ai/video-remix', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          videoName: videoFile.name,
          mimeType: videoMetadata.mimeType,
          duration: videoMetadata.duration,
          width: videoMetadata.width,
          height: videoMetadata.height,
          sizeBytes: videoMetadata.sizeBytes,
          brandContext,
          creativeGoal,
          frames: sampledFrames,
        }),
      })

      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || '영상 분석 요청에 실패했습니다.')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue

          const payload = JSON.parse(line.slice(6)) as {
            text?: string
            raw?: string
            done?: boolean
            error?: string
            model?: string
            sections?: AnalysisSections
          }

          if (payload.error) {
            throw new Error(payload.error)
          }

          if (payload.raw) {
            setRawResponse(payload.raw)
          }

          if (payload.done) {
            setModelName(payload.model || '')
            setAnalysisSections(payload.sections || EMPTY_SECTIONS)
          }
        }
      }
    } catch (analysisError) {
      console.error(analysisError)
      setError(analysisError instanceof Error ? analysisError.message : '영상 분석에 실패했습니다.')
    } finally {
      setAnalyzing(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-slate-200 bg-gradient-to-r from-slate-900 via-slate-800 to-blue-900 p-8 text-white shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-sm">
              <Film className="h-4 w-4" />
              영상 분석 및 제작
            </div>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">분석에서 끝나지 않고, 리믹스 대본까지 바로 뽑아줍니다</h1>
              <p className="mt-2 max-w-3xl text-sm text-slate-200">
                업로드한 영상에서 대표 프레임을 자동 샘플링한 뒤, Opus 계열 모델이 분석을 실시간으로 작성하고
                최종적으로 리믹스 대본 2안과 제작 가이드까지 정리합니다.
              </p>
            </div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-100">
            {modelName ? `분석 모델: ${modelName}` : '분석 모델은 실행 후 표시됩니다.'}
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.05fr,1.2fr]">
        <div className="space-y-6">
          <Card className="border-slate-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <Upload className="h-5 w-5 text-primary" />
                영상 업로드
              </CardTitle>
              <CardDescription>MP4, MOV, WebM 파일을 올리면 대표 프레임을 뽑아서 분석 준비를 합니다.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button onClick={() => fileInputRef.current?.click()} className="w-full" disabled={preparing}>
                {preparing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                {preparing ? '영상 준비 중...' : '영상 파일 선택'}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="video/mp4,video/quicktime,video/webm,video/*"
                className="hidden"
                onChange={handleVideoUpload}
              />

              {videoUrl ? (
                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-950">
                  <video src={videoUrl} controls className="aspect-video w-full" />
                </div>
              ) : (
                <div className="flex aspect-video items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-500">
                  업로드한 영상 미리보기가 여기에 표시됩니다.
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">파일</p>
                  <p className="mt-2 text-sm font-medium text-slate-900">{videoFile?.name || '-'}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">길이 / 용량</p>
                  <p className="mt-2 text-sm font-medium text-slate-900">
                    {videoMetadata ? `${formatSeconds(videoMetadata.duration)} / ${formatFileSize(videoMetadata.sizeBytes)}` : '-'}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">해상도</p>
                  <p className="mt-2 text-sm font-medium text-slate-900">
                    {videoMetadata ? `${videoMetadata.width} x ${videoMetadata.height}` : '-'}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">샘플 프레임</p>
                  <p className="mt-2 text-sm font-medium text-slate-900">
                    {sampledFrames.length ? `${sampledFrames.length}장 추출 완료` : '-'}
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="brand-context">브랜드 / 제품 정보</Label>
                <Textarea
                  id="brand-context"
                  value={brandContext}
                  onChange={(event) => setBrandContext(event.target.value)}
                  placeholder="예: 투자 초보자를 위한 미국 주식 앱, 핵심 USP는 쉬운 매매와 자동 리포트"
                  className="min-h-24"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="creative-goal">제작 목표</Label>
                <Input
                  id="creative-goal"
                  value={creativeGoal}
                  onChange={(event) => setCreativeGoal(event.target.value)}
                  placeholder="예: 첫 3초 후킹 강화, 숏폼 리믹스 대본 2안 제작"
                />
              </div>

              <Button onClick={handleAnalyze} className="w-full" disabled={preparing || analyzing || sampledFrames.length === 0}>
                {analyzing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    분석과 리믹스 대본 작성 중...
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-2 h-4 w-4" />
                    실시간 분석 + 리믹스 대본 생성
                  </>
                )}
              </Button>

              {error ? <p className="text-sm text-red-600">{error}</p> : null}
            </CardContent>
          </Card>

          <Card className="border-slate-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <Clapperboard className="h-5 w-5 text-primary" />
                대표 프레임
              </CardTitle>
              <CardDescription>업로드한 영상에서 자동으로 뽑은 핵심 장면입니다.</CardDescription>
            </CardHeader>
            <CardContent>
              {sampledFrames.length > 0 ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  {sampledFrames.map((frame) => (
                    <div key={frame.timestampLabel} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                      <img src={frame.dataUrl} alt={frame.timestampLabel} className="aspect-video w-full object-cover" />
                      <div className="border-t border-slate-200 px-3 py-2 text-sm text-slate-600">{frame.timestampLabel}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
                  영상을 업로드하면 프레임 썸네일이 여기에 채워집니다.
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="border-blue-200 bg-blue-50/40">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <Radio className={`h-5 w-5 ${analyzing ? 'animate-pulse text-blue-600' : 'text-blue-600'}`} />
                실시간 응답
              </CardTitle>
              <CardDescription>분석과 리믹스 초안이 생성되는 동안 응답이 실시간으로 누적됩니다.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="min-h-56 whitespace-pre-wrap rounded-2xl bg-slate-950 p-4 text-sm leading-6 text-slate-100">
                {rawResponse || (analyzing ? '모델이 응답을 작성하는 중입니다...' : '분석을 시작하면 실시간 응답이 여기에 표시됩니다.')}
              </div>
            </CardContent>
          </Card>

          <SectionCard
            title="리믹스 대본 1안"
            description="실제로 편집 가능한 메인 리믹스 대본입니다."
            content={analysisSections.remixScript}
            emphasis
          />
          <SectionCard
            title="리믹스 대본 2안"
            description="후킹 각도를 달리한 보조 대본입니다."
            content={analysisSections.alternateScript}
            emphasis
          />
          <SectionCard
            title="전체 진단"
            description="타깃 추정, 메시지 밀도, 현재 영상의 포지션을 빠르게 요약합니다."
            content={analysisSections.overview}
          />
          <SectionCard title="장면 흐름 분석" content={analysisSections.sceneBreakdown} />
          <SectionCard title="리믹스 기회" content={analysisSections.creativeOpportunities} />
          <SectionCard
            title="추천 리믹스 콘셉트"
            description="광고 성과를 높이기 위한 방향을 3개 안으로 제안합니다."
            content={analysisSections.remixConcept}
          />
          <SectionCard title="편집 및 제작 가이드" content={analysisSections.productionPlan} />
          <SectionCard title="리스크 및 추가 요청 자료" content={analysisSections.riskNotes} />

          {rawResponse ? (
            <Card className="border-slate-200">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-xl">
                  <Wand2 className="h-5 w-5 text-primary" />
                  원문 응답
                </CardTitle>
                <CardDescription>태그 기반 파싱 전 원본 응답입니다.</CardDescription>
              </CardHeader>
              <CardContent>
                <pre className="whitespace-pre-wrap rounded-2xl bg-slate-950 p-4 text-xs leading-6 text-slate-100">
                  {rawResponse}
                </pre>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  )
}
