'use client'

import { useState, useEffect } from 'react'
import {
  Lightbulb,
  Loader2,
  Copy,
  Check,
  Send,
  ChevronDown,
  ChevronUp,
  FileText,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/lib/auth-context'
import { aiFetch } from '@/lib/ai-fetch'
import {
  getClients,
  getClientsForUser,
  getProjectPlans,
  getPlanScenes,
  Client,
  ProjectPlan,
  PlanScene,
} from '@/lib/api/clients'

interface GeneratedIdea {
  id: string
  prompt: string
  result: string
  timestamp: Date
}

export default function PlanIdeasPage() {
  const { user, isAdmin } = useAuth()
  const [clients, setClients] = useState<Client[]>([])
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  const [loading, setLoading] = useState(true)

  // 기존 대본 데이터
  const [existingScripts, setExistingScripts] = useState<string[]>([])
  const [scriptsLoading, setScriptsLoading] = useState(false)
  const [showScripts, setShowScripts] = useState(false)

  // AI 생성
  const [prompt, setPrompt] = useState('')
  const [generating, setGenerating] = useState(false)
  const [ideas, setIdeas] = useState<GeneratedIdea[]>([])
  const [copied, setCopied] = useState<Record<string, boolean>>({})

  useEffect(() => {
    loadClients()
  }, [user, isAdmin])

  async function loadClients() {
    if (!user) return
    try {
      const data = isAdmin
        ? await getClients()
        : await getClientsForUser(user.id)
      setClients(data)
    } catch (err) {
      console.error('클라이언트 로드 실패:', err)
    } finally {
      setLoading(false)
    }
  }

  async function handleSelectClient(client: Client) {
    setSelectedClient(client)
    setIdeas([])
    setPrompt('')
    setScriptsLoading(true)
    setShowScripts(false)

    try {
      // 클라이언트의 모든 기획안에서 대본만 추출
      const plans = await getProjectPlans(client.id)
      const allScripts: string[] = []

      for (const plan of plans) {
        const scenes = await getPlanScenes(plan.id)
        const planScripts = scenes
          .filter((s) => s.script && s.script.trim())
          .map((s) => s.script as string)

        if (planScripts.length > 0) {
          allScripts.push(
            `[${plan.title}]\n${planScripts.join('\n')}`
          )
        }
      }

      setExistingScripts(allScripts)
    } catch (err) {
      console.error('대본 로드 실패:', err)
    } finally {
      setScriptsLoading(false)
    }
  }

  async function handleGenerate() {
    if (!prompt.trim() || !selectedClient) return

    setGenerating(true)
    try {
      const res = await aiFetch('/api/ai/plan-ideas', {
        method: 'POST',
        body: JSON.stringify({
          prompt: prompt.trim(),
          existingScripts,
          clientName: selectedClient.name,
          previousResults: ideas.map((i) => i.result).slice(0, 5),
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '생성 실패')

      setIdeas((prev) => [
        {
          id: Date.now().toString(),
          prompt: prompt.trim(),
          result: data.result,
          timestamp: new Date(),
        },
        ...prev,
      ])
      setPrompt('')
    } catch (error: any) {
      alert(`생성 실패: ${error?.message || '알 수 없는 오류'}`)
    } finally {
      setGenerating(false)
    }
  }

  function handleCopy(id: string, text: string) {
    navigator.clipboard.writeText(text)
    setCopied((prev) => ({ ...prev, [id]: true }))
    setTimeout(() => setCopied((prev) => ({ ...prev, [id]: false })), 2000)
  }

  function handleDelete(id: string) {
    setIdeas((prev) => prev.filter((i) => i.id !== id))
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <div className="flex h-screen">
        {/* 왼쪽 브랜드 목록 */}
        <div className="w-64 border-r bg-white dark:bg-gray-900 dark:border-gray-800 flex flex-col">
          <div className="p-4 border-b dark:border-gray-800">
            <div className="flex items-center gap-2">
              <Lightbulb className="h-5 w-5 text-yellow-500" />
              <h1 className="text-lg font-bold dark:text-white">
                기획안 아이디어
              </h1>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              브랜드별 AI 대본 생성
            </p>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {clients.length === 0 ? (
              <div className="text-center py-8">
                <FileText className="h-8 w-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                <p className="text-sm text-gray-400 dark:text-gray-500">
                  기획안 제작에서
                  <br />
                  클라이언트를 추가하세요
                </p>
              </div>
            ) : (
              clients.map((client) => (
                <button
                  key={client.id}
                  onClick={() => handleSelectClient(client)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors mb-1 ${
                    selectedClient?.id === client.id
                      ? 'bg-primary text-white'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                >
                  <div
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: client.color }}
                  />
                  <span className="truncate">{client.name}</span>
                </button>
              ))
            )}
          </div>
        </div>

        {/* 오른쪽 메인 영역 */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {!selectedClient ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <Lightbulb className="h-16 w-16 text-gray-200 dark:text-gray-700 mx-auto mb-4" />
                <h2 className="text-xl font-bold text-gray-400 dark:text-gray-500 mb-2">
                  브랜드를 선택하세요
                </h2>
                <p className="text-sm text-gray-400 dark:text-gray-500">
                  왼쪽에서 브랜드를 선택하면 기존 대본을 기반으로
                  <br />
                  AI가 새로운 대본 아이디어를 만들어줍니다
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* 상단: 브랜드 정보 + 기존 대본 */}
              <div className="border-b dark:border-gray-800 bg-white dark:bg-gray-900">
                <div className="px-6 py-4">
                  <div className="flex items-center gap-3 mb-2">
                    <div
                      className="w-4 h-4 rounded-full"
                      style={{ backgroundColor: selectedClient.color }}
                    />
                    <h2 className="text-lg font-bold dark:text-white">
                      {selectedClient.name}
                    </h2>
                    {existingScripts.length > 0 && (
                      <span className="text-xs bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 px-2 py-0.5 rounded-full">
                        기존 대본 {existingScripts.length}건 학습됨
                      </span>
                    )}
                  </div>

                  {/* 기존 대본 토글 */}
                  {scriptsLoading ? (
                    <div className="flex items-center gap-2 text-sm text-gray-500">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      기존 대본 불러오는 중...
                    </div>
                  ) : existingScripts.length > 0 ? (
                    <div>
                      <button
                        onClick={() => setShowScripts(!showScripts)}
                        className="flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                      >
                        <FileText className="h-3.5 w-3.5" />
                        학습된 기존 대본 보기
                        {showScripts ? (
                          <ChevronUp className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5" />
                        )}
                      </button>
                      {showScripts && (
                        <div className="mt-2 max-h-48 overflow-y-auto bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-xs text-gray-600 dark:text-gray-400 whitespace-pre-wrap">
                          {existingScripts.join('\n\n')}
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-400 dark:text-gray-500">
                      기존 대본이 없습니다. 새로운 대본을 처음부터
                      만들어보세요.
                    </p>
                  )}
                </div>

                {/* 입력 영역 */}
                <div className="px-6 pb-4">
                  <div className="flex gap-3">
                    <Textarea
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      placeholder={`"${selectedClient.name}" 브랜드의 새 광고 대본을 요청하세요. 예: "신제품 출시 릴스 대본 만들어줘", "할인 이벤트 숏폼 대본", "브랜드 소개 영상 대본"...`}
                      className="flex-1 resize-none min-h-[80px]"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          handleGenerate()
                        }
                      }}
                    />
                    <Button
                      onClick={handleGenerate}
                      disabled={generating || !prompt.trim()}
                      className="bg-yellow-500 hover:bg-yellow-600 text-white self-end px-6"
                    >
                      {generating ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>

              {/* 생성된 아이디어 목록 */}
              <div className="flex-1 overflow-y-auto p-6">
                {ideas.length === 0 && !generating ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center">
                      <Sparkles className="h-12 w-12 text-gray-200 dark:text-gray-700 mx-auto mb-3" />
                      <p className="text-gray-400 dark:text-gray-500">
                        위에서 대본을 요청하면 결과가 여기에 표시됩니다
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4 max-w-4xl">
                    {generating && (
                      <div className="bg-white dark:bg-gray-900 rounded-xl border dark:border-gray-800 p-6">
                        <div className="flex items-center gap-2">
                          <Loader2 className="h-5 w-5 animate-spin text-yellow-500" />
                          <span className="text-sm font-medium dark:text-gray-200">
                            AI가 대본을 작성하고 있습니다...
                          </span>
                        </div>
                      </div>
                    )}

                    {ideas.map((idea) => (
                      <div
                        key={idea.id}
                        className="bg-white dark:bg-gray-900 rounded-xl border dark:border-gray-800 overflow-hidden"
                      >
                        <div className="px-5 py-3 bg-gray-50 dark:bg-gray-800 border-b dark:border-gray-700 flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium dark:text-gray-200">
                              {idea.prompt}
                            </p>
                            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                              {idea.timestamp.toLocaleTimeString('ko-KR')}
                            </p>
                          </div>
                          <div className="flex items-center gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 px-2"
                              onClick={() => handleCopy(idea.id, idea.result)}
                            >
                              {copied[idea.id] ? (
                                <Check className="h-4 w-4 text-green-500" />
                              ) : (
                                <Copy className="h-4 w-4 text-gray-400" />
                              )}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 px-2"
                              onClick={() => handleDelete(idea.id)}
                            >
                              <Trash2 className="h-4 w-4 text-gray-400 hover:text-red-500" />
                            </Button>
                          </div>
                        </div>
                        <div className="p-5">
                          <pre className="text-sm whitespace-pre-wrap dark:text-gray-200 font-sans leading-relaxed">
                            {idea.result}
                          </pre>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
