'use client'

import { useState, useRef, useEffect } from 'react'
import { Upload, Send, Loader2, Image as ImageIcon, Sparkles, RefreshCw, Copy, Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface Variation {
  mainCopy: string
  subCopy: string
  changePoint: string
}

export default function ImageVariationPage() {
  // 상태
  const [image, setImage] = useState<string | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [analysis, setAnalysis] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [inputMessage, setInputMessage] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [readyToGenerate, setReadyToGenerate] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [variations, setVariations] = useState<Variation[]>([])
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)
  
  const chatEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 채팅 스크롤
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // 이미지 업로드
  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = async (event) => {
      const base64 = event.target?.result as string
      setImage(base64)
      setAnalysis(null)
      setMessages([])
      setVariations([])
      setReadyToGenerate(false)
      
      // 자동으로 분석 시작
      await analyzeImage(base64)
    }
    reader.readAsDataURL(file)
  }

  // 이미지 분석
  async function analyzeImage(imageData: string) {
    setAnalyzing(true)
    try {
      const res = await fetch('/api/ai/image-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imageData }),
      })
      
      if (!res.ok) throw new Error('분석 실패')
      
      const data = await res.json()
      setAnalysis(data.analysis)
      
      // 첫 인사 메시지 추가
      setMessages([{
        role: 'assistant',
        content: `이미지 분석이 완료되었습니다! 🎨\n\n이 광고 소재를 어떻게 베리에이션 하고 싶으신가요?\n\n예시:\n- "타겟을 20대 여성으로 바꾸고 싶어요"\n- "더 유머러스한 톤으로 만들어주세요"\n- "가격 할인을 더 강조해주세요"\n\n원하시는 방향을 자유롭게 말씀해주세요!`
      }])
    } catch (error) {
      console.error('분석 실패:', error)
      alert('이미지 분석에 실패했습니다.')
    } finally {
      setAnalyzing(false)
    }
  }

  // 메시지 전송
  async function sendMessage() {
    if (!inputMessage.trim() || !analysis) return
    
    const userMsg = inputMessage.trim()
    setInputMessage('')
    
    // 사용자 메시지 추가
    const newMessages: Message[] = [...messages, { role: 'user', content: userMsg }]
    setMessages(newMessages)
    
    setChatLoading(true)
    try {
      const res = await fetch('/api/ai/image-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageAnalysis: analysis,
          messages: newMessages,
          userMessage: userMsg,
        }),
      })
      
      if (!res.ok) throw new Error('대화 실패')
      
      const data = await res.json()
      
      // AI 응답 추가
      setMessages([...newMessages, { role: 'assistant', content: data.reply }])
      
      if (data.readyToGenerate) {
        setReadyToGenerate(true)
      }
    } catch (error) {
      console.error('대화 실패:', error)
      alert('응답 생성에 실패했습니다.')
    } finally {
      setChatLoading(false)
    }
  }

  // 베리에이션 생성
  async function generateVariations() {
    if (!analysis) return
    
    setGenerating(true)
    try {
      const res = await fetch('/api/ai/image-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageAnalysis: analysis,
          messages: messages,
          userMessage: '',
          generateFinal: true,
        }),
      })
      
      if (!res.ok) throw new Error('생성 실패')
      
      const data = await res.json()
      
      // 응답 파싱
      const parsed = parseVariations(data.reply)
      setVariations(parsed)
      
      // 완료 메시지
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `✨ 6개의 베리에이션이 생성되었습니다!\n\n오른쪽에서 결과를 확인하고 원하는 카피를 복사하세요.`
      }])
    } catch (error) {
      console.error('생성 실패:', error)
      alert('베리에이션 생성에 실패했습니다.')
    } finally {
      setGenerating(false)
    }
  }

  // 베리에이션 파싱
  function parseVariations(text: string): Variation[] {
    const results: Variation[] = []
    const blocks = text.split(/\[베리에이션\s*\d+\]/).filter(b => b.trim())
    
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

  // 복사
  function copyVariation(v: Variation, index: number) {
    const text = `메인: ${v.mainCopy}\n서브: ${v.subCopy}`
    navigator.clipboard.writeText(text)
    setCopiedIndex(index)
    setTimeout(() => setCopiedIndex(null), 2000)
  }

  // 리셋
  function reset() {
    setImage(null)
    setAnalysis(null)
    setMessages([])
    setVariations([])
    setReadyToGenerate(false)
  }

  return (
    <div className="h-[calc(100vh-2rem)] flex gap-4">
      {/* 왼쪽: 이미지 + 분석 결과 */}
      <div className="w-1/3 flex flex-col gap-4">
        <Card className="flex-shrink-0">
          <CardHeader className="py-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <ImageIcon className="h-5 w-5" />
              광고 소재 업로드
            </CardTitle>
          </CardHeader>
          <CardContent>
            {image ? (
              <div className="relative">
                <img 
                  src={image} 
                  alt="업로드된 이미지" 
                  className="w-full rounded-lg border"
                />
                <Button
                  variant="destructive"
                  size="sm"
                  className="absolute top-2 right-2"
                  onClick={reset}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div 
                className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:bg-gray-50 transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-12 w-12 mx-auto text-gray-400 mb-4" />
                <p className="text-gray-600 font-medium">클릭하여 이미지 업로드</p>
                <p className="text-sm text-gray-400 mt-1">JPG, PNG, GIF 지원</p>
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleImageUpload}
            />
          </CardContent>
        </Card>

        {/* 분석 결과 */}
        {analyzing && (
          <Card className="flex-1">
            <CardContent className="py-8 text-center">
              <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary mb-4" />
              <p className="text-gray-600">이미지 분석 중...</p>
              <p className="text-sm text-gray-400 mt-1">텍스트, 디자인, 사진을 분석하고 있습니다</p>
            </CardContent>
          </Card>
        )}

        {analysis && (
          <Card className="flex-1 overflow-hidden">
            <CardHeader className="py-3">
              <CardTitle className="text-lg">분석 결과</CardTitle>
            </CardHeader>
            <CardContent className="overflow-y-auto max-h-[300px]">
              <div className="prose prose-sm max-w-none text-gray-700 whitespace-pre-wrap">
                {analysis}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* 가운데: 채팅 */}
      <div className="w-1/3 flex flex-col">
        <Card className="flex-1 flex flex-col overflow-hidden">
          <CardHeader className="py-3 border-b">
            <CardTitle className="text-lg flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-purple-500" />
              베리에이션 대화
            </CardTitle>
          </CardHeader>
          
          {/* 채팅 메시지 */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 && !analyzing && !image && (
              <div className="text-center text-gray-400 py-8">
                <Sparkles className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>이미지를 업로드하면</p>
                <p>대화가 시작됩니다</p>
              </div>
            )}
            
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-lg px-4 py-2 ${
                    msg.role === 'user'
                      ? 'bg-primary text-white'
                      : 'bg-gray-100 text-gray-800'
                  }`}
                >
                  <p className="whitespace-pre-wrap text-sm">{msg.content}</p>
                </div>
              </div>
            ))}
            
            {chatLoading && (
              <div className="flex justify-start">
                <div className="bg-gray-100 rounded-lg px-4 py-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              </div>
            )}
            
            <div ref={chatEndRef} />
          </div>

          {/* 입력 영역 */}
          <div className="p-4 border-t space-y-3">
            {readyToGenerate && variations.length === 0 && (
              <Button
                className="w-full bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600"
                onClick={generateVariations}
                disabled={generating}
              >
                {generating ? (
                  <><Loader2 className="h-4 w-4 animate-spin mr-2" />생성 중...</>
                ) : (
                  <><Sparkles className="h-4 w-4 mr-2" />베리에이션 6개 생성하기</>
                )}
              </Button>
            )}
            
            <div className="flex gap-2">
              <Input
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                placeholder="원하는 베리에이션 방향을 입력하세요..."
                disabled={!analysis || chatLoading || generating}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
              />
              <Button
                onClick={sendMessage}
                disabled={!inputMessage.trim() || chatLoading || !analysis}
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </Card>
      </div>

      {/* 오른쪽: 베리에이션 결과 */}
      <div className="w-1/3 flex flex-col">
        <Card className="flex-1 flex flex-col overflow-hidden">
          <CardHeader className="py-3 border-b">
            <CardTitle className="text-lg flex items-center justify-between">
              <span className="flex items-center gap-2">
                <RefreshCw className="h-5 w-5 text-green-500" />
                베리에이션 결과
              </span>
              {variations.length > 0 && (
                <span className="text-sm font-normal text-gray-500">
                  {variations.length}개 생성됨
                </span>
              )}
            </CardTitle>
          </CardHeader>
          
          <CardContent className="flex-1 overflow-y-auto p-4">
            {variations.length === 0 ? (
              <div className="text-center text-gray-400 py-8">
                <RefreshCw className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>대화를 통해 방향을 정하면</p>
                <p>베리에이션이 생성됩니다</p>
              </div>
            ) : (
              <div className="space-y-4">
                {variations.map((v, i) => (
                  <div 
                    key={i} 
                    className="bg-gradient-to-r from-purple-50 to-pink-50 rounded-lg p-4 border border-purple-100"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <span className="text-xs font-medium text-purple-600 bg-purple-100 px-2 py-0.5 rounded">
                        #{i + 1}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => copyVariation(v, i)}
                        className="h-7 px-2"
                      >
                        {copiedIndex === i ? (
                          <Check className="h-3 w-3 text-green-500" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </Button>
                    </div>
                    
                    <p className="font-bold text-gray-800 mb-1">{v.mainCopy}</p>
                    <p className="text-gray-600 text-sm mb-2">{v.subCopy}</p>
                    
                    {v.changePoint && (
                      <p className="text-xs text-purple-500 border-t border-purple-100 pt-2 mt-2">
                        💡 {v.changePoint}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
