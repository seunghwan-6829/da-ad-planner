'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
import { Upload, Send, Loader2, Image as ImageIcon, Sparkles, RefreshCw, Copy, Check, X, History, Trash2, MessageCircle, FolderOpen, ChevronRight, Maximize2, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getBPMaterialsPaginated } from '@/lib/api/bp-materials'
import { BPMaterial } from '@/lib/supabase'

interface Message {
  role: 'user' | 'assistant'
  content: string
  options?: string[] // AI가 제시한 선택지
}

interface Variation {
  mainCopy: string
  subCopy: string
  changePoint: string
}

interface HistoryItem {
  id: string
  timestamp: Date
  imagePreview: string
  title: string
  variations: Variation[]
  messages: Message[]
  analysis: string
}

const STORAGE_KEY = 'image-variation-history'
const CATEGORIES = ['전체', '뷰티', '건강', '식품', '패션', '가전', '금융', '교육', '여행', '자동차', '대행', '기타']

// 추천 프롬프트
const SAVED_PROMPTS = [
  { label: '타겟 변경', prompt: '타겟층을 다르게 바꾸고 싶어요' },
  { label: '톤 변경', prompt: '광고 톤앤매너를 바꾸고 싶어요' },
  { label: '소구점 강조', prompt: '다른 소구점을 강조하고 싶어요' },
  { label: '스타일 변경', prompt: '카피 스타일을 바꾸고 싶어요' },
]

// 진행률 단계 정의 (최소 3번 대화 필요)
const PROGRESS_STEPS = [
  { threshold: 0, label: '시작', description: '이미지를 업로드해주세요' },
  { threshold: 10, label: '1단계', description: 'AI 질문에 답변해주세요 (1/3)' },
  { threshold: 33, label: '2단계', description: '한 번 더 답변해주세요 (2/3)' },
  { threshold: 66, label: '3단계', description: '마지막 답변을 해주세요 (3/3)' },
  { threshold: 100, label: '준비 완료', description: '생성 준비가 완료되었습니다!' },
]

export default function ImageVariationPage() {
  const [image, setImage] = useState<string | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [analysis, setAnalysis] = useState<string | null>(null)
  const [analysisStream, setAnalysisStream] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [inputMessage, setInputMessage] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [readyToGenerate, setReadyToGenerate] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [variations, setVariations] = useState<Variation[]>([])
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [imageZoom, setImageZoom] = useState(false)
  const [selectedOptions, setSelectedOptions] = useState<Set<string>>(new Set())
  const [showMultiSelect, setShowMultiSelect] = useState(false)
  
  const [showBPModal, setShowBPModal] = useState(false)
  const [bpMaterials, setBpMaterials] = useState<BPMaterial[]>([])
  const [bpCategory, setBpCategory] = useState('전체')
  const [bpLoading, setBpLoading] = useState(false)
  
  // 스트리밍 관련
  const [streamingTexts, setStreamingTexts] = useState<string[]>(['', '', ''])
  const [completedBatches, setCompletedBatches] = useState<Set<number>>(new Set())
  
  // 재생성 관련
  const [canRegenerate, setCanRegenerate] = useState(false)
  
  // 히스토리 확대 모달
  const [showHistoryModal, setShowHistoryModal] = useState(false)
  
  const chatEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // 진행률 계산 (사용자 답변 수 기준 - 최소 3번 대화 필요)
  const progress = useMemo(() => {
    if (!analysis) return 0
    const userMessages = messages.filter(m => m.role === 'user').length
    // 최소 3번의 답변이 있어야 100%
    if (userMessages >= 3) return 100
    if (userMessages === 2) return 66
    if (userMessages === 1) return 33
    if (messages.length > 0) return 10 // AI 첫 질문만 있음
    return 0
  }, [messages, analysis])

  // 현재 단계 찾기
  const currentStep = useMemo(() => {
    return PROGRESS_STEPS.reduce((prev, curr) => 
      progress >= curr.threshold ? curr : prev
    , PROGRESS_STEPS[0])
  }, [progress])

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        setHistory(parsed.map((h: HistoryItem) => ({ ...h, timestamp: new Date(h.timestamp) })))
      } catch { /* ignore */ }
    }
  }, [])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, analysisStream])

  // Textarea 높이 자동 조절
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + 'px'
    }
  }, [inputMessage])

  function saveHistory(newHistory: HistoryItem[]) {
    setHistory(newHistory)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newHistory))
  }

  async function loadBPMaterials(category: string) {
    setBpLoading(true)
    setBpCategory(category)
    const result = await getBPMaterialsPaginated(1, 100, category)
    setBpMaterials(result.data)
    setBpLoading(false)
  }

  async function openBPModal() {
    setShowBPModal(true)
    if (bpMaterials.length === 0) await loadBPMaterials('전체')
  }

  function selectBPMaterial(bp: BPMaterial) {
    if (bp.image_url) {
      setImage(bp.image_url)
      setShowBPModal(false)
      resetState()
      analyzeImage(bp.image_url)
    }
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async (event) => {
      const base64 = event.target?.result as string
      setImage(base64)
      resetState()
      await analyzeImage(base64)
    }
    reader.readAsDataURL(file)
  }

  function resetState() {
    setAnalysis(null)
    setAnalysisStream('')
    setMessages([])
    setVariations([])
    setReadyToGenerate(false)
    setSelectedOptions(new Set())
    setStreamingTexts(['', '', ''])
    setCompletedBatches(new Set())
  }

  // 실시간 스트리밍 분석
  async function analyzeImage(imageData: string) {
    setAnalyzing(true)
    setAnalysisStream('')
    
    try {
      const res = await fetch('/api/ai/image-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imageData }),
      })

      const reader = res.body?.getReader()
      if (!reader) throw new Error('스트림 불가')

      const decoder = new TextDecoder()
      let fullText = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        const lines = chunk.split('\n')

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))
              if (data.text) {
                fullText += data.text
                setAnalysisStream(fullText)
              }
              if (data.done) {
                setAnalysis(fullText)
                // 첫 대화 - 제품/소구점 질문
                setMessages([{
                  role: 'assistant',
                  content: `분석이 완료되었습니다! 🎨\n\n베리에이션을 시작하기 전에 몇 가지 여쭤볼게요.\n\n**어떤 제품/서비스를 판매하시나요?**\n간단하게 제품명과 특징을 알려주세요.`,
                }])
              }
            } catch { /* ignore */ }
          }
        }
      }
    } catch (error) {
      console.error('분석 실패:', error)
      alert('이미지 분석에 실패했습니다.')
    } finally {
      setAnalyzing(false)
    }
  }

  // AI 응답에서 선택지 파싱
  function parseOptions(text: string): string[] {
    const options: string[] = []
    // A. B. C. D. 형식 또는 1. 2. 3. 형식
    const matches = text.match(/(?:^|\n)\s*(?:[A-Z]\.|\d\.)\s*([^\n]+)/g)
    if (matches) {
      matches.forEach(m => {
        const cleaned = m.replace(/^\s*(?:[A-Z]\.|\d\.)\s*/, '').trim()
        if (cleaned.length > 2 && cleaned.length < 100) {
          options.push(cleaned)
        }
      })
    }
    return options
  }

  async function sendMessage(customMessage?: string) {
    const msg = customMessage || inputMessage.trim()
    if (!msg || !analysis) return
    
    setInputMessage('')
    const newMessages: Message[] = [...messages, { role: 'user', content: msg }]
    setMessages(newMessages)
    setChatLoading(true)
    
    try {
      const res = await fetch('/api/ai/image-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageAnalysis: analysis,
          messages: newMessages,
          userMessage: msg,
        }),
      })
      if (!res.ok) throw new Error('대화 실패')
      const data = await res.json()
      
      // 선택지 파싱
      const options = parseOptions(data.reply)
      const hasMultipleChoice = data.reply.includes('다중') || data.reply.includes('여러 개') || options.length > 3
      
      setMessages([...newMessages, { 
        role: 'assistant', 
        content: data.reply,
        options: options.length >= 2 ? options : undefined
      }])
      
      if (hasMultipleChoice && options.length >= 2) {
        setShowMultiSelect(true)
      } else {
        setShowMultiSelect(false)
      }
      
      if (data.readyToGenerate) setReadyToGenerate(true)
      
      // 베리에이션이 이미 생성된 상태에서 피드백을 보낸 경우 재생성 활성화
      if (variations.length > 0) {
        setCanRegenerate(true)
      }
    } catch (error) {
      console.error('대화 실패:', error)
      alert('응답 생성에 실패했습니다.')
    } finally {
      setChatLoading(false)
    }
  }

  // 선택지 클릭
  function handleOptionClick(option: string) {
    if (showMultiSelect) {
      setSelectedOptions(prev => {
        const next = new Set(prev)
        if (next.has(option)) next.delete(option)
        else next.add(option)
        return next
      })
    } else {
      sendMessage(option)
    }
  }

  // 다중 선택 확인
  function confirmMultiSelect() {
    if (selectedOptions.size > 0) {
      const selected = Array.from(selectedOptions).join(', ')
      sendMessage(selected)
      setSelectedOptions(new Set())
      setShowMultiSelect(false)
    }
  }

  // 스트리밍 API 호출 (배치별)
  async function fetchBatchStream(batchIndex: number): Promise<string> {
    const res = await fetch('/api/ai/image-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageAnalysis: analysis,
        messages,
        userMessage: '',
        generateFinal: true,
        batchIndex
      }),
    })

    if (!res.ok) throw new Error('API 오류')

    const reader = res.body?.getReader()
    if (!reader) throw new Error('스트림 불가')

    const decoder = new TextDecoder()
    let fullText = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const chunk = decoder.decode(value, { stream: true })
      const lines = chunk.split('\n')

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6))
            if (data.text) {
              fullText += data.text
              setStreamingTexts(prev => {
                const next = [...prev]
                next[batchIndex] = fullText
                return next
              })
            }
            if (data.done) {
              setCompletedBatches(prev => new Set([...prev, batchIndex]))
            }
          } catch { /* ignore */ }
        }
      }
    }
    return fullText
  }

  async function generateVariations() {
    if (!analysis || !image) return
    setGenerating(true)
    setVariations([])
    setStreamingTexts(['', '', ''])
    setCompletedBatches(new Set())

    try {
      // 3개 배치 병렬 호출 (각 2개씩 = 총 6개)
      const batchResults = await Promise.all([
        fetchBatchStream(0),
        fetchBatchStream(1),
        fetchBatchStream(2)
      ])

      // 결과 파싱 및 병합
      const allVariations: Variation[] = []
      batchResults.forEach((text) => {
        const parsed = parseVariations(text)
        allVariations.push(...parsed)
      })

      setVariations(allVariations)
      
      // 히스토리 저장 (대화 포함)
      if (allVariations.length > 0) {
        const historyItem: HistoryItem = {
          id: Date.now().toString(),
          timestamp: new Date(),
          imagePreview: image,
          title: messages.find(m => m.role === 'user')?.content.slice(0, 30) || '베리에이션',
          variations: allVariations,
          messages: messages,
          analysis: analysis
        }
        saveHistory([historyItem, ...history].slice(0, 20))
      }
      
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `✨ ${allVariations.length}개의 베리에이션이 완료되었습니다!\n\n오른쪽에서 결과를 확인해주세요.\n\n**수정이 필요하신가요?**\n고치고 싶은 부분이나 다른 방향이 있으시면 아래 채팅으로 말씀해주세요. 피드백을 확인한 후 재생성 버튼이 활성화됩니다! 💬`
      }])
      // 피드백 입력 전이므로 재생성 비활성화
      setCanRegenerate(false)
    } catch (error) {
      console.error('생성 실패:', error)
      alert('베리에이션 생성에 실패했습니다.')
    } finally {
      setGenerating(false)
    }
  }

  // 재생성 함수
  async function regenerateVariations() {
    if (!analysis || !image) return
    setGenerating(true)
    setVariations([])
    setStreamingTexts(['', '', ''])
    setCompletedBatches(new Set())
    setCanRegenerate(false)

    try {
      const batchResults = await Promise.all([
        fetchBatchStream(0),
        fetchBatchStream(1),
        fetchBatchStream(2)
      ])

      const allVariations: Variation[] = []
      batchResults.forEach((text) => {
        const parsed = parseVariations(text)
        allVariations.push(...parsed)
      })

      setVariations(allVariations)
      
      if (allVariations.length > 0) {
        const historyItem: HistoryItem = {
          id: Date.now().toString(),
          timestamp: new Date(),
          imagePreview: image,
          title: messages.find(m => m.role === 'user')?.content.slice(0, 30) || '베리에이션',
          variations: allVariations,
          messages: messages,
          analysis: analysis
        }
        saveHistory([historyItem, ...history].slice(0, 20))
      }
      
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `🔄 피드백을 반영하여 ${allVariations.length}개를 재생성했습니다!\n\n추가 수정이 필요하시면 말씀해주세요.`
      }])
      setCanRegenerate(true)
    } catch (error) {
      console.error('재생성 실패:', error)
      alert('재생성에 실패했습니다.')
    } finally {
      setGenerating(false)
    }
  }

  function parseVariations(text: string): Variation[] {
    const results: Variation[] = []
    const blocks = text.split(/\[베리에이션\s*\d+\]|---/).filter(b => b.trim())
    for (const block of blocks) {
      const mainMatch = block.match(/메인\s*카피[:\s]*([^\n]+)/)
      const subMatch = block.match(/서브\s*카피[:\s]*([^\n]+)/)
      const changeMatch = block.match(/변경\s*포인트[:\s]*([^\n]+)/)
      if (mainMatch || subMatch) {
        results.push({
          mainCopy: mainMatch?.[1]?.trim() || '',
          subCopy: subMatch?.[1]?.trim() || '',
          changePoint: changeMatch?.[1]?.trim() || ''
        })
      }
    }
    return results
  }

  function copyVariation(v: Variation, index: number) {
    navigator.clipboard.writeText(`${v.mainCopy}\n${v.subCopy}`)
    setCopiedIndex(index)
    setTimeout(() => setCopiedIndex(null), 2000)
  }

  // 히스토리 불러오기 (채팅 재개 가능)
  function loadHistory(item: HistoryItem) {
    setVariations(item.variations)
    setImage(item.imagePreview)
    setAnalysis(item.analysis)
    setAnalysisStream(item.analysis)
    setMessages(item.messages || [{ role: 'assistant', content: `📂 이전 작업을 불러왔습니다.\n"${item.title}"` }])
    if (item.variations.length > 0) {
      setReadyToGenerate(false) // 이미 생성됨
    }
  }

  function deleteHistory(id: string) {
    saveHistory(history.filter(h => h.id !== id))
  }

  function reset() {
    setImage(null)
    resetState()
  }

  // 키보드 이벤트
  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  return (
    <div className="fixed inset-0 left-64 top-16 bottom-0 right-0 flex gap-4 p-4 overflow-hidden bg-gray-50">
      {/* 왼쪽: 이미지 + 분석 */}
      <div className="w-72 flex flex-col gap-3 flex-shrink-0">
        <Card>
          <CardHeader className="py-2 px-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <ImageIcon className="h-4 w-4" />
              소재 업로드
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            {image ? (
              <div className="relative">
                <img 
                  src={image} 
                  alt="업로드된 이미지" 
                  className="w-full max-h-48 object-contain rounded-lg border bg-gray-50 cursor-pointer hover:opacity-90"
                  onClick={() => setImageZoom(true)}
                />
                <Button variant="destructive" size="sm" className="absolute top-2 right-2 h-6 w-6 p-0" onClick={reset}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <div 
                  className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:bg-gray-50"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-8 w-8 mx-auto text-gray-400 mb-2" />
                  <p className="text-xs text-gray-500">클릭하여 업로드</p>
                </div>
                <Button variant="outline" size="sm" className="w-full" onClick={openBPModal}>
                  <FolderOpen className="h-4 w-4 mr-2" />
                  BP소재에서 가져오기
                </Button>
              </div>
            )}
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
          </CardContent>
        </Card>

        {/* 분석 결과 - 실시간 스트리밍 */}
        {(analyzing || analysisStream) && (
          <Card className="flex-1 flex flex-col overflow-hidden">
            <CardHeader className="py-2 px-4 flex-shrink-0">
              <CardTitle className="text-sm flex items-center gap-2">
                {analyzing && <Loader2 className="h-3 w-3 animate-spin" />}
                분석 결과
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0 flex-1 overflow-y-auto">
              <div className="text-xs text-gray-600 whitespace-pre-wrap leading-relaxed">
                {analysisStream}
                {analyzing && <span className="animate-pulse">▊</span>}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* 가운데: 채팅 */}
      <div className="flex-1 flex flex-col min-w-0">
        <Card className="flex-1 flex flex-col overflow-hidden bg-gradient-to-b from-slate-50 to-white">
          {/* Saved Prompts 영역 */}
          {analysis && messages.length <= 2 && (
            <div className="px-4 py-2 border-b bg-white/50 flex items-center gap-2 flex-wrap">
              <span className="text-xs text-gray-500">추천:</span>
              {SAVED_PROMPTS.map((p, i) => (
                <button
                  key={i}
                  onClick={() => sendMessage(p.prompt)}
                  className="px-3 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded-full transition-colors flex items-center gap-1"
                >
                  {p.label}
                  <ChevronRight className="h-3 w-3" />
                </button>
              ))}
            </div>
          )}
          
          <CardHeader className="py-3 px-4 border-b bg-white/80 backdrop-blur flex-shrink-0">
            <CardTitle className="text-base flex items-center gap-2">
              <div className="p-1.5 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg">
                <MessageCircle className="h-4 w-4 text-white" />
              </div>
              베리에이션 대화
            </CardTitle>
          </CardHeader>
          
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.length === 0 && !analyzing && !image && (
              <div className="text-center text-gray-400 py-16">
                <div className="w-16 h-16 mx-auto mb-4 bg-gradient-to-br from-purple-100 to-pink-100 rounded-full flex items-center justify-center">
                  <Sparkles className="h-8 w-8 text-purple-400" />
                </div>
                <p className="font-medium">이미지를 업로드하면</p>
                <p className="text-sm">대화가 시작됩니다</p>
              </div>
            )}
            
            {messages.map((msg, i) => (
              <div key={i}>
                <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {msg.role === 'assistant' && (
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center mr-2 flex-shrink-0">
                      <Sparkles className="h-4 w-4 text-white" />
                    </div>
                  )}
                  <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 shadow-sm ${
                    msg.role === 'user'
                      ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-br-md'
                      : 'bg-white text-gray-800 border rounded-bl-md'
                  }`}>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">{msg.content}</p>
                  </div>
                </div>
                
                {/* 선택지 버튼 */}
                {msg.role === 'assistant' && msg.options && msg.options.length > 0 && i === messages.length - 1 && (
                  <div className="ml-10 mt-2 space-y-1.5">
                    {msg.options.map((opt, oi) => (
                      <button
                        key={oi}
                        onClick={() => handleOptionClick(opt)}
                        className={`w-full text-left px-4 py-2.5 rounded-lg border text-sm transition-all ${
                          selectedOptions.has(opt)
                            ? 'bg-purple-100 border-purple-400 text-purple-700'
                            : 'bg-white hover:bg-gray-50 border-gray-200 text-gray-700'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span>{opt}</span>
                          <ChevronRight className="h-4 w-4 text-gray-400" />
                        </div>
                      </button>
                    ))}
                    {showMultiSelect && selectedOptions.size > 0 && (
                      <Button 
                        onClick={confirmMultiSelect}
                        className="w-full mt-2 bg-purple-600 hover:bg-purple-700"
                      >
                        선택 확인 ({selectedOptions.size}개)
                      </Button>
                    )}
                  </div>
                )}
              </div>
            ))}
            
            {chatLoading && (
              <div className="flex justify-start">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center mr-2">
                  <Sparkles className="h-4 w-4 text-white" />
                </div>
                <div className="bg-white rounded-2xl rounded-bl-md px-4 py-3 border shadow-sm">
                  <div className="flex gap-1">
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}
            
            {/* 재생성 버튼 - 채팅 영역 내부 */}
            {variations.length > 0 && canRegenerate && !generating && (
              <div className="flex justify-center py-2">
                <Button
                  className="bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 shadow-lg px-6"
                  onClick={regenerateVariations}
                >
                  <RotateCcw className="h-4 w-4 mr-2" />
                  피드백 반영하여 재생성
                </Button>
              </div>
            )}
            
            <div ref={chatEndRef} />
          </div>

          {/* 입력 영역 - 멀티라인 지원 */}
          <div className="p-3 border-t bg-white space-y-2 flex-shrink-0">
            {/* 진행률 표시 */}
            {analysis && variations.length === 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-500">진행률</span>
                  <span className={`font-medium ${progress === 100 ? 'text-green-600' : 'text-purple-600'}`}>
                    {progress}% - {currentStep.label}
                  </span>
                </div>
                <div className="relative h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div 
                    className={`absolute left-0 top-0 h-full transition-all duration-500 ease-out rounded-full ${
                      progress === 100 
                        ? 'bg-gradient-to-r from-green-400 to-emerald-500' 
                        : 'bg-gradient-to-r from-purple-400 to-pink-500'
                    }`}
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <p className="text-[10px] text-gray-400 text-center">{currentStep.description}</p>
              </div>
            )}
            
            {/* 생성 버튼 - 100%일 때만 활성화 */}
            {variations.length === 0 && (
              <Button
                className={`w-full shadow-lg transition-all ${
                  progress === 100
                    ? 'bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600'
                    : 'bg-gray-300 cursor-not-allowed'
                }`}
                onClick={generateVariations}
                disabled={generating || progress < 100}
              >
                {generating ? (
                  <><Loader2 className="h-4 w-4 animate-spin mr-2" />생성 중...</>
                ) : progress < 100 ? (
                  <><Sparkles className="h-4 w-4 mr-2" />대화를 더 진행해주세요 ({progress}%)</>
                ) : (
                  <><Sparkles className="h-4 w-4 mr-2" />베리에이션 6개 생성</>
                )}
              </Button>
            )}
            
            <div className="flex gap-2 items-end">
              <textarea
                ref={textareaRef}
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="원하는 방향을 입력하세요... (Shift+Enter: 줄바꿈)"
                disabled={!analysis || chatLoading || generating}
                rows={1}
                className="flex-1 px-4 py-2 border rounded-2xl resize-none text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ maxHeight: '120px' }}
              />
              <Button
                onClick={() => sendMessage()}
                disabled={!inputMessage.trim() || chatLoading || !analysis}
                className="rounded-full px-4 h-10"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </Card>
      </div>

      {/* 오른쪽: 히스토리 + 결과 */}
      <div className="w-80 flex flex-col gap-3 flex-shrink-0">
        <Card className="flex-shrink-0" style={{ height: '180px' }}>
          <CardHeader className="py-2 px-4 border-b">
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2">
                <History className="h-4 w-4 text-orange-500" />
                히스토리
                {history.length > 0 && (
                  <span className="text-xs bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded-full">{history.length}</span>
                )}
              </span>
              {history.length > 0 && (
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setShowHistoryModal(true)}>
                  <Maximize2 className="h-3 w-3 text-gray-400" />
                </Button>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-2 overflow-y-auto" style={{ height: 'calc(180px - 44px)' }}>
            {history.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-6">히스토리가 없습니다</p>
            ) : (
              <div className="space-y-1.5">
                {history.map(item => (
                  <div
                    key={item.id}
                    className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-50 cursor-pointer group"
                    onClick={() => loadHistory(item)}
                  >
                    <img src={item.imagePreview} alt="" className="w-10 h-10 object-cover rounded border" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{item.title}</p>
                      <p className="text-[10px] text-gray-400">
                        {new Date(item.timestamp).toLocaleDateString()} · {item.variations.length}개
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100"
                      onClick={(e) => { e.stopPropagation(); deleteHistory(item.id) }}
                    >
                      <Trash2 className="h-3 w-3 text-gray-400" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="flex-1 flex flex-col overflow-hidden">
          <CardHeader className="py-2 px-4 border-b flex-shrink-0">
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2">
                <RefreshCw className="h-4 w-4 text-green-500" />
                결과
              </span>
              {variations.length > 0 && (
                <span className="text-xs bg-green-100 text-green-600 px-1.5 py-0.5 rounded-full">{variations.length}개</span>
              )}
            </CardTitle>
          </CardHeader>
          
          <CardContent className="flex-1 overflow-y-auto p-3">
            {generating ? (
              // 실시간 스트리밍 표시
              <div className="space-y-2">
                {[0, 1, 2].map(batchIndex => {
                  const text = streamingTexts[batchIndex]
                  const isComplete = completedBatches.has(batchIndex)
                  const parsed = text ? parseVariations(text) : []
                  
                  return parsed.length > 0 ? (
                    parsed.map((v, i) => (
                      <div 
                        key={`${batchIndex}-${i}`}
                        className={`bg-gradient-to-r from-purple-50 to-pink-50 rounded-lg p-3 border ${
                          isComplete ? 'border-purple-100' : 'border-purple-300 animate-pulse'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[10px] font-bold text-purple-600 bg-purple-100 px-1.5 py-0.5 rounded">#{batchIndex * 2 + i + 1}</span>
                          {!isComplete && <Loader2 className="h-3 w-3 animate-spin text-purple-500" />}
                        </div>
                        <p className="font-bold text-gray-800 text-sm mb-0.5">
                          {v.mainCopy}
                          {!isComplete && !v.mainCopy && <span className="animate-pulse">▊</span>}
                        </p>
                        <p className="text-gray-600 text-xs">{v.subCopy}</p>
                        {v.changePoint && (
                          <p className="text-[10px] text-purple-600 border-t border-purple-100 pt-1.5 mt-2">💡 {v.changePoint}</p>
                        )}
                      </div>
                    ))
                  ) : text ? (
                    <div key={batchIndex} className="bg-purple-50 rounded-lg p-3 border border-purple-200 animate-pulse">
                      <div className="flex items-center gap-2">
                        <Loader2 className="h-3 w-3 animate-spin text-purple-500" />
                        <span className="text-xs text-purple-600">배치 {batchIndex + 1} 생성 중...</span>
                      </div>
                      <p className="text-xs text-gray-500 mt-2 whitespace-pre-wrap line-clamp-3">{text.slice(-100)}</p>
                    </div>
                  ) : (
                    <div key={batchIndex} className="bg-gray-100 rounded-lg p-3 border border-gray-200 flex items-center gap-2">
                      <Loader2 className="h-3 w-3 animate-spin text-gray-400" />
                      <span className="text-xs text-gray-500">배치 {batchIndex + 1} 대기 중...</span>
                    </div>
                  )
                })}
              </div>
            ) : variations.length === 0 ? (
              <div className="text-center text-gray-400 py-12">
                <RefreshCw className="h-10 w-10 mx-auto mb-3 opacity-50" />
                <p className="text-xs">대화 후 생성하면</p>
                <p className="text-xs">여기에 표시됩니다</p>
              </div>
            ) : (
              <div className="space-y-2">
                {variations.map((v, i) => (
                  <div key={i} className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-lg p-3 border border-green-100 group">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[10px] font-bold text-green-600 bg-green-100 px-1.5 py-0.5 rounded">#{i + 1}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => copyVariation(v, i)}
                        className="h-6 px-2 opacity-0 group-hover:opacity-100"
                      >
                        {copiedIndex === i ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                      </Button>
                    </div>
                    <p className="font-bold text-gray-800 text-sm mb-0.5">{v.mainCopy}</p>
                    <p className="text-gray-600 text-xs">{v.subCopy}</p>
                    {v.changePoint && (
                      <p className="text-[10px] text-green-600 border-t border-green-100 pt-1.5 mt-2">💡 {v.changePoint}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 이미지 확대 모달 */}
      {imageZoom && image && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-8" onClick={() => setImageZoom(false)}>
          <div className="relative max-w-4xl max-h-full">
            <img src={image} alt="확대 이미지" className="max-w-full max-h-[85vh] object-contain rounded-lg" />
            <Button variant="secondary" size="sm" className="absolute top-2 right-2" onClick={() => setImageZoom(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* 히스토리 확대 모달 */}
      {showHistoryModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-6" onClick={() => setShowHistoryModal(false)}>
          <div className="bg-white rounded-xl w-[80vw] max-w-4xl h-[80vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b flex items-center justify-between flex-shrink-0">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <History className="h-6 w-6 text-orange-500" />
                히스토리
                <span className="text-sm font-normal text-gray-500">({history.length}개)</span>
              </h2>
              <Button variant="ghost" size="sm" onClick={() => setShowHistoryModal(false)}>
                <X className="h-5 w-5" />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {history.length === 0 ? (
                <div className="text-center text-gray-400 py-20">
                  <History className="h-16 w-16 mx-auto mb-4 opacity-50" />
                  <p className="text-lg">히스토리가 없습니다</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {history.map(item => (
                    <div
                      key={item.id}
                      className="border rounded-xl overflow-hidden hover:shadow-lg cursor-pointer transition-all group"
                      onClick={() => { loadHistory(item); setShowHistoryModal(false) }}
                    >
                      <div className="aspect-video bg-gray-100 relative overflow-hidden">
                        <img src={item.imagePreview} alt="" className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                      </div>
                      <div className="p-3">
                        <p className="font-medium text-sm truncate">{item.title}</p>
                        <p className="text-xs text-gray-500 mt-1">
                          {new Date(item.timestamp).toLocaleDateString()} · {item.variations.length}개 베리에이션
                        </p>
                        <div className="flex gap-1 mt-2 flex-wrap">
                          {item.variations.slice(0, 2).map((v, vi) => (
                            <span key={vi} className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full truncate max-w-[120px]">
                              {v.mainCopy}
                            </span>
                          ))}
                          {item.variations.length > 2 && (
                            <span className="text-[10px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                              +{item.variations.length - 2}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="px-3 pb-3">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="w-full text-red-500 hover:text-red-600 hover:bg-red-50"
                          onClick={(e) => { e.stopPropagation(); deleteHistory(item.id) }}
                        >
                          <Trash2 className="h-3 w-3 mr-1" />
                          삭제
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* BP 소재 선택 모달 */}
      {showBPModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-6" onClick={() => setShowBPModal(false)}>
          <div className="bg-white rounded-xl w-[90vw] max-w-6xl h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b flex items-center justify-between flex-shrink-0">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <FolderOpen className="h-6 w-6 text-primary" />
                BP 소재 선택
              </h2>
              <Button variant="ghost" size="sm" onClick={() => setShowBPModal(false)}>
                <X className="h-5 w-5" />
              </Button>
            </div>
            <div className="p-4 border-b flex flex-wrap gap-2 flex-shrink-0">
              {CATEGORIES.map(cat => (
                <button
                  key={cat}
                  onClick={() => loadBPMaterials(cat)}
                  className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
                    bpCategory === cat ? 'bg-primary text-white shadow-md' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {bpLoading ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="h-10 w-10 animate-spin text-primary" />
                </div>
              ) : bpMaterials.length === 0 ? (
                <div className="text-center text-gray-400 py-20">
                  <ImageIcon className="h-16 w-16 mx-auto mb-3 opacity-50" />
                  <p className="text-lg">해당 카테고리에 소재가 없습니다</p>
                </div>
              ) : (
                <div className="grid grid-cols-6 gap-4">
                  {bpMaterials.map(bp => (
                    <div
                      key={bp.id}
                      className="cursor-pointer rounded-lg border overflow-hidden hover:shadow-xl hover:border-primary hover:scale-[1.02] transition-all"
                      onClick={() => selectBPMaterial(bp)}
                    >
                      {bp.image_url && <img src={bp.image_url} alt={bp.name} className="w-full aspect-square object-cover" />}
                      <div className="p-2">
                        <p className="text-xs font-medium truncate">{bp.name}</p>
                        {bp.category && <span className="text-[10px] text-gray-400">{bp.category}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
