'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { Sparkles, Upload, Copy, Check, Plus, Minus, Loader2, FileText, History, Trash2, MessageCircle, Send, ChevronRight, Maximize2, RotateCcw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Label } from '@/components/ui/label'

interface Message {
  role: 'user' | 'assistant'
  content: string
  options?: string[]
}

interface VariationItem {
  script: string
  changePoint: string
}

interface HistoryItem {
  id: string
  timestamp: Date
  productName: string
  originalScript: string
  variations: VariationItem[]
  messages: Message[]
}

const STORAGE_KEY = 'video-variation-history'

// 추천 프롬프트
const SAVED_PROMPTS = [
  { label: '톤 변경', prompt: '톤앤매너를 바꾸고 싶어요' },
  { label: '타겟 변경', prompt: '타겟층을 다르게 해주세요' },
  { label: '소구점 강조', prompt: '특정 소구점을 더 강조해주세요' },
  { label: '스타일 변경', prompt: '문장 스타일을 바꿔주세요' },
]

// 진행률 단계 정의 (최소 3번 대화 필요)
const PROGRESS_STEPS = [
  { threshold: 0, label: '시작', description: '대본을 입력해주세요' },
  { threshold: 10, label: '1단계', description: 'AI 질문에 답변해주세요 (1/3)' },
  { threshold: 33, label: '2단계', description: '한 번 더 답변해주세요 (2/3)' },
  { threshold: 66, label: '3단계', description: '마지막 답변을 해주세요 (3/3)' },
  { threshold: 100, label: '준비 완료', description: '생성 준비가 완료되었습니다!' },
]

export default function VideoVariationPage() {
  const [originalScript, setOriginalScript] = useState('')
  const [productName, setProductName] = useState('')
  const [appeals, setAppeals] = useState<string[]>([''])
  const [variations, setVariations] = useState<VariationItem[]>([])
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null)
  
  // 채팅 관련
  const [messages, setMessages] = useState<Message[]>([])
  const [inputMessage, setInputMessage] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [readyToGenerate, setReadyToGenerate] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [selectedOptions, setSelectedOptions] = useState<Set<string>>(new Set())
  const [showMultiSelect, setShowMultiSelect] = useState(false)
  
  // 스트리밍 관련
  const [streamingTexts, setStreamingTexts] = useState<string[]>(['', '', ''])
  const [completedBatches, setCompletedBatches] = useState<Set<number>>(new Set())
  
  // 재생성 관련
  const [canRegenerate, setCanRegenerate] = useState(false)
  
  // 히스토리 확대 모달
  const [showHistoryModal, setShowHistoryModal] = useState(false)
  
  const chatEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // 진행률 계산 (사용자 답변 수 기준 - 최소 3번 대화 필요)
  const progress = useMemo(() => {
    if (!originalScript || messages.length === 0) return 0
    const userMessages = messages.filter(m => m.role === 'user').length
    // 최소 3번의 답변이 있어야 100%
    if (userMessages >= 3) return 100
    if (userMessages === 2) return 66
    if (userMessages === 1) return 33
    if (messages.length > 0) return 10 // AI 첫 질문만 있음
    return 0
  }, [messages, originalScript])

  // 현재 단계 찾기
  const currentStep = useMemo(() => {
    return PROGRESS_STEPS.reduce((prev, curr) => 
      progress >= curr.threshold ? curr : prev
    , PROGRESS_STEPS[0])
  }, [progress])

  // 히스토리 로드
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        setHistory(parsed.map((h: HistoryItem) => ({
          ...h,
          timestamp: new Date(h.timestamp)
        })))
      } catch { /* ignore */ }
    }
  }, [])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Textarea 높이 자동 조절
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 100) + 'px'
    }
  }, [inputMessage])

  function saveHistory(newHistory: HistoryItem[]) {
    setHistory(newHistory)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newHistory))
  }

  function parseSRT(content: string): string {
    const lines = content.split('\n')
    const textLines: string[] = []
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()
      if (/^\d+$/.test(line)) continue
      if (/^\d{2}:\d{2}:\d{2}/.test(line)) continue
      if (!line) continue
      textLines.push(line)
    }
    return textLines.join('\n')
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (event) => {
      const text = event.target?.result as string
      if (text) {
        const parsed = file.name.endsWith('.srt') ? parseSRT(text) : text
        setOriginalScript(parsed)
        // 대본 입력 시 첫 대화 시작
        startChat(parsed)
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  function startChat(script?: string) {
    const scriptToUse = script || originalScript
    if (!scriptToUse.trim()) return
    
    setMessages([{
      role: 'assistant',
      content: `대본을 확인했습니다! 📝\n\n베리에이션을 시작하기 전에 몇 가지 여쭤볼게요.\n\n**대본의 톤을 어떻게 변경하고 싶으신가요?**\n\nA. 더 친근하고 유머러스하게\nB. 진지하고 신뢰감 있게\nC. 감성적이고 따뜻하게\nD. 직접적이고 강렬하게\nE. 현재 톤 유지`,
      options: [
        '더 친근하고 유머러스하게',
        '진지하고 신뢰감 있게',
        '감성적이고 따뜻하게',
        '직접적이고 강렬하게',
        '현재 톤 유지'
      ]
    }])
    setVariations([])
    setReadyToGenerate(false)
  }

  function addAppeal() {
    setAppeals(prev => [...prev, ''])
  }

  function removeAppeal(index: number) {
    if (appeals.length <= 1) return
    setAppeals(prev => prev.filter((_, i) => i !== index))
  }

  function updateAppeal(index: number, value: string) {
    setAppeals(prev => prev.map((a, i) => i === index ? value : a))
  }

  // AI 응답에서 선택지 파싱
  function parseOptions(text: string): string[] {
    const options: string[] = []
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
    if (!msg || !originalScript) return
    
    setInputMessage('')
    const newMessages: Message[] = [...messages, { role: 'user', content: msg }]
    setMessages(newMessages)
    setChatLoading(true)
    
    try {
      const validAppeals = appeals.filter(a => a.trim())
      const res = await fetch('/api/ai/video-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          originalScript,
          productName: productName.trim(),
          appeals: validAppeals,
          messages: newMessages,
          userMessage: msg,
        }),
      })
      if (!res.ok) throw new Error('대화 실패')
      const data = await res.json()
      
      const options = parseOptions(data.reply)
      const hasMultipleChoice = data.reply.includes('다중') || data.reply.includes('여러 개') || options.length > 4
      
      setMessages([...newMessages, { 
        role: 'assistant', 
        content: data.reply,
        options: options.length >= 2 ? options : undefined
      }])
      
      setShowMultiSelect(hasMultipleChoice && options.length >= 2)
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

  function confirmMultiSelect() {
    if (selectedOptions.size > 0) {
      const selected = Array.from(selectedOptions).join(', ')
      sendMessage(selected)
      setSelectedOptions(new Set())
      setShowMultiSelect(false)
    }
  }

  // 베리에이션 결과 파싱
  function parseVariationsFromText(text: string, batchIndex: number): VariationItem[] {
    const results: VariationItem[] = []
    const blocks = text.split(/---/).filter(b => b.trim())
    
    for (let i = 0; i < blocks.length && i < 2; i++) {
      const block = blocks[i]
      const scriptMatch = block.match(/\[베리에이션\s*\d+\]\s*([\s\S]*?)(?=\[변경\s*포인트\]|$)/)
      const changeMatch = block.match(/\[변경\s*포인트\]\s*([^\n]+(?:\n(?![---\[])[^\n]*)*)/s)
      
      if (scriptMatch || block.length > 20) {
        results.push({
          script: scriptMatch?.[1]?.trim() || block.trim(),
          changePoint: changeMatch?.[1]?.trim() || ''
        })
      }
    }
    return results
  }

  // 스트리밍 API 호출
  async function fetchBatchStream(batchIndex: number): Promise<string> {
    const validAppeals = appeals.filter(a => a.trim())
    
    const res = await fetch('/api/ai/video-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        originalScript,
        productName: productName.trim(),
        appeals: validAppeals,
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
    if (!originalScript) return
    setGenerating(true)
    setVariations([])
    setStreamingTexts(['', '', ''])
    setCompletedBatches(new Set())

    try {
      const batchResults = await Promise.all([
        fetchBatchStream(0),
        fetchBatchStream(1),
        fetchBatchStream(2)
      ])

      const allVariations: VariationItem[] = []
      batchResults.forEach((text, batchIndex) => {
        const parsed = parseVariationsFromText(text, batchIndex)
        allVariations.push(...parsed)
      })

      setVariations(allVariations)
      
      // 히스토리에 저장
      if (allVariations.length > 0) {
        const historyItem: HistoryItem = {
          id: Date.now().toString(),
          timestamp: new Date(),
          productName: productName.trim() || '제품명 없음',
          originalScript: originalScript.slice(0, 100),
          variations: allVariations,
          messages
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
      console.error('베리에이션 실패:', error)
      alert('베리에이션 생성에 실패했습니다.')
    } finally {
      setGenerating(false)
    }
  }

  // 재생성 함수
  async function regenerateVariations() {
    if (!originalScript) return
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

      const allVariations: VariationItem[] = []
      batchResults.forEach((text, batchIndex) => {
        const parsed = parseVariationsFromText(text, batchIndex)
        allVariations.push(...parsed)
      })

      setVariations(allVariations)
      
      if (allVariations.length > 0) {
        const historyItem: HistoryItem = {
          id: Date.now().toString(),
          timestamp: new Date(),
          productName: productName.trim() || '제품명 없음',
          originalScript: originalScript.slice(0, 100),
          variations: allVariations,
          messages
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

  function copyToClipboard(text: string, index: number) {
    navigator.clipboard.writeText(text)
    setCopiedIndex(index)
    setTimeout(() => setCopiedIndex(null), 2000)
  }

  function loadHistory(item: HistoryItem) {
    setVariations(item.variations)
    setOriginalScript(item.originalScript)
    setProductName(item.productName)
    setMessages(item.messages || [])
    setExpandedIndex(null)
    if (item.variations.length > 0) setReadyToGenerate(false)
  }

  function deleteHistory(id: string) {
    saveHistory(history.filter(h => h.id !== id))
  }

  function resetAll() {
    setOriginalScript('')
    setMessages([])
    setVariations([])
    setReadyToGenerate(false)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  return (
    <div className="fixed inset-0 left-64 top-16 bottom-0 right-0 flex gap-4 p-4 overflow-hidden bg-gray-50">
      {/* 왼쪽: 입력 */}
      <div className="w-72 flex flex-col gap-3 flex-shrink-0">
        <Card className="flex-1 flex flex-col overflow-hidden">
          <CardHeader className="py-2 px-4 flex-shrink-0">
            <CardTitle className="text-sm flex items-center gap-2">
              <FileText className="h-4 w-4" />
              원본 대본
            </CardTitle>
            <CardDescription className="text-xs">
              SRT/TXT 파일 또는 직접 입력
            </CardDescription>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col gap-2 overflow-hidden p-3 pt-0">
            <div className="flex gap-2 flex-shrink-0">
              <input type="file" accept=".srt,.txt" className="hidden" id="srt-upload" onChange={handleFileUpload} />
              <Button variant="outline" size="sm" onClick={() => document.getElementById('srt-upload')?.click()} className="flex-1">
                <Upload className="h-4 w-4 mr-2" />업로드
              </Button>
              <Button variant="ghost" size="sm" onClick={resetAll} disabled={!originalScript}>초기화</Button>
            </div>
            <Textarea
              placeholder="대본 내용을 입력하세요..."
              className="flex-1 resize-none text-sm"
              value={originalScript}
              onChange={(e) => setOriginalScript(e.target.value)}
            />
            {originalScript && !messages.length && (
              <Button size="sm" onClick={() => startChat()} className="flex-shrink-0">
                대화 시작
              </Button>
            )}
            {originalScript && (
              <p className="text-xs text-muted-foreground">{originalScript.split('\n').length}줄</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-2 px-4">
            <CardTitle className="text-sm">제품 정보</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 p-3 pt-0">
            <div className="space-y-1">
              <Label className="text-xs">제품명</Label>
              <Input placeholder="예: 라비업 볼륨 넥크림" value={productName} onChange={(e) => setProductName(e.target.value)} className="text-sm" />
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label className="text-xs">소구점</Label>
                <Button type="button" variant="ghost" size="sm" onClick={addAppeal} className="h-6 px-2"><Plus className="h-3 w-3" /></Button>
              </div>
              {appeals.map((appeal, index) => (
                <div key={index} className="flex gap-1">
                  <Input placeholder={`소구점 ${index + 1}`} value={appeal} onChange={(e) => updateAppeal(index, e.target.value)} className="text-sm" />
                  {appeals.length > 1 && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => removeAppeal(index)} className="h-9 px-2"><Minus className="h-3 w-3" /></Button>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 가운데: 채팅 */}
      <div className="flex-1 flex flex-col min-w-0">
        <Card className="flex-1 flex flex-col overflow-hidden bg-gradient-to-b from-slate-50 to-white">
          {/* Saved Prompts */}
          {originalScript && messages.length > 0 && messages.length <= 3 && (
            <div className="px-4 py-2 border-b bg-white/50 flex items-center gap-2 flex-wrap flex-shrink-0">
              <span className="text-xs text-gray-500">추천:</span>
              {SAVED_PROMPTS.map((p, i) => (
                <button key={i} onClick={() => sendMessage(p.prompt)} className="px-3 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded-full transition-colors flex items-center gap-1">
                  {p.label}<ChevronRight className="h-3 w-3" />
                </button>
              ))}
            </div>
          )}

          <CardHeader className="py-2 px-4 border-b bg-white/80 backdrop-blur flex-shrink-0">
            <CardTitle className="text-sm flex items-center gap-2">
              <div className="p-1.5 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg">
                <MessageCircle className="h-4 w-4 text-white" />
              </div>
              베리에이션 대화
            </CardTitle>
          </CardHeader>
          
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.length === 0 && (
              <div className="text-center text-gray-400 py-16">
                <div className="w-16 h-16 mx-auto mb-4 bg-gradient-to-br from-purple-100 to-pink-100 rounded-full flex items-center justify-center">
                  <Sparkles className="h-8 w-8 text-purple-400" />
                </div>
                <p className="font-medium">대본을 입력하면</p>
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
                      <Button onClick={confirmMultiSelect} className="w-full mt-2 bg-purple-600 hover:bg-purple-700">
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

          <div className="p-3 border-t bg-white space-y-2 flex-shrink-0">
            {/* 진행률 표시 */}
            {messages.length > 0 && variations.length === 0 && (
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
            {messages.length > 0 && variations.length === 0 && (
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
                disabled={!originalScript || !messages.length || chatLoading || generating}
                rows={1}
                className="flex-1 px-4 py-2 border rounded-2xl resize-none text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50"
                style={{ maxHeight: '100px' }}
              />
              <Button onClick={() => sendMessage()} disabled={!inputMessage.trim() || chatLoading || !originalScript} className="rounded-full px-4 h-10">
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </Card>
      </div>

      {/* 오른쪽: 히스토리 + 결과 */}
      <div className="w-80 flex flex-col gap-3 flex-shrink-0">
        <Card className="flex-shrink-0" style={{ height: '160px' }}>
          <CardHeader className="py-2 px-4 border-b">
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2">
                <History className="h-4 w-4 text-orange-500" />히스토리
                {history.length > 0 && <span className="text-xs bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded-full">{history.length}</span>}
              </span>
              {history.length > 0 && (
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setShowHistoryModal(true)}>
                  <Maximize2 className="h-3 w-3 text-gray-400" />
                </Button>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-2 overflow-y-auto" style={{ height: 'calc(160px - 44px)' }}>
            {history.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-4">히스토리가 없습니다</p>
            ) : (
              <div className="space-y-1.5">
                {history.map(item => (
                  <div key={item.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-50 cursor-pointer group" onClick={() => loadHistory(item)}>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{item.productName}</p>
                      <p className="text-[10px] text-gray-400">{new Date(item.timestamp).toLocaleDateString()} · {item.variations.length}개</p>
                    </div>
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100" onClick={(e) => { e.stopPropagation(); deleteHistory(item.id) }}>
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
                <Sparkles className="h-4 w-4 text-green-500" />결과
              </span>
              {variations.length > 0 && <span className="text-xs bg-green-100 text-green-600 px-1.5 py-0.5 rounded-full">{variations.length}개</span>}
            </CardTitle>
          </CardHeader>
          
          <CardContent className="flex-1 overflow-y-auto p-3">
            {generating ? (
              <div className="space-y-2">
                {[0, 1, 2].map(batchIndex => {
                  const text = streamingTexts[batchIndex]
                  const isComplete = completedBatches.has(batchIndex)
                  const parsed = text ? parseVariationsFromText(text, batchIndex) : []
                  
                  return parsed.length > 0 ? (
                    parsed.map((v, i) => (
                      <div key={`${batchIndex}-${i}`} className={`bg-gradient-to-r from-purple-50 to-pink-50 rounded-lg p-3 border ${isComplete ? 'border-purple-100' : 'border-purple-300 animate-pulse'}`}>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[10px] font-bold text-purple-600 bg-purple-100 px-1.5 py-0.5 rounded">#{batchIndex * 2 + i + 1}</span>
                          {!isComplete && <Loader2 className="h-3 w-3 animate-spin text-purple-500" />}
                        </div>
                        <pre className="whitespace-pre-wrap text-xs text-gray-700 line-clamp-4">
                          {v.script}{!isComplete && <span className="animate-pulse">▊</span>}
                        </pre>
                      </div>
                    ))
                  ) : (
                    <div key={batchIndex} className="bg-gray-100 rounded-lg p-4 flex items-center justify-center">
                      <Loader2 className="h-4 w-4 animate-spin text-purple-500 mr-2" />
                      <span className="text-xs text-gray-500">배치 {batchIndex + 1} 생성 중...</span>
                    </div>
                  )
                })}
              </div>
            ) : variations.length > 0 ? (
              <div className="space-y-2">
                {variations.map((v, i) => (
                  <div key={i} className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-lg p-3 border border-green-100 group">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[10px] font-bold text-green-600 bg-green-100 px-1.5 py-0.5 rounded">#{i + 1}</span>
                      <Button variant="ghost" size="sm" onClick={() => copyToClipboard(v.script, i)} className="h-6 px-2 opacity-0 group-hover:opacity-100">
                        {copiedIndex === i ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                      </Button>
                    </div>
                    <pre 
                      className={`whitespace-pre-wrap text-xs text-gray-700 cursor-pointer ${expandedIndex === i ? '' : 'line-clamp-4'}`}
                      onClick={() => setExpandedIndex(expandedIndex === i ? null : i)}
                    >
                      {v.script}
                    </pre>
                    {v.changePoint && (
                      <p className="text-[10px] text-green-600 border-t border-green-100 pt-1.5 mt-2">💡 {v.changePoint}</p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center text-gray-400 py-12">
                <Sparkles className="h-10 w-10 mx-auto mb-3 opacity-50" />
                <p className="text-xs">대화 후 생성하면</p>
                <p className="text-xs">여기에 표시됩니다</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

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
                      <div className="bg-gradient-to-br from-purple-100 to-indigo-100 p-4">
                        <FileText className="h-8 w-8 text-purple-500" />
                      </div>
                      <div className="p-3">
                        <p className="font-medium text-sm truncate">{item.productName}</p>
                        <p className="text-xs text-gray-500 mt-1">
                          {new Date(item.timestamp).toLocaleDateString()} · {item.variations.length}개 베리에이션
                        </p>
                        <p className="text-[10px] text-gray-400 mt-1 truncate">{item.originalScript}</p>
                        <div className="flex gap-1 mt-2 flex-wrap">
                          {item.variations.slice(0, 2).map((v, vi) => (
                            <span key={vi} className="text-[10px] bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full truncate max-w-[120px]">
                              {v.script.slice(0, 20)}...
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
    </div>
  )
}
