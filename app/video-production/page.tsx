'use client'

import { useEffect, useRef, useState } from 'react'
import { Clapperboard, Download, Film, Loader2, Radio, Sparkles, Upload } from 'lucide-react'
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
  fileName: string
}

interface StreamState {
  raw: string
  loading: boolean
}

const EMPTY_STREAM: StreamState = {
  raw: '',
  loading: false,
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

function sanitizeFileName(name: string) {
  return name.replace(/[<>:"/\\|?*]+/g, '-')
}

function triggerDownload(dataUrl: string, fileName: string) {
  const link = document.createElement('a')
  link.href = dataUrl
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
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

  const timestamps: number[] = []
  if (metadata.duration <= 0) {
    timestamps.push(0)
  } else {
    for (let time = 0; time < metadata.duration; time += 3) {
      timestamps.push(Number(Math.min(time, Math.max(metadata.duration - 0.1, 0)).toFixed(2)))
    }
    const lastFrameTime = Number(Math.max(metadata.duration - 0.1, 0).toFixed(2))
    if (!timestamps.includes(lastFrameTime)) {
      timestamps.push(lastFrameTime)
    }
  }

  const baseName = sanitizeFileName(file.name.replace(/\.[^.]+$/, ''))
  const frames: SampledFrame[] = []

  for (const timestamp of timestamps) {
    video.currentTime = timestamp
    await onceEvent(video, 'seeked')
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    const secondsLabel = Math.floor(timestamp)
    frames.push({
      dataUrl: canvas.toDataURL('image/jpeg', 0.84),
      timestampLabel: `${formatSeconds(timestamp)} 구간`,
      fileName: `${baseName}-frame-${secondsLabel.toString().padStart(3, '0')}s.jpg`,
    })
  }

  return { objectUrl, metadata, frames }
}

function StreamCard({
  title,
  description,
  state,
}: {
  title: string
  description: string
  state: StreamState
}) {
  return (
    <Card className="border-slate-200">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <Radio className={`h-5 w-5 ${state.loading ? 'animate-pulse text-blue-600' : 'text-slate-500'}`} />
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="min-h-56 whitespace-pre-wrap rounded-2xl border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-900">
          {state.raw || (state.loading ? '실시간으로 응답을 작성하는 중입니다...' : '생성을 시작하면 여기에 표시됩니다.')}
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
  const [brandName, setBrandName] = useState('')
  const [productInfo, setProductInfo] = useState('')
  const [productAppeal, setProductAppeal] = useState('')
  const [creativeGoal, setCreativeGoal] = useState('')
  const [preparing, setPreparing] = useState(false)
  const [modelName, setModelName] = useState('')
  const [error, setError] = useState('')
  const [analysis, setAnalysis] = useState<StreamState>(EMPTY_STREAM)
  const [script1, setScript1] = useState<StreamState>(EMPTY_STREAM)
  const [script2, setScript2] = useState<StreamState>(EMPTY_STREAM)

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
    setAnalysis(EMPTY_STREAM)
    setScript1(EMPTY_STREAM)
    setScript2(EMPTY_STREAM)
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

  async function streamIntoState(
    endpoint: string,
    setter: React.Dispatch<React.SetStateAction<StreamState>>,
    payload: Record<string, unknown>
  ) {
    setter({ raw: '', loading: true })

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok || !response.body) {
      const data = await response.json().catch(() => ({}))
      throw new Error(data.error || 'AI 응답 생성에 실패했습니다.')
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
          raw?: string
          done?: boolean
          error?: string
          model?: string
        }

        if (payload.error) {
          throw new Error(payload.error)
        }

        if (payload.model) {
          setModelName(payload.model)
        }

        if (typeof payload.raw === 'string') {
          setter((prev) => ({ ...prev, raw: payload.raw }))
        }

        if (payload.done) {
          setter((prev) => ({ ...prev, loading: false }))
        }
      }
    }
  }

  async function handleGenerate() {
    if (!videoFile || sampledFrames.length === 0 || !videoMetadata) {
      setError('영상을 먼저 업로드해 주세요.')
      return
    }

    setError('')
    setAnalysis(EMPTY_STREAM)
    setScript1(EMPTY_STREAM)
    setScript2(EMPTY_STREAM)

    const payload = {
      videoName: videoFile.name,
      mimeType: videoMetadata.mimeType,
      duration: videoMetadata.duration,
      width: videoMetadata.width,
      height: videoMetadata.height,
      sizeBytes: videoMetadata.sizeBytes,
      brandName,
      productInfo,
      productAppeal,
      creativeGoal,
      frames: sampledFrames,
    }

    try {
      await Promise.all([
        streamIntoState('/api/ai/video-analysis', setAnalysis, payload),
        streamIntoState('/api/ai/video-remix-script-1', setScript1, payload),
        streamIntoState('/api/ai/video-remix-script-2', setScript2, payload),
      ])
    } catch (generationError) {
      console.error(generationError)
      setError(generationError instanceof Error ? generationError.message : '영상 생성에 실패했습니다.')
      setAnalysis((prev) => ({ ...prev, loading: false }))
      setScript1((prev) => ({ ...prev, loading: false }))
      setScript2((prev) => ({ ...prev, loading: false }))
    }
  }

  function handleDownloadAllFrames() {
    sampledFrames.forEach((frame, index) => {
      window.setTimeout(() => {
        triggerDownload(frame.dataUrl, frame.fileName)
      }, index * 180)
    })
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
              <h1 className="text-3xl font-semibold tracking-tight">분석과 리믹스 대본을 각각 실시간으로 나눠서 생성합니다</h1>
              <p className="mt-2 max-w-3xl text-sm text-slate-200">
                프레임은 3초마다 추출하고, 분석 API와 대본 1안 API, 대본 2안 API를 분리해서 토큰이 잘리지 않게 구성했습니다.
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
              <CardDescription>대표 프레임은 3초마다 자동 추출됩니다.</CardDescription>
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
                  <p className="mt-2 text-sm font-medium text-slate-900">{sampledFrames.length ? `${sampledFrames.length}장 추출 완료` : '-'}</p>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="brand-name">브랜드명</Label>
                <Input
                  id="brand-name"
                  value={brandName}
                  onChange={(event) => setBrandName(event.target.value)}
                  placeholder="예: 라이브인베스트"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="product-info">제품 정보</Label>
                <Textarea
                  id="product-info"
                  value={productInfo}
                  onChange={(event) => setProductInfo(event.target.value)}
                  placeholder="예: 투자 초보자를 위한 미국 주식 앱, 자동 리포트와 쉬운 매수/매도 UX 제공"
                  className="min-h-24"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="product-appeal">제품 소구점</Label>
                <Textarea
                  id="product-appeal"
                  value={productAppeal}
                  onChange={(event) => setProductAppeal(event.target.value)}
                  placeholder="예: 초보자도 쉽게 시작, 실시간 요약 리포트, 낮은 진입장벽, 간편한 사용성"
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

              <Button
                onClick={handleGenerate}
                className="w-full"
                disabled={preparing || analysis.loading || script1.loading || script2.loading || sampledFrames.length === 0}
              >
                {analysis.loading || script1.loading || script2.loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    분석 + 대본 생성 중...
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-2 h-4 w-4" />
                    분석 / 대본1 / 대본2 실시간 생성
                  </>
                )}
              </Button>

              {error ? <p className="text-sm text-red-600">{error}</p> : null}
            </CardContent>
          </Card>

          <Card className="border-slate-200">
            <CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-xl">
                    <Clapperboard className="h-5 w-5 text-primary" />
                    대표 프레임
                  </CardTitle>
                  <CardDescription>썸네일을 클릭하면 개별 다운로드되고, 버튼으로 전체 다운로드도 가능합니다.</CardDescription>
                </div>
                <Button variant="outline" onClick={handleDownloadAllFrames} disabled={sampledFrames.length === 0}>
                  <Download className="mr-2 h-4 w-4" />
                  전체 다운로드
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {sampledFrames.length > 0 ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  {sampledFrames.map((frame) => (
                    <button
                      key={frame.fileName}
                      type="button"
                      onClick={() => triggerDownload(frame.dataUrl, frame.fileName)}
                      className="overflow-hidden rounded-2xl border border-slate-200 bg-white text-left transition hover:border-primary hover:shadow-sm"
                    >
                      <img src={frame.dataUrl} alt={frame.timestampLabel} className="aspect-video w-full object-cover" />
                      <div className="border-t border-slate-200 px-3 py-2 text-sm text-slate-600">
                        <div>{frame.timestampLabel}</div>
                        <div className="text-xs text-slate-400">{frame.fileName}</div>
                      </div>
                    </button>
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
          <StreamCard
            title="실시간 분석"
            description="원본 영상의 구조, 타깃, 문제점, 리믹스 포인트를 실시간으로 분석합니다."
            state={analysis}
          />
          <StreamCard
            title="리믹스 대본 1안"
            description="메인 콘셉트 기준의 대본 1안을 실시간으로 작성합니다."
            state={script1}
          />
          <StreamCard
            title="리믹스 대본 2안"
            description="다른 후킹 구조의 대본 2안을 실시간으로 작성합니다."
            state={script2}
          />
        </div>
      </div>
    </div>
  )
}
