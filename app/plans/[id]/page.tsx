'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { ArrowLeft, Save, Image, Video, Copy, Check, Sparkles, Loader2, Lightbulb, TrendingUp, MessageSquare, Zap, History, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getPlan, updatePlan } from '@/lib/api/plans'
import { getAdvertisers } from '@/lib/api/advertisers'
import { AdPlan, Advertiser } from '@/lib/supabase'

interface CopySet {
  id: string
  timestamp: Date
  mediaType: 'image' | 'video'
  copies: { title: string; description: string }[]
}

export default function PlanDetailPage() {
  const router = useRouter()
  const params = useParams()
  const id = params.id as string

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)
  const [plan, setPlan] = useState<AdPlan | null>(null)
  const [advertisers, setAdvertisers] = useState<Advertiser[]>([])
  const [selectedAdvertiser, setSelectedAdvertiser] = useState<Advertiser | null>(null)
  
  // AI 카피 생성 상태
  const [aiLoading, setAiLoading] = useState(false)
  const [aiResults, setAiResults] = useState<{ title: string; description: string }[]>([])
  const [streamText, setStreamText] = useState('')
  const [showAiPanel, setShowAiPanel] = useState(false)
  
  // 카피 히스토리
  const [copyHistory, setCopyHistory] = useState<CopySet[]>([])
  
  // AI 도우미 입력
  const [customPrompt, setCustomPrompt] = useState('')
  
  const [formData, setFormData] = useState({
    title: '',
    advertiser_id: '',
    media_type: 'image' as 'image' | 'video',
  })

  useEffect(() => {
    loadData()
  }, [id])

  async function loadData() {
    try {
      const [planData, advertisersData] = await Promise.all([
        getPlan(id),
        getAdvertisers()
      ])
      
      setPlan(planData)
      setAdvertisers(advertisersData)
      
      setFormData({
        title: planData.title,
        advertiser_id: planData.advertiser_id || '',
        media_type: planData.media_type,
      })

      if (planData.advertiser_id) {
        const advertiser = advertisersData.find(a => a.id === planData.advertiser_id)
        setSelectedAdvertiser(advertiser || null)
      }
    } catch (error) {
      console.error('데이터 로드 실패:', error)
      router.push('/plans')
    } finally {
      setLoading(false)
    }
  }

  function handleAdvertiserChange(advertiserId: string) {
    setFormData({ ...formData, advertiser_id: advertiserId })
    const advertiser = advertisers.find(a => a.id === advertiserId)
    setSelectedAdvertiser(advertiser || null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    
    if (!formData.title.trim()) {
      alert('기획서 제목을 입력해주세요.')
      return
    }

    setSaving(true)
    try {
      await updatePlan(id, {
        title: formData.title,
        advertiser_id: formData.advertiser_id || null,
        media_type: formData.media_type,
        size: null,
        concept: null,
        main_copy: null,
        sub_copy: null,
        cta_text: null,
        notes: null,
      })
      alert('저장되었습니다.')
    } catch (error) {
      console.error('저장 실패:', error)
      alert('저장에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  function copyToClipboard(text?: string) {
    const copyText = text || (() => {
      let t = `[광고 기획서: ${formData.title}]\n\n`
      t += `소재 유형: ${formData.media_type === 'image' ? '이미지' : '영상'}\n`
      if (selectedAdvertiser) {
        t += `광고주: ${selectedAdvertiser.name}\n`
      }
      if (aiResults.length > 0) {
        t += `\n[AI 생성 카피]\n`
        aiResults.forEach((r, i) => {
          t += `${i + 1}. ${r.title}: ${r.description}\n`
        })
      }
      return t.trim()
    })()

    navigator.clipboard.writeText(copyText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // AI 카피 생성
  async function generateAiCopies(extraPrompt?: string) {
    // 기존 결과가 있으면 히스토리에 저장
    if (aiResults.length > 0) {
      setCopyHistory(prev => [{
        id: Date.now().toString(),
        timestamp: new Date(),
        mediaType: formData.media_type,
        copies: aiResults
      }, ...prev])
    }
    
    setAiLoading(true)
    setAiResults([])
    setStreamText('')
    setShowAiPanel(true)

    try {
      const res = await fetch('/api/ai/plans/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mediaType: formData.media_type,
          advertiserName: selectedAdvertiser?.name,
          advertiser: selectedAdvertiser ? {
            guidelines_image: selectedAdvertiser.guidelines_image,
            guidelines_video: selectedAdvertiser.guidelines_video,
            products: selectedAdvertiser.products,
            appeals: selectedAdvertiser.appeals,
            cautions: selectedAdvertiser.cautions,
          } : null,
          extraPrompt: extraPrompt || customPrompt || undefined,
        }),
      })

      if (!res.ok) {
        throw new Error('API 오류')
      }

      const reader = res.body?.getReader()
      if (!reader) throw new Error('스트림 읽기 불가')

      const decoder = new TextDecoder()
      let buffer = ''
      let fullText = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        
        buffer += decoder.decode(value, { stream: true })
        const events = buffer.split('\n\n')
        buffer = events.pop() ?? ''

        for (const event of events) {
          const dataLine = event.split('\n').find(l => l.startsWith('data: '))
          if (!dataLine) continue
          try {
            const data = JSON.parse(dataLine.slice(6))
            if (data.text) {
              fullText += data.text
              setStreamText(fullText)
            }
            if (data.done) {
              const lines = fullText.split('\n').filter(l => l.trim())
              const results: { title: string; description: string }[] = []
              for (const line of lines) {
                const match = line.match(/^\d+\.\s*(.+?):\s*(.+)$/)
                if (match) {
                  results.push({ title: match[1].trim(), description: match[2].trim() })
                }
              }
              setAiResults(results)
            }
          } catch {
            // ignore
          }
        }
      }
    } catch (error) {
      console.error('AI 생성 실패:', error)
      alert('AI 카피 생성에 실패했습니다.')
    } finally {
      setAiLoading(false)
    }
  }

  function removeFromHistory(historyId: string) {
    setCopyHistory(prev => prev.filter(h => h.id !== historyId))
  }

  function restoreFromHistory(history: CopySet) {
    // 현재 결과를 히스토리로 이동
    if (aiResults.length > 0) {
      setCopyHistory(prev => [{
        id: Date.now().toString(),
        timestamp: new Date(),
        mediaType: formData.media_type,
        copies: aiResults
      }, ...prev.filter(h => h.id !== history.id)])
    } else {
      setCopyHistory(prev => prev.filter(h => h.id !== history.id))
    }
    setAiResults(history.copies)
    setShowAiPanel(true)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">로딩 중...</p>
      </div>
    )
  }

  if (!plan) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">기획서를 찾을 수 없습니다.</p>
      </div>
    )
  }

  return (
    <div className="flex gap-6 pb-24">
      {/* 왼쪽: AI 도우미 */}
      <div className="w-72 flex-shrink-0 space-y-4">
        <Card className="border-amber-200 bg-amber-50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-amber-800 flex items-center gap-2">
              <Lightbulb className="h-4 w-4" />
              AI 도우미
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label className="text-xs text-amber-700">추가 요청사항</Label>
              <Textarea
                rows={3}
                placeholder="예: 젊은 층 타겟, 유머러스하게..."
                className="text-sm"
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-amber-700">빠른 스타일</Label>
              <div className="grid grid-cols-2 gap-2">
                <Button 
                  type="button" 
                  variant="outline" 
                  size="sm" 
                  className="text-xs"
                  onClick={() => generateAiCopies('감성적이고 따뜻한 톤으로')}
                  disabled={aiLoading}
                >
                  <MessageSquare className="h-3 w-3 mr-1" />
                  감성적
                </Button>
                <Button 
                  type="button" 
                  variant="outline" 
                  size="sm" 
                  className="text-xs"
                  onClick={() => generateAiCopies('직접적이고 강렬한 톤으로')}
                  disabled={aiLoading}
                >
                  <Zap className="h-3 w-3 mr-1" />
                  강렬한
                </Button>
                <Button 
                  type="button" 
                  variant="outline" 
                  size="sm" 
                  className="text-xs"
                  onClick={() => generateAiCopies('유머러스하고 재치있게')}
                  disabled={aiLoading}
                >
                  😄 유머
                </Button>
                <Button 
                  type="button" 
                  variant="outline" 
                  size="sm" 
                  className="text-xs"
                  onClick={() => generateAiCopies('고급스럽고 프리미엄 느낌으로')}
                  disabled={aiLoading}
                >
                  ✨ 프리미엄
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-emerald-200 bg-emerald-50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-emerald-800 flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              카피 팁
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-emerald-700 space-y-2">
            <p>• 메인 카피는 15자 이내가 좋아요</p>
            <p>• 숫자를 넣으면 신뢰도 UP</p>
            <p>• 질문형은 클릭률이 높아요</p>
            <p>• 이모지는 적절히 사용하세요</p>
            <p>• CTA는 명확한 행동 유도</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              추천 키워드
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-1">
              {['한정', '무료', '지금', '단독', '특가', '신상', 'BEST', '인기'].map(kw => (
                <span key={kw} className="text-xs bg-gray-100 px-2 py-1 rounded cursor-pointer hover:bg-gray-200"
                  onClick={() => setCustomPrompt(prev => prev ? `${prev}, ${kw} 키워드 포함` : `${kw} 키워드 포함`)}
                >
                  {kw}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 중앙: 기본 정보 + 현재 AI 결과 */}
      <div className="flex-1 min-w-0 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/plans">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div>
              <div className="flex items-center gap-2">
                {plan.media_type === 'video' ? (
                  <Video className="h-6 w-6 text-purple-500" />
                ) : (
                  <Image className="h-6 w-6 text-blue-500" />
                )}
                <h1 className="text-2xl font-bold">{plan.title}</h1>
              </div>
              <p className="text-muted-foreground text-sm mt-1">
                작성일: {new Date(plan.created_at).toLocaleDateString('ko-KR')}
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => copyToClipboard()}>
            {copied ? <><Check className="mr-1 h-3 w-3" />복사됨</> : <><Copy className="mr-1 h-3 w-3" />복사</>}
          </Button>
        </div>

        <form onSubmit={handleSubmit}>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">기본 정보</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="title" className="text-sm">기획서 제목 *</Label>
                <Input
                  id="title"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="advertiser" className="text-sm">광고주</Label>
                  <Select
                    id="advertiser"
                    value={formData.advertiser_id}
                    onChange={(e) => handleAdvertiserChange(e.target.value)}
                  >
                    <option value="">광고주 선택</option>
                    {advertisers.map((advertiser) => (
                      <option key={advertiser.id} value={advertiser.id}>
                        {advertiser.name}
                      </option>
                    ))}
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="media_type" className="text-sm">소재 유형</Label>
                  <Select
                    id="media_type"
                    value={formData.media_type}
                    onChange={(e) => setFormData({ ...formData, media_type: e.target.value as 'image' | 'video' })}
                  >
                    <option value="image">이미지</option>
                    <option value="video">영상</option>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          {selectedAdvertiser && (
            <Card className="mt-4 border-blue-200 bg-blue-50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-blue-800">
                  {selectedAdvertiser.name} 정보
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-xs">
                {selectedAdvertiser.products && selectedAdvertiser.products.length > 0 && (
                  <div><span className="text-blue-700 font-medium">제품: </span><span className="text-blue-900">{selectedAdvertiser.products.join(', ')}</span></div>
                )}
                {selectedAdvertiser.appeals && selectedAdvertiser.appeals.length > 0 && (
                  <div><span className="text-blue-700 font-medium">소구점: </span><span className="text-blue-900">{selectedAdvertiser.appeals.join(', ')}</span></div>
                )}
              </CardContent>
            </Card>
          )}

          <div className="flex justify-end gap-2 mt-4">
            <Link href="/plans">
              <Button type="button" variant="outline" size="sm">취소</Button>
            </Link>
            <Button type="submit" size="sm" disabled={saving}>
              <Save className="mr-1 h-3 w-3" />
              {saving ? '저장 중...' : '저장'}
            </Button>
          </div>
        </form>

        {/* AI 생성 결과 패널 */}
        {showAiPanel && (
          <Card className="border-purple-200 bg-purple-50">
            <CardHeader className="pb-2">
              <CardTitle className="text-base text-purple-800 flex items-center gap-2">
                <Sparkles className="h-4 w-4" />
                AI 생성 카피 ({formData.media_type === 'image' ? '이미지' : '영상'})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {aiLoading ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-purple-700 text-sm">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>카피 생성 중...</span>
                  </div>
                  <pre className="whitespace-pre-wrap text-xs text-purple-900 bg-white/50 p-3 rounded">
                    {streamText || '...'}
                  </pre>
                </div>
              ) : aiResults.length > 0 ? (
                <div className="space-y-2">
                  {aiResults.map((result, index) => (
                    <div key={index} className="bg-white p-3 rounded-lg shadow-sm border border-purple-100 group">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="font-medium text-purple-800 text-sm">{index + 1}. {result.title}</div>
                          <div className="text-xs text-gray-600 mt-1">{result.description}</div>
                        </div>
                        <Button 
                          type="button" 
                          variant="ghost" 
                          size="sm" 
                          className="opacity-0 group-hover:opacity-100 h-6 w-6 p-0"
                          onClick={() => copyToClipboard(`${result.title}: ${result.description}`)}
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-purple-700 text-sm">생성된 카피가 없습니다.</p>
              )}
            </CardContent>
          </Card>
        )}

        {/* 하단 중앙 플로팅 버튼 */}
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
          <Button
            type="button"
            size="lg"
            className="shadow-lg px-8 py-6 text-lg bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
            onClick={() => generateAiCopies()}
            disabled={aiLoading}
          >
            {aiLoading ? (
              <><Loader2 className="mr-2 h-5 w-5 animate-spin" />생성 중...</>
            ) : (
              <><Sparkles className="mr-2 h-5 w-5" />AI 카피 6개 생성</>
            )}
          </Button>
        </div>
      </div>

      {/* 오른쪽: 카피 히스토리 */}
      <div className="w-72 flex-shrink-0 space-y-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <History className="h-4 w-4" />
              카피 히스토리
              {copyHistory.length > 0 && (
                <span className="text-xs bg-gray-200 px-2 py-0.5 rounded-full">{copyHistory.length}</span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {copyHistory.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                AI 카피를 여러 번 생성하면 이전 결과가 여기에 저장됩니다.
              </p>
            ) : (
              <div className="space-y-3 max-h-[calc(100vh-300px)] overflow-y-auto">
                {copyHistory.map((history) => (
                  <div key={history.id} className="border rounded-lg p-2 bg-gray-50 hover:bg-gray-100 transition-colors">
                    <div className="flex items-center justify-between mb-2">
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        history.mediaType === 'image' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
                      }`}>
                        {history.mediaType === 'image' ? '이미지' : '영상'}
                      </span>
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-muted-foreground">
                          {history.timestamp.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-5 w-5 p-0"
                          onClick={() => removeFromHistory(history.id)}
                        >
                          <Trash2 className="h-3 w-3 text-gray-400 hover:text-red-500" />
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-1">
                      {history.copies.slice(0, 2).map((copy, i) => (
                        <div key={i} className="text-xs text-gray-600 line-clamp-1">
                          {i + 1}. {copy.title}
                        </div>
                      ))}
                      {history.copies.length > 2 && (
                        <div className="text-xs text-muted-foreground">
                          +{history.copies.length - 2}개 더...
                        </div>
                      )}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full mt-2 text-xs h-7"
                      onClick={() => restoreFromHistory(history)}
                    >
                      불러오기
                    </Button>
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
