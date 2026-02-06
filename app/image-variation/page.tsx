'use client'

import { useState, useRef, useEffect } from 'react'
import { Upload, Send, Loader2, Image as ImageIcon, Sparkles, RefreshCw, Copy, Check, X, History, Trash2, MessageCircle, FolderOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getBPMaterialsPaginated } from '@/lib/api/bp-materials'
import { BPMaterial } from '@/lib/supabase'

interface Message {
  role: 'user' | 'assistant'
  content: string
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
}

const STORAGE_KEY = 'image-variation-history'
const CATEGORIES = ['전체', '뷰티', '건강', '식품', '패션', '가전', '금융', '교육', '여행', '자동차', '대행', '기타']

export default function ImageVariationPage() {
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
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [showAnalysis, setShowAnalysis] = useState(false)
  const [imageZoom, setImageZoom] = useState(false)
  
  const [showBPModal, setShowBPModal] = useState(false)
  const [bpMaterials, setBpMaterials] = useState<BPMaterial[]>([])
  const [bpCategory, setBpCategory] = useState('전체')
  const [bpLoading, setBpLoading] = useState(false)
  
  const chatEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

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
    if (bpMaterials.length === 0) {
      await loadBPMaterials('전체')
    }
  }

  function selectBPMaterial(bp: BPMaterial) {
    if (bp.image_url) {
      setImage(bp.image_url)
      setShowBPModal(false)
      setAnalysis(null)
      setMessages([])
      setVariations([])
      setReadyToGenerate(false)
      setShowAnalysis(false)
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
      setAnalysis(null)
      setMessages([])
      setVariations([])
      setReadyToGenerate(false)
      setShowAnalysis(false)
      await analyzeImage(base64)
    }
    reader.readAsDataURL(file)
  }

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
      setMessages([{
        role: 'assistant',
        content: `분석 완료! 🎨 이 소재를 어떻게 바꾸고 싶으신가요?\n\n💡 예시:\n• 타겟 변경 (20대 여성 → 30대 남성)\n• 톤 변경 (진지 → 유머)\n• 강조점 변경 (가격 → 품질)`
      }])
    } catch (error) {
      console.error('분석 실패:', error)
      alert('이미지 분석에 실패했습니다.')
    } finally {
      setAnalyzing(false)
    }
  }

  async function sendMessage() {
    if (!inputMessage.trim() || !analysis) return
    const userMsg = inputMessage.trim()
    setInputMessage('')
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
      setMessages([...newMessages, { role: 'assistant', content: data.reply }])
      if (data.readyToGenerate) setReadyToGenerate(true)
    } catch (error) {
      console.error('대화 실패:', error)
      alert('응답 생성에 실패했습니다.')
    } finally {
      setChatLoading(false)
    }
  }

  async function generateVariations() {
    if (!analysis || !image) return
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
      const parsed = parseVariations(data.reply)
      setVariations(parsed)
      const historyItem: HistoryItem = {
        id: Date.now().toString(),
        timestamp: new Date(),
        imagePreview: image,
        title: messages.find(m => m.role === 'user')?.content.slice(0, 30) || '베리에이션',
        variations: parsed
      }
      saveHistory([historyItem, ...history].slice(0, 20))
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `✨ ${parsed.length}개의 베리에이션 완료!\n아래에서 결과를 확인하세요.`
      }])
    } catch (error) {
      console.error('생성 실패:', error)
      alert('베리에이션 생성에 실패했습니다.')
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
    const text = `${v.mainCopy}\n${v.subCopy}`
    navigator.clipboard.writeText(text)
    setCopiedIndex(index)
    setTimeout(() => setCopiedIndex(null), 2000)
  }

  function loadHistory(item: HistoryItem) {
    setVariations(item.variations)
    setImage(item.imagePreview)
    setAnalysis(null)
    setMessages([{ role: 'assistant', content: `📂 이전 작업을 불러왔습니다.\n"${item.title}"` }])
  }

  function deleteHistory(id: string) {
    saveHistory(history.filter(h => h.id !== id))
  }

  function reset() {
    setImage(null)
    setAnalysis(null)
    setMessages([])
    setVariations([])
    setReadyToGenerate(false)
  }

  return (
    <div className="fixed inset-0 left-64 top-16 bottom-0 right-0 flex gap-4 p-4 overflow-hidden bg-gray-50">
      {/* 왼쪽: 이미지 + 분석 */}
      <div className="w-72 flex flex-col gap-3 flex-shrink-0">
        {/* 이미지 업로드 */}
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
                  className="w-full max-h-48 object-contain rounded-lg border bg-gray-50 cursor-pointer hover:opacity-90 transition-opacity"
                  onClick={() => setImageZoom(true)}
                />
                <Button
                  variant="destructive"
                  size="sm"
                  className="absolute top-2 right-2 h-6 w-6 p-0"
                  onClick={reset}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <div 
                  className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:bg-gray-50 transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-8 w-8 mx-auto text-gray-400 mb-2" />
                  <p className="text-xs text-gray-500">클릭하여 업로드</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={openBPModal}
                >
                  <FolderOpen className="h-4 w-4 mr-2" />
                  BP소재에서 가져오기
                </Button>
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

        {/* 분석 로딩 */}
        {analyzing && (
          <Card className="flex-1">
            <CardContent className="py-8 text-center">
              <Loader2 className="h-6 w-6 animate-spin mx-auto text-primary mb-2" />
              <p className="text-sm text-gray-600">분석 중...</p>
            </CardContent>
          </Card>
        )}

        {/* 분석 결과 */}
        {analysis && (
          <Card className="flex-1 flex flex-col overflow-hidden">
            <CardHeader className="py-2 px-4 flex-shrink-0">
              <CardTitle className="text-sm flex items-center justify-between">
                <span>분석 결과</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs"
                  onClick={() => setShowAnalysis(!showAnalysis)}
                >
                  {showAnalysis ? '접기' : '펼치기'}
                </Button>
              </CardTitle>
            </CardHeader>
            {showAnalysis && (
              <CardContent className="p-3 pt-0 flex-1 overflow-y-auto">
                <div className="text-xs text-gray-600 whitespace-pre-wrap leading-relaxed">
                  {analysis}
                </div>
              </CardContent>
            )}
          </Card>
        )}
      </div>

      {/* 가운데: 채팅 */}
      <div className="flex-1 flex flex-col min-w-0">
        <Card className="flex-1 flex flex-col overflow-hidden bg-gradient-to-b from-slate-50 to-white">
          <CardHeader className="py-3 px-4 border-b bg-white/80 backdrop-blur flex-shrink-0">
            <CardTitle className="text-base flex items-center gap-2">
              <div className="p-1.5 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg">
                <MessageCircle className="h-4 w-4 text-white" />
              </div>
              베리에이션 대화
            </CardTitle>
          </CardHeader>
          
          {/* 채팅 메시지 */}
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
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
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
            <div ref={chatEndRef} />
          </div>

          {/* 입력 영역 */}
          <div className="p-3 border-t bg-white space-y-2 flex-shrink-0">
            {readyToGenerate && variations.length === 0 && (
              <Button
                className="w-full bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 shadow-lg"
                onClick={generateVariations}
                disabled={generating}
              >
                {generating ? (
                  <><Loader2 className="h-4 w-4 animate-spin mr-2" />생성 중...</>
                ) : (
                  <><Sparkles className="h-4 w-4 mr-2" />베리에이션 6개 생성</>
                )}
              </Button>
            )}
            <div className="flex gap-2">
              <Input
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                placeholder="원하는 방향을 입력하세요..."
                disabled={!analysis || chatLoading || generating}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
                className="rounded-full px-4"
              />
              <Button
                onClick={sendMessage}
                disabled={!inputMessage.trim() || chatLoading || !analysis}
                className="rounded-full px-4"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </Card>
      </div>

      {/* 오른쪽: 히스토리 + 결과 */}
      <div className="w-80 flex flex-col gap-3 flex-shrink-0">
        {/* 히스토리 */}
        <Card className="flex-shrink-0" style={{ height: '180px' }}>
          <CardHeader className="py-2 px-4 border-b">
            <CardTitle className="text-sm flex items-center gap-2">
              <History className="h-4 w-4 text-orange-500" />
              히스토리
              {history.length > 0 && (
                <span className="text-xs bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded-full">
                  {history.length}
                </span>
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

        {/* 결과 */}
        <Card className="flex-1 flex flex-col overflow-hidden">
          <CardHeader className="py-2 px-4 border-b flex-shrink-0">
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2">
                <RefreshCw className="h-4 w-4 text-green-500" />
                결과
              </span>
              {variations.length > 0 && (
                <span className="text-xs bg-green-100 text-green-600 px-1.5 py-0.5 rounded-full">
                  {variations.length}개
                </span>
              )}
            </CardTitle>
          </CardHeader>
          
          <CardContent className="flex-1 overflow-y-auto p-3">
            {variations.length === 0 ? (
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
                        className="h-6 px-2 opacity-0 group-hover:opacity-100 transition-opacity"
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

      {/* BP 소재 선택 모달 - 크기 키움 */}
      {showBPModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-6" onClick={() => setShowBPModal(false)}>
          <div className="bg-white rounded-xl w-[90vw] max-w-6xl h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            {/* 헤더 */}
            <div className="p-4 border-b flex items-center justify-between flex-shrink-0">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <FolderOpen className="h-6 w-6 text-primary" />
                BP 소재 선택
              </h2>
              <Button variant="ghost" size="sm" onClick={() => setShowBPModal(false)}>
                <X className="h-5 w-5" />
              </Button>
            </div>
            
            {/* 카테고리 필터 */}
            <div className="p-4 border-b flex flex-wrap gap-2 flex-shrink-0">
              {CATEGORIES.map(cat => (
                <button
                  key={cat}
                  onClick={() => loadBPMaterials(cat)}
                  className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
                    bpCategory === cat
                      ? 'bg-primary text-white shadow-md'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
            
            {/* 소재 목록 */}
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
                      {bp.image_url && (
                        <img src={bp.image_url} alt={bp.name} className="w-full aspect-square object-cover" />
                      )}
                      <div className="p-2">
                        <p className="text-xs font-medium truncate">{bp.name}</p>
                        {bp.category && (
                          <span className="text-[10px] text-gray-400">{bp.category}</span>
                        )}
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
