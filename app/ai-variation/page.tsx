'use client'

import { useState, useEffect, useRef } from 'react'
import { Sparkles, Upload, Copy, Check, Plus, Minus, Loader2, FileText, History, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Label } from '@/components/ui/label'

interface VariationItem {
  script: string
  changePoint: string
  streaming?: boolean
}

interface HistoryItem {
  id: string
  timestamp: Date
  productName: string
  originalScript: string
  variations: VariationItem[]
}

const STORAGE_KEY = 'video-variation-history'

export default function VideoVariationPage() {
  const [originalScript, setOriginalScript] = useState('')
  const [productName, setProductName] = useState('')
  const [appeals, setAppeals] = useState<string[]>([''])
  const [variations, setVariations] = useState<VariationItem[]>([])
  const [loading, setLoading] = useState(false)
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null)
  const [streamingTexts, setStreamingTexts] = useState<string[]>(['', '', '']) // 3개 배치
  const [completedBatches, setCompletedBatches] = useState<Set<number>>(new Set())
  
  const resultsRef = useRef<HTMLDivElement>(null)

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

  // 히스토리 저장
  function saveHistory(newHistory: HistoryItem[]) {
    setHistory(newHistory)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newHistory))
  }

  // SRT 파일 파싱 함수
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
        if (file.name.endsWith('.srt')) {
          setOriginalScript(parseSRT(text))
        } else {
          setOriginalScript(text)
        }
      }
    }
    reader.readAsText(file)
    e.target.value = ''
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

  // 베리에이션 결과 파싱 (실시간 스트리밍용)
  function parseVariationsFromText(text: string, batchIndex: number): VariationItem[] {
    const results: VariationItem[] = []
    const blocks = text.split(/---/).filter(b => b.trim())
    
    const startNum = batchIndex * 2 + 1
    
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

  // 스트리밍 API 호출 (배치별)
  async function fetchBatchStream(batchIndex: number): Promise<string> {
    const validAppeals = appeals.filter(a => a.trim())
    
    const res = await fetch('/api/ai/srt-variation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        originalScript: originalScript.trim(),
        productName: productName.trim(),
        appeals: validAppeals,
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

  async function generateVariation() {
    if (!originalScript.trim()) {
      alert('원본 대본을 입력해주세요.')
      return
    }

    setLoading(true)
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
          originalScript: originalScript.trim().slice(0, 100),
          variations: allVariations
        }
        saveHistory([historyItem, ...history].slice(0, 20))
      }
    } catch (error) {
      console.error('베리에이션 실패:', error)
      alert('베리에이션 생성에 실패했습니다.')
    } finally {
      setLoading(false)
    }
  }

  function copyToClipboard(text: string, index: number) {
    navigator.clipboard.writeText(text)
    setCopiedIndex(index)
    setTimeout(() => setCopiedIndex(null), 2000)
  }

  function loadHistory(item: HistoryItem) {
    setVariations(item.variations)
    setExpandedIndex(null)
  }

  function deleteHistory(id: string) {
    saveHistory(history.filter(h => h.id !== id))
  }

  // 현재 스트리밍 중인 결과 표시용 파싱
  function getCurrentStreamingVariations(): { batchIndex: number; text: string; parsed: VariationItem[] }[] {
    return streamingTexts.map((text, batchIndex) => ({
      batchIndex,
      text,
      parsed: text ? parseVariationsFromText(text, batchIndex) : []
    })).filter(b => b.text.length > 0)
  }

  return (
    <div className="fixed inset-0 left-64 top-16 bottom-0 right-0 flex gap-4 p-4 overflow-hidden bg-gray-50">
      {/* 왼쪽: 입력 */}
      <div className="w-80 flex flex-col gap-3 flex-shrink-0">
        {/* 원본 대본 */}
        <Card className="flex-1 flex flex-col overflow-hidden">
          <CardHeader className="py-2 px-4 flex-shrink-0">
            <CardTitle className="text-sm flex items-center gap-2">
              <FileText className="h-4 w-4" />
              원본 대본
            </CardTitle>
            <CardDescription className="text-xs">
              SRT 파일을 업로드하거나 직접 입력하세요
            </CardDescription>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col gap-2 overflow-hidden p-3 pt-0">
            <div className="flex gap-2 flex-shrink-0">
              <input
                type="file"
                accept=".srt,.txt"
                className="hidden"
                id="srt-upload"
                onChange={handleFileUpload}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => document.getElementById('srt-upload')?.click()}
                className="flex-1"
              >
                <Upload className="h-4 w-4 mr-2" />
                SRT/TXT 업로드
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setOriginalScript('')}
                disabled={!originalScript}
              >
                초기화
              </Button>
            </div>
            <Textarea
              placeholder="대본 내용을 입력하세요..."
              className="flex-1 resize-none text-sm"
              value={originalScript}
              onChange={(e) => setOriginalScript(e.target.value)}
            />
            {originalScript && (
              <p className="text-xs text-muted-foreground flex-shrink-0">
                {originalScript.split('\n').length}줄, {originalScript.length}자
              </p>
            )}
          </CardContent>
        </Card>

        {/* 제품명 & 소구점 */}
        <Card>
          <CardHeader className="py-2 px-4">
            <CardTitle className="text-sm">제품 정보</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 p-3 pt-0">
            <div className="space-y-1">
              <Label className="text-xs">제품명</Label>
              <Input
                placeholder="예: 라비업 볼륨 넥크림"
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                className="text-sm"
              />
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label className="text-xs">소구점</Label>
                <Button type="button" variant="ghost" size="sm" onClick={addAppeal} className="h-6 px-2">
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
              {appeals.map((appeal, index) => (
                <div key={index} className="flex gap-1">
                  <Input
                    placeholder={`소구점 ${index + 1}`}
                    value={appeal}
                    onChange={(e) => updateAppeal(index, e.target.value)}
                    className="text-sm"
                  />
                  {appeals.length > 1 && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => removeAppeal(index)} className="h-9 px-2">
                      <Minus className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* 생성 버튼 */}
        <Button
          onClick={generateVariation}
          disabled={loading || !originalScript.trim()}
          className="w-full bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600"
        >
          {loading ? (
            <><Loader2 className="h-4 w-4 mr-2 animate-spin" />생성 중...</>
          ) : (
            <><Sparkles className="h-4 w-4 mr-2" />영상 베리에이션 생성</>
          )}
        </Button>
      </div>

      {/* 가운데: 결과 */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Card className="flex-1 overflow-hidden flex flex-col">
          <CardHeader className="py-2 px-4 border-b flex-shrink-0">
            <CardTitle className="text-sm flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-purple-600" />
              베리에이션 결과
              {loading && (
                <span className="text-xs text-purple-500 flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  실시간 생성 중...
                </span>
              )}
              {!loading && variations.length > 0 && (
                <span className="text-xs bg-purple-100 text-purple-600 px-2 py-0.5 rounded-full">
                  {variations.length}개
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent ref={resultsRef} className="flex-1 overflow-y-auto p-4">
            {loading ? (
              // 실시간 스트리밍 표시
              <div className="grid grid-cols-2 gap-4">
                {[0, 1, 2].map(batchIndex => {
                  const text = streamingTexts[batchIndex]
                  const isComplete = completedBatches.has(batchIndex)
                  const parsed = text ? parseVariationsFromText(text, batchIndex) : []
                  
                  return parsed.length > 0 ? (
                    parsed.map((v, i) => (
                      <div 
                        key={`${batchIndex}-${i}`}
                        className={`bg-gradient-to-br from-purple-50 to-pink-50 rounded-xl border ${
                          isComplete ? 'border-purple-100' : 'border-purple-300 animate-pulse'
                        } overflow-hidden`}
                      >
                        <div className="px-4 py-2 bg-white/50 border-b border-purple-100 flex items-center justify-between">
                          <span className="text-sm font-bold text-purple-700">
                            베리에이션 #{batchIndex * 2 + i + 1}
                          </span>
                          {!isComplete && <Loader2 className="h-3 w-3 animate-spin text-purple-500" />}
                        </div>
                        <div className="p-4">
                          <pre className="whitespace-pre-wrap text-sm text-gray-700 line-clamp-8">
                            {v.script}
                            {!isComplete && <span className="animate-pulse">▊</span>}
                          </pre>
                        </div>
                        {v.changePoint && (
                          <div className="px-4 py-2 bg-gradient-to-r from-yellow-50 to-orange-50 border-t border-yellow-200">
                            <p className="text-xs text-yellow-600">💡 {v.changePoint}</p>
                          </div>
                        )}
                      </div>
                    ))
                  ) : (
                    <div 
                      key={batchIndex}
                      className="bg-gray-100 rounded-xl border border-gray-200 p-8 flex items-center justify-center"
                    >
                      <div className="text-center">
                        <Loader2 className="h-6 w-6 animate-spin text-purple-500 mx-auto mb-2" />
                        <p className="text-xs text-gray-500">배치 {batchIndex + 1} 생성 중...</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : variations.length > 0 ? (
              <div className="grid grid-cols-2 gap-4">
                {variations.map((v, i) => (
                  <div 
                    key={i} 
                    className="bg-gradient-to-br from-purple-50 to-pink-50 rounded-xl border border-purple-100 overflow-hidden"
                  >
                    <div className="px-4 py-2 bg-white/50 border-b border-purple-100 flex items-center justify-between">
                      <span className="text-sm font-bold text-purple-700">
                        베리에이션 #{i + 1}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => copyToClipboard(v.script, i)}
                        className="h-7 px-2"
                      >
                        {copiedIndex === i ? (
                          <><Check className="h-3 w-3 text-green-500 mr-1" />복사됨</>
                        ) : (
                          <><Copy className="h-3 w-3 mr-1" />복사</>
                        )}
                      </Button>
                    </div>
                    
                    <div 
                      className="p-4 cursor-pointer"
                      onClick={() => setExpandedIndex(expandedIndex === i ? null : i)}
                    >
                      <pre className={`whitespace-pre-wrap text-sm text-gray-700 ${
                        expandedIndex === i ? '' : 'line-clamp-8'
                      }`}>
                        {v.script}
                      </pre>
                      {v.script.split('\n').length > 8 && expandedIndex !== i && (
                        <p className="text-xs text-purple-500 mt-2">클릭하여 전체 보기</p>
                      )}
                    </div>
                    
                    {v.changePoint && (
                      <div className="px-4 py-3 bg-gradient-to-r from-yellow-50 to-orange-50 border-t border-yellow-200">
                        <div className="flex items-start gap-2">
                          <span className="text-yellow-600 flex-shrink-0">💡</span>
                          <div>
                            <p className="text-xs font-medium text-yellow-700 mb-0.5">변경 포인트</p>
                            <p className="text-xs text-yellow-600">{v.changePoint}</p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center justify-center py-20 text-center">
                <div>
                  <Sparkles className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                  <p className="text-muted-foreground">
                    원본 대본을 입력하고<br />
                    베리에이션을 생성해보세요
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 오른쪽: 히스토리 */}
      <div className="w-64 flex flex-col flex-shrink-0">
        <Card className="flex-1 flex flex-col overflow-hidden">
          <CardHeader className="py-2 px-4 border-b flex-shrink-0">
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
          <CardContent className="flex-1 overflow-y-auto p-2">
            {history.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-8">
                베리에이션을 생성하면<br />히스토리가 저장됩니다
              </p>
            ) : (
              <div className="space-y-2">
                {history.map(item => (
                  <div
                    key={item.id}
                    className="p-2 rounded-lg border hover:bg-gray-50 cursor-pointer group"
                    onClick={() => loadHistory(item)}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium truncate flex-1">{item.productName}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 flex-shrink-0"
                        onClick={(e) => { e.stopPropagation(); deleteHistory(item.id) }}
                      >
                        <Trash2 className="h-3 w-3 text-gray-400" />
                      </Button>
                    </div>
                    <p className="text-[10px] text-gray-400 truncate">{item.originalScript}</p>
                    <p className="text-[10px] text-purple-500">
                      {new Date(item.timestamp).toLocaleDateString()} · {item.variations.length}개
                    </p>
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
