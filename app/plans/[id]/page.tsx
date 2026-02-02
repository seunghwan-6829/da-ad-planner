'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { ArrowLeft, Save, Image, Video, Copy, Check, Sparkles, Loader2, History, Trash2, RefreshCw, Search, Link2, Plus, Minus, FileText } from 'lucide-react'
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

interface CopyItem {
  title: string
  description: string
  review?: {
    good: string
    bad: string
    suggestion: string
    revised: string
  }
}

interface CopySet {
  id: string
  timestamp: Date
  mediaType: 'image' | 'video'
  copies: CopyItem[]
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
  const [aiResults, setAiResults] = useState<CopyItem[]>([])
  const [streamText, setStreamText] = useState('')
  const [showAiPanel, setShowAiPanel] = useState(false)
  
  // 검토 상태
  const [reviewingIndex, setReviewingIndex] = useState<number | null>(null)
  const [reviewModalOpen, setReviewModalOpen] = useState(false)
  const [reviewModalData, setReviewModalData] = useState<{
    index: number
    original: CopyItem
    review: { good: string; bad: string; suggestion: string; revised: string }
  } | null>(null)
  
  // 베리에이션 상태
  const [variationIndex, setVariationIndex] = useState<number | null>(null)
  const [variationResults, setVariationResults] = useState<CopyItem[]>([])
  const [variationLoading, setVariationLoading] = useState(false)
  
  // 카피 히스토리
  const [copyHistory, setCopyHistory] = useState<CopySet[]>([])
  
  // 왼쪽 입력 섹션
  const [referenceLinks, setReferenceLinks] = useState<string[]>([''])
  const [ctaTexts, setCtaTexts] = useState<string[]>([''])
  const [tdTitle, setTdTitle] = useState('')
  const [tdDescription, setTdDescription] = useState('')
  const [customPrompt, setCustomPrompt] = useState('')  // 추가 입력란
  
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

      // 새 필드들 불러오기
      setReferenceLinks(planData.reference_links?.length ? planData.reference_links : [''])
      setCtaTexts(planData.cta_texts?.length ? planData.cta_texts : [''])
      setTdTitle(planData.td_title || '')
      setTdDescription(planData.td_description || '')
      setCustomPrompt(planData.custom_prompt || '')
      
      // 카피 히스토리 불러오기
      if (planData.copy_history) {
        try {
          const parsed = JSON.parse(planData.copy_history)
          setCopyHistory(parsed.map((h: CopySet) => ({
            ...h,
            timestamp: new Date(h.timestamp)
          })))
        } catch { /* ignore */ }
      }

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
      // 필터링된 배열들
      const validRefs = referenceLinks.filter(r => r.trim())
      const validCtas = ctaTexts.filter(c => c.trim())
      
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
        reference_links: validRefs.length ? validRefs : null,
        cta_texts: validCtas.length ? validCtas : null,
        td_title: tdTitle || null,
        td_description: tdDescription || null,
        copy_history: copyHistory.length ? JSON.stringify(copyHistory) : null,
        custom_prompt: customPrompt || null,
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
  async function generateAiCopies() {
    setAiLoading(true)
    setAiResults([])
    setStreamText('')
    setShowAiPanel(true)
    setVariationIndex(null)
    setVariationResults([])

    // 추가 컨텍스트 구성
    let extraContext = ''
    
    // 사용자 커스텀 프롬프트 (가장 먼저 반영)
    if (customPrompt.trim()) {
      extraContext += `[사용자 추가 요청사항 - 최우선 반영]\n${customPrompt.trim()}\n\n`
    }
    
    const validCtas = ctaTexts.filter(c => c.trim())
    if (validCtas.length > 0) {
      extraContext += `CTA 문구 참고: ${validCtas.join(', ')}\n`
    }
    if (tdTitle.trim()) {
      extraContext += `T&D 제목: ${tdTitle.trim()}\n`
    }
    if (tdDescription.trim()) {
      extraContext += `T&D 설명: ${tdDescription.trim()}\n`
    }

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
          extraPrompt: extraContext || undefined,
        }),
      })

      if (!res.ok) throw new Error('API 오류')

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
              const results: CopyItem[] = []
              
              if (formData.media_type === 'video') {
                // 영상 대본 파싱: [대본 N] 또는 --- 기준으로 분리
                const scripts = fullText.split(/---|\[대본\s*\d+\]/).filter(s => s.trim())
                for (const script of scripts) {
                  const trimmed = script.trim()
                  if (trimmed.length > 10) { // 최소 길이 체크
                    // 첫 번째 줄을 제목으로, 나머지를 내용으로
                    const lines = trimmed.split('\n').filter(l => l.trim())
                    if (lines.length > 0) {
                      // Scene 1의 나레이션이나 첫 줄을 제목으로
                      let title = ''
                      const narationMatch = trimmed.match(/나레이션:\s*"?([^"\n]+)"?/)
                      if (narationMatch) {
                        title = narationMatch[1].substring(0, 30) + (narationMatch[1].length > 30 ? '...' : '')
                      } else {
                        title = lines[0].replace(/Scene\s*\d+:?\s*/i, '').substring(0, 30)
                      }
                      results.push({ 
                        title: title || `대본 ${results.length + 1}`,
                        description: trimmed 
                      })
                    }
                  }
                }
              } else {
                // 이미지 카피 파싱
                const lines = fullText.split('\n').filter(l => l.trim())
                for (const line of lines) {
                  const match = line.match(/^\d+\.\s*(.+?):\s*(.+)$/)
                  if (match) {
                    results.push({ title: match[1].trim(), description: match[2].trim() })
                  }
                }
              }
              
              setAiResults(results)
              // 생성되면 바로 히스토리에 추가
              if (results.length > 0) {
                setCopyHistory(prev => [{
                  id: Date.now().toString(),
                  timestamp: new Date(),
                  mediaType: formData.media_type,
                  copies: results
                }, ...prev])
              }
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

  // 검토 기능
  async function reviewCopy(index: number) {
    const copy = aiResults[index]
    if (!copy) return
    
    setReviewingIndex(index)
    
    try {
      const res = await fetch('/api/ai/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          copy: formData.media_type === 'video' ? copy.description : `${copy.title}: ${copy.description}`,
          advertiserName: selectedAdvertiser?.name,
          mediaType: formData.media_type,
        }),
      })
      
      if (!res.ok) throw new Error('API 오류')
      
      const data = await res.json()
      
      // 모달로 표시
      setReviewModalData({
        index,
        original: copy,
        review: data
      })
      setReviewModalOpen(true)
    } catch (error) {
      console.error('검토 실패:', error)
      alert('검토에 실패했습니다.')
    } finally {
      setReviewingIndex(null)
    }
  }

  // 검토 결과 저장 (수정본으로 교체)
  function saveReview() {
    if (!reviewModalData) return
    
    const { index, review } = reviewModalData
    
    setAiResults(prev => {
      const updated = [...prev]
      // 수정본으로 교체
      if (formData.media_type === 'video') {
        // 영상: description 전체를 수정본으로
        updated[index] = {
          ...updated[index],
          description: review.revised,
          review: review
        }
      } else {
        // 이미지: 메인카피: 서브카피 형식 파싱
        const match = review.revised.match(/^(.+?):\s*(.+)$/)
        if (match) {
          updated[index] = {
            title: match[1].trim(),
            description: match[2].trim(),
            review: review
          }
        } else {
          updated[index] = { ...updated[index], description: review.revised, review: review }
        }
      }
      return updated
    })
    
    setReviewModalOpen(false)
    setReviewModalData(null)
  }

  // 검토 취소
  function cancelReview() {
    setReviewModalOpen(false)
    setReviewModalData(null)
  }

  // 베리에이션 기능
  async function generateVariation(index: number) {
    const copy = aiResults[index]
    if (!copy) return
    
    // 검토된 수정본이 있으면 그걸로, 없으면 원본으로
    const baseCopy = copy.review?.revised 
      ? copy.review.revised 
      : `${copy.title}: ${copy.description}`
    
    setVariationIndex(index)
    setVariationLoading(true)
    setVariationResults([])
    
    try {
      const res = await fetch('/api/ai/variation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseCopy,
          advertiserName: selectedAdvertiser?.name,
          mediaType: formData.media_type,
          advertiser: selectedAdvertiser ? {
            guidelines_image: selectedAdvertiser.guidelines_image,
            guidelines_video: selectedAdvertiser.guidelines_video,
            products: selectedAdvertiser.products,
            appeals: selectedAdvertiser.appeals,
            cautions: selectedAdvertiser.cautions,
          } : null,
        }),
      })
      
      if (!res.ok) throw new Error('API 오류')
      
      const data = await res.json()
      setVariationResults(data.variations || [])
    } catch (error) {
      console.error('베리에이션 실패:', error)
      alert('베리에이션 생성에 실패했습니다.')
    } finally {
      setVariationLoading(false)
    }
  }

  function removeFromHistory(historyId: string) {
    setCopyHistory(prev => prev.filter(h => h.id !== historyId))
  }

  function restoreFromHistory(history: CopySet) {
    setAiResults(history.copies)
    setShowAiPanel(true)
    setVariationIndex(null)
    setVariationResults([])
  }

  // 링크/CTA 관련 함수
  function updateReferenceLink(index: number, value: string) {
    setReferenceLinks(prev => {
      const next = [...prev]
      next[index] = value
      return next
    })
  }
  function addReferenceLink() {
    setReferenceLinks(prev => [...prev, ''])
  }
  function removeReferenceLink(index: number) {
    setReferenceLinks(prev => prev.length > 1 ? prev.filter((_, i) => i !== index) : [''])
  }

  function updateCtaText(index: number, value: string) {
    setCtaTexts(prev => {
      const next = [...prev]
      next[index] = value
      return next
    })
  }
  function addCtaText() {
    setCtaTexts(prev => [...prev, ''])
  }
  function removeCtaText(index: number) {
    setCtaTexts(prev => prev.length > 1 ? prev.filter((_, i) => i !== index) : [''])
  }

  // URL 임베드 가능 여부 체크 (YouTube, 이미지 등)
  function getEmbedType(url: string): 'youtube' | 'image' | 'none' {
    if (!url.trim()) return 'none'
    if (url.includes('youtube.com') || url.includes('youtu.be')) return 'youtube'
    if (/\.(jpg|jpeg|png|gif|webp)$/i.test(url)) return 'image'
    return 'none'
  }

  function getYoutubeEmbedUrl(url: string): string {
    const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/)
    return match ? `https://www.youtube.com/embed/${match[1]}` : ''
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
      {/* 왼쪽: 레퍼런스, CTA, T&D */}
      <div className="w-72 flex-shrink-0 space-y-4">
        {/* 레퍼런스 링크 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Link2 className="h-4 w-4" />
              레퍼런스 링크
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {referenceLinks.map((link, index) => (
              <div key={index} className="space-y-1">
                <div className="flex items-center gap-1">
                  <Input
                    placeholder="https://..."
                    value={link}
                    onChange={(e) => updateReferenceLink(index, e.target.value)}
                    className="text-xs"
                  />
                  <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => removeReferenceLink(index)}>
                    <Minus className="h-3 w-3" />
                  </Button>
                  {index === referenceLinks.length - 1 && (
                    <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={addReferenceLink}>
                      <Plus className="h-3 w-3" />
                    </Button>
                  )}
                </div>
                {/* 임베드 미리보기 */}
                {getEmbedType(link) === 'youtube' && (
                  <div className="rounded overflow-hidden">
                    <iframe
                      src={getYoutubeEmbedUrl(link)}
                      className="w-full h-32"
                      allowFullScreen
                    />
                  </div>
                )}
                {getEmbedType(link) === 'image' && (
                  <img src={link} alt="레퍼런스" className="w-full rounded" />
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        {/* CTA 문구 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">CTA 문구</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {ctaTexts.map((cta, index) => (
              <div key={index} className="flex items-center gap-1">
                <Input
                  placeholder="예: 지금 구매하기"
                  value={cta}
                  onChange={(e) => updateCtaText(index, e.target.value)}
                  className="text-xs"
                />
                <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => removeCtaText(index)}>
                  <Minus className="h-3 w-3" />
                </Button>
                {index === ctaTexts.length - 1 && (
                  <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={addCtaText}>
                    <Plus className="h-3 w-3" />
                  </Button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        {/* T&D (제목/설명) */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <FileText className="h-4 w-4" />
              T&D (제목/설명)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div>
              <Label className="text-xs">제목</Label>
              <Input
                placeholder="광고 제목"
                value={tdTitle}
                onChange={(e) => setTdTitle(e.target.value)}
                className="text-xs"
              />
            </div>
            <div>
              <Label className="text-xs">설명</Label>
              <Textarea
                placeholder="광고 설명"
                rows={3}
                value={tdDescription}
                onChange={(e) => setTdDescription(e.target.value)}
                className="text-xs"
              />
            </div>
          </CardContent>
        </Card>

        {/* 추가 요청사항 (선택) */}
        <Card className="border-amber-200 bg-amber-50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-amber-800 flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              AI 추가 요청 (선택)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea
              placeholder="AI가 카피 작성 시 추가로 참고할 내용을 적어주세요.&#10;&#10;예: 20대 여성 타겟, 감성적인 톤으로, 이모지 사용해줘...&#10;&#10;※ 지침서 확인 후 이 내용을 2순위로 반영합니다."
              rows={4}
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              className="text-xs"
            />
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

        {/* AI 생성 결과 패널 - 2x3 그리드 */}
        {showAiPanel && (
          <Card className="border-purple-200 bg-purple-50">
            <CardHeader className="pb-2">
              <CardTitle className="text-base text-purple-800 flex items-center gap-2">
                <Sparkles className="h-4 w-4" />
                AI 생성 {formData.media_type === 'image' ? '카피 (이미지)' : '대본 (영상)'}
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
                <div className="grid grid-cols-2 gap-3">
                  {aiResults.map((result, index) => (
                    <div key={index} className="bg-white p-3 rounded-lg shadow-sm border border-purple-100">
                      <div className="flex items-start justify-between mb-2">
                        <div className="font-medium text-purple-800 text-sm">{index + 1}. {result.title}</div>
                        <Button 
                          type="button" 
                          variant="ghost" 
                          size="sm" 
                          className="h-6 w-6 p-0"
                          onClick={() => copyToClipboard(formData.media_type === 'video' ? result.description : `${result.title}: ${result.description}`)}
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>
                      {formData.media_type === 'video' ? (
                        <pre className="text-xs text-gray-600 mb-3 whitespace-pre-wrap bg-gray-50 p-2 rounded max-h-64 overflow-y-auto">{result.description}</pre>
                      ) : (
                        <div className="text-xs text-gray-600 mb-3">{result.description}</div>
                      )}
                      
                      {/* 검토 완료 표시 */}
                      {result.review && (
                        <div className="mt-2 text-xs text-green-600 flex items-center gap-1">
                          <Check className="h-3 w-3" />
                          검토 완료 (수정됨)
                        </div>
                      )}
                      
                      {/* 버튼들 */}
                      <div className="flex gap-2 mt-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="text-xs flex-1"
                          onClick={() => reviewCopy(index)}
                          disabled={reviewingIndex === index}
                        >
                          {reviewingIndex === index ? (
                            <Loader2 className="h-3 w-3 animate-spin mr-1" />
                          ) : (
                            <Search className="h-3 w-3 mr-1" />
                          )}
                          검토
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="text-xs flex-1"
                          onClick={() => generateVariation(index)}
                          disabled={variationLoading && variationIndex === index}
                        >
                          {variationLoading && variationIndex === index ? (
                            <Loader2 className="h-3 w-3 animate-spin mr-1" />
                          ) : (
                            <RefreshCw className="h-3 w-3 mr-1" />
                          )}
                          베리에이션
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

        {/* 베리에이션 결과 */}
        {variationIndex !== null && variationResults.length > 0 && (
          <Card className="border-amber-200 bg-amber-50">
            <CardHeader className="pb-2">
              <CardTitle className="text-base text-amber-800 flex items-center gap-2">
                <RefreshCw className="h-4 w-4" />
                베리에이션 (#{variationIndex + 1} 기반)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3">
                {variationResults.map((result, index) => (
                  <div key={index} className="bg-white p-3 rounded-lg shadow-sm border border-amber-100">
                    <div className="flex items-start justify-between">
                      <div className="font-medium text-amber-800 text-sm">{index + 1}. {result.title}</div>
                      <Button 
                        type="button" 
                        variant="ghost" 
                        size="sm" 
                        className="h-6 w-6 p-0"
                        onClick={() => copyToClipboard(`${result.title}: ${result.description}`)}
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                    <div className="text-xs text-gray-600 mt-1">{result.description}</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* 하단 중앙 플로팅 버튼 */}
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
          <Button
            type="button"
            size="lg"
            className="shadow-lg px-8 py-6 text-lg bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
            onClick={generateAiCopies}
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
                AI 카피를 생성하면 여기에 저장됩니다.
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

      {/* 검토 모달 */}
      {reviewModalOpen && reviewModalData && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
            {/* 헤더 */}
            <div className="px-6 py-4 border-b bg-gray-50">
              <h3 className="text-lg font-semibold">
                카피 검토 - {reviewModalData.index + 1}번 {formData.media_type === 'video' ? '대본' : '카피'}
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                왼쪽은 원본, 오른쪽은 AI 수정본입니다. 저장하면 수정본으로 교체됩니다.
              </p>
            </div>

            {/* 본문 */}
            <div className="flex-1 overflow-auto p-6">
              {/* 검토 요약 */}
              <div className="grid grid-cols-3 gap-3 mb-6">
                <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                  <div className="text-xs font-medium text-green-700 mb-1">👍 좋은 점</div>
                  <p className="text-sm text-green-800">{reviewModalData.review.good}</p>
                </div>
                <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                  <div className="text-xs font-medium text-red-700 mb-1">👎 아쉬운 점</div>
                  <p className="text-sm text-red-800">{reviewModalData.review.bad}</p>
                </div>
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <div className="text-xs font-medium text-blue-700 mb-1">💡 수정 제안</div>
                  <p className="text-sm text-blue-800">{reviewModalData.review.suggestion}</p>
                </div>
              </div>

              {/* 원본 vs 수정본 비교 */}
              <div className="grid grid-cols-2 gap-4">
                {/* 원본 */}
                <div className="border rounded-lg overflow-hidden">
                  <div className="bg-gray-100 px-4 py-2 border-b">
                    <span className="font-medium text-sm">원본</span>
                  </div>
                  <div className="p-4">
                    {formData.media_type === 'video' ? (
                      <pre className="whitespace-pre-wrap text-sm text-gray-700 bg-gray-50 p-3 rounded max-h-80 overflow-y-auto">
                        {reviewModalData.original.description}
                      </pre>
                    ) : (
                      <div>
                        <div className="font-medium text-purple-700 mb-2">{reviewModalData.original.title}</div>
                        <div className="text-gray-600">{reviewModalData.original.description}</div>
                      </div>
                    )}
                  </div>
                </div>

                {/* 수정본 */}
                <div className="border-2 border-purple-300 rounded-lg overflow-hidden">
                  <div className="bg-purple-100 px-4 py-2 border-b border-purple-200">
                    <span className="font-medium text-sm text-purple-800">✨ 수정본</span>
                  </div>
                  <div className="p-4">
                    {formData.media_type === 'video' ? (
                      <pre className="whitespace-pre-wrap text-sm text-gray-700 bg-purple-50 p-3 rounded max-h-80 overflow-y-auto">
                        {reviewModalData.review.revised}
                      </pre>
                    ) : (
                      <div className="bg-purple-50 p-3 rounded">
                        <div className="font-medium text-purple-700">{reviewModalData.review.revised}</div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* 푸터 버튼 */}
            <div className="px-6 py-4 border-t bg-gray-50 flex justify-end gap-3">
              <Button variant="outline" onClick={cancelReview}>
                취소
              </Button>
              <Button onClick={saveReview} className="bg-purple-600 hover:bg-purple-700">
                저장 (수정본으로 교체)
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
