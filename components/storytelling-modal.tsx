'use client'

import { useState } from 'react'
import { X, Copy, Check, Loader2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { aiFetch } from '@/lib/ai-fetch'

const FRAMEWORKS = [
  {
    id: 'harmon-circle',
    name: '하몬서클',
    description: '일상 → 욕구 → 출발 → 발견 → 변화의 8단계 순환 구조',
    color: 'from-blue-500 to-blue-600',
    bg: 'bg-blue-50 dark:bg-blue-950/30',
    border: 'border-blue-200 dark:border-blue-800',
  },
  {
    id: 'story-spine',
    name: '스토리스파인',
    description: '"옛날 옛적에~"로 시작하는 자연스러운 이야기 전개',
    color: 'from-emerald-500 to-emerald-600',
    bg: 'bg-emerald-50 dark:bg-emerald-950/30',
    border: 'border-emerald-200 dark:border-emerald-800',
  },
  {
    id: '3-act',
    name: '3막 전개',
    description: '설정 → 갈등 → 해결의 클래식한 3막 구조',
    color: 'from-amber-500 to-amber-600',
    bg: 'bg-amber-50 dark:bg-amber-950/30',
    border: 'border-amber-200 dark:border-amber-800',
  },
  {
    id: 'in-medias-res',
    name: '인 미디어스 레스',
    description: '사건 중간부터 시작해서 몰입을 끌어내는 구조',
    color: 'from-red-500 to-red-600',
    bg: 'bg-red-50 dark:bg-red-950/30',
    border: 'border-red-200 dark:border-red-800',
  },
  {
    id: 'save-the-cat',
    name: '세이브 더 캣',
    description: '공감 → 위기 → 극복의 감정 중심 전개',
    color: 'from-violet-500 to-violet-600',
    bg: 'bg-violet-50 dark:bg-violet-950/30',
    border: 'border-violet-200 dark:border-violet-800',
  },
  {
    id: 'frame-narrative',
    name: '프레임 내러티브',
    description: '이야기 속 이야기, 액자식 구성',
    color: 'from-pink-500 to-pink-600',
    bg: 'bg-pink-50 dark:bg-pink-950/30',
    border: 'border-pink-200 dark:border-pink-800',
  },
  {
    id: 'heros-journey',
    name: '영웅의 여정',
    description: '주인공이 모험을 떠나 성장하고 돌아오는 여정',
    color: 'from-orange-500 to-orange-600',
    bg: 'bg-orange-50 dark:bg-orange-950/30',
    border: 'border-orange-200 dark:border-orange-800',
  },
]

interface StorytellingModalProps {
  isOpen: boolean
  onClose: () => void
}

export function StorytellingModal({ isOpen, onClose }: StorytellingModalProps) {
  const [script, setScript] = useState('')
  const [results, setResults] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState<Record<string, boolean>>({})
  const [copied, setCopied] = useState<Record<string, boolean>>({})

  if (!isOpen) return null

  const handleGenerate = async (frameworkId: string) => {
    if (!script.trim()) {
      alert('대본을 먼저 입력해주세요.')
      return
    }

    setLoading((prev) => ({ ...prev, [frameworkId]: true }))
    try {
      const res = await aiFetch('/api/ai/storytelling-variation', {
        method: 'POST',
        body: JSON.stringify({ script: script.trim(), framework: frameworkId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '생성 실패')
      setResults((prev) => ({ ...prev, [frameworkId]: data.result }))
    } catch (error: any) {
      alert(`생성 실패: ${error?.message || '알 수 없는 오류'}`)
    } finally {
      setLoading((prev) => ({ ...prev, [frameworkId]: false }))
    }
  }

  const handleGenerateAll = async () => {
    if (!script.trim()) {
      alert('대본을 먼저 입력해주세요.')
      return
    }
    FRAMEWORKS.forEach((fw) => handleGenerate(fw.id))
  }

  const handleCopy = async (frameworkId: string) => {
    const text = results[frameworkId]
    if (!text) return
    await navigator.clipboard.writeText(text)
    setCopied((prev) => ({ ...prev, [frameworkId]: true }))
    setTimeout(
      () => setCopied((prev) => ({ ...prev, [frameworkId]: false })),
      2000
    )
  }

  const handleClose = () => {
    setScript('')
    setResults({})
    setLoading({})
    setCopied({})
    onClose()
  }

  const isAnyLoading = Object.values(loading).some(Boolean)
  const resultCount = Object.keys(results).length

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-2 sm:p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-[98vw] h-[95vh] sm:w-[95vw] sm:h-[90vh] max-w-[1800px] shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b dark:border-gray-800 shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-purple-500" />
            <h2 className="text-base sm:text-lg font-bold dark:text-white">
              스토리텔링 베리에이션
            </h2>
            {resultCount > 0 && (
              <span className="text-xs bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 px-2 py-0.5 rounded-full">
                {resultCount}/7 생성됨
              </span>
            )}
          </div>
          <button
            onClick={handleClose}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
          >
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
          {/* Left Panel - Script Input */}
          <div className="w-full lg:w-[320px] xl:w-[360px] border-b lg:border-b-0 lg:border-r dark:border-gray-800 p-3 sm:p-4 flex flex-col shrink-0">
            <label className="text-sm font-medium mb-2 dark:text-gray-200">
              원본 대본
            </label>
            <Textarea
              value={script}
              onChange={(e) => setScript(e.target.value)}
              placeholder="여기에 광고 대본을 입력하세요..."
              className="flex-1 min-h-[120px] lg:min-h-0 resize-none text-sm"
            />
            <Button
              onClick={handleGenerateAll}
              className="w-full mt-3 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white"
              disabled={!script.trim() || isAnyLoading}
            >
              {isAnyLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  생성 중...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  전체 생성 (7개)
                </>
              )}
            </Button>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-2 text-center">
              또는 아래에서 개별 프레임워크를 선택하세요
            </p>
          </div>

          {/* Right Panel - Results Grid */}
          <div className="flex-1 overflow-y-auto p-3 sm:p-4">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3 sm:gap-4">
              {FRAMEWORKS.map((fw) => (
                <div
                  key={fw.id}
                  className={`border ${fw.border} rounded-xl overflow-hidden flex flex-col transition-shadow hover:shadow-lg`}
                >
                  {/* Card Header */}
                  <div
                    className={`bg-gradient-to-r ${fw.color} px-4 py-3 text-white`}
                  >
                    <h3 className="font-bold text-sm">{fw.name}</h3>
                    <p className="text-xs opacity-90 mt-0.5">
                      {fw.description}
                    </p>
                  </div>

                  {/* Card Body */}
                  <div
                    className={`flex-1 p-3 ${fw.bg} min-h-[180px] max-h-[350px] overflow-y-auto`}
                  >
                    {loading[fw.id] ? (
                      <div className="flex flex-col items-center justify-center h-full gap-2">
                        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          대본 재구성 중...
                        </span>
                      </div>
                    ) : results[fw.id] ? (
                      <pre className="text-sm whitespace-pre-wrap dark:text-gray-200 font-sans leading-relaxed">
                        {results[fw.id]}
                      </pre>
                    ) : (
                      <div className="flex flex-col items-center justify-center h-full text-gray-400 dark:text-gray-500 gap-1">
                        <Sparkles className="h-5 w-5 opacity-50" />
                        <span className="text-xs">아래 버튼을 눌러 생성</span>
                      </div>
                    )}
                  </div>

                  {/* Card Footer */}
                  <div className="px-3 py-2 border-t dark:border-gray-700 flex gap-2 bg-white dark:bg-gray-900">
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 text-xs h-8"
                      onClick={() => handleGenerate(fw.id)}
                      disabled={loading[fw.id] || !script.trim()}
                    >
                      {loading[fw.id] ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : results[fw.id] ? (
                        '다시 생성'
                      ) : (
                        '생성'
                      )}
                    </Button>
                    {results[fw.id] && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs h-8"
                        onClick={() => handleCopy(fw.id)}
                      >
                        {copied[fw.id] ? (
                          <>
                            <Check className="h-3 w-3 text-green-500 mr-1" />
                            복사됨
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3 mr-1" />
                            복사
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
