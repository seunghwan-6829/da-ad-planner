'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, Sparkles } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { createPlan } from '@/lib/api/plans'
import { getAdvertisers } from '@/lib/api/advertisers'
import { getTemplates } from '@/lib/api/templates'
import { Advertiser, Template } from '@/lib/supabase'

const COMMON_SIZES = [
  '1080x1080 (Instagram Square)',
  '1200x628 (Facebook Feed)',
  '1080x1920 (Story/Reels)',
  '300x250 (Medium Rectangle)',
  '728x90 (Leaderboard)',
  '160x600 (Wide Skyscraper)',
  '320x100 (Mobile Banner)',
  '1920x1080 (YouTube)',
]

function NewPlanForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const templateId = searchParams.get('template')

  const [loading, setLoading] = useState(false)
  const [advertisers, setAdvertisers] = useState<Advertiser[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [selectedAdvertiser, setSelectedAdvertiser] = useState<Advertiser | null>(null)
  
  const [formData, setFormData] = useState({
    title: '',
    advertiser_id: '',
    media_type: 'image' as 'image' | 'video',
    size: '',
    concept: '',
    main_copy: '',
    sub_copy: '',
    cta_text: '',
    notes: '',
  })

  useEffect(() => {
    loadData()
  }, [templateId])

  async function loadData() {
    try {
      const [advertisersData, templatesData] = await Promise.all([
        getAdvertisers(),
        getTemplates()
      ])
      setAdvertisers(advertisersData)
      setTemplates(templatesData)

      if (templateId) {
        const template = templatesData.find(t => t.id === templateId)
        if (template) {
          setFormData(prev => ({
            ...prev,
            media_type: (template.media_type as 'image' | 'video') || 'image',
            size: template.default_size || '',
          }))
        }
      }
    } catch (error) {
      console.error('데이터 로드 실패:', error)
    }
  }

  function handleAdvertiserChange(advertiserId: string) {
    setFormData({ ...formData, advertiser_id: advertiserId })
    const advertiser = advertisers.find(a => a.id === advertiserId)
    setSelectedAdvertiser(advertiser || null)
  }

  function applyTemplate(template: Template) {
    setFormData(prev => ({
      ...prev,
      media_type: (template.media_type as 'image' | 'video') || prev.media_type,
      size: template.default_size || prev.size,
    }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    
    if (!formData.title.trim()) {
      alert('기획서 제목을 입력해주세요.')
      return
    }

    setLoading(true)
    try {
      await createPlan({
        title: formData.title,
        advertiser_id: formData.advertiser_id || null,
        media_type: formData.media_type,
        size: formData.size || null,
        concept: formData.concept || null,
        main_copy: formData.main_copy || null,
        sub_copy: formData.sub_copy || null,
        cta_text: formData.cta_text || null,
        notes: formData.notes || null,
      })
      router.push('/plans')
    } catch (error) {
      console.error('기획서 저장 실패:', error)
      alert('저장에 실패했습니다.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/plans">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold">기획서 작성</h1>
          <p className="text-muted-foreground mt-1">
            새로운 광고 소재 기획서를 작성합니다
          </p>
        </div>
      </div>

      {templates.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              템플릿 적용
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {templates.map((template) => (
                <Button
                  key={template.id}
                  variant="outline"
                  size="sm"
                  onClick={() => applyTemplate(template)}
                >
                  {template.name}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <form onSubmit={handleSubmit}>
        <Card>
          <CardHeader>
            <CardTitle>기본 정보</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title">기획서 제목 *</Label>
              <Input
                id="title"
                placeholder="예: 2026년 봄 시즌 프로모션 소재"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="advertiser">광고주</Label>
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
                <Label htmlFor="media_type">소재 유형</Label>
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

            <div className="space-y-2">
              <Label htmlFor="size">사이즈</Label>
              <Select
                id="size"
                value={formData.size}
                onChange={(e) => setFormData({ ...formData, size: e.target.value })}
              >
                <option value="">사이즈 선택</option>
                {COMMON_SIZES.map((size) => (
                  <option key={size} value={size}>{size}</option>
                ))}
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="concept">컨셉 / 기획 의도</Label>
              <Textarea
                id="concept"
                rows={3}
                placeholder="이 소재의 컨셉과 기획 의도를 설명해주세요..."
                value={formData.concept}
                onChange={(e) => setFormData({ ...formData, concept: e.target.value })}
              />
            </div>
          </CardContent>
        </Card>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle>카피라이팅</CardTitle>
            <CardDescription>
              광고 소재에 들어갈 문구를 작성합니다
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="main_copy">메인 카피</Label>
              <Input
                id="main_copy"
                placeholder="예: 봄을 여는 특별한 할인"
                value={formData.main_copy}
                onChange={(e) => setFormData({ ...formData, main_copy: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="sub_copy">서브 카피</Label>
              <Textarea
                id="sub_copy"
                placeholder="메인 카피를 보조하는 추가 문구..."
                value={formData.sub_copy}
                onChange={(e) => setFormData({ ...formData, sub_copy: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="cta_text">CTA (Call to Action)</Label>
              <Input
                id="cta_text"
                placeholder="예: 지금 구매하기, 자세히 보기"
                value={formData.cta_text}
                onChange={(e) => setFormData({ ...formData, cta_text: e.target.value })}
              />
            </div>
          </CardContent>
        </Card>

        {selectedAdvertiser && (
          <Card className="mt-4 border-blue-200 bg-blue-50">
            <CardHeader className="pb-2">
              <CardTitle className="text-base text-blue-800">
                {selectedAdvertiser.name} 브랜드 가이드라인
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {selectedAdvertiser.tone_manner && (
                <div>
                  <span className="text-blue-700 font-medium">톤앤매너: </span>
                  <span className="text-blue-900">{selectedAdvertiser.tone_manner}</span>
                </div>
              )}
              {selectedAdvertiser.forbidden_words && selectedAdvertiser.forbidden_words.length > 0 && (
                <div>
                  <span className="text-blue-700 font-medium">금지어: </span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {selectedAdvertiser.forbidden_words.map((word, i) => (
                      <Badge key={i} variant="destructive" className="text-xs">
                        {word}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {selectedAdvertiser.required_phrases && selectedAdvertiser.required_phrases.length > 0 && (
                <div>
                  <span className="text-blue-700 font-medium">필수 문구: </span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {selectedAdvertiser.required_phrases.map((phrase, i) => (
                      <Badge key={i} variant="success" className="text-xs">
                        {phrase}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {selectedAdvertiser.guidelines && (
                <div>
                  <span className="text-blue-700 font-medium">가이드라인: </span>
                  <p className="text-blue-900 mt-1">{selectedAdvertiser.guidelines}</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Card className="mt-4">
          <CardHeader>
            <CardTitle>추가 메모</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea
              id="notes"
              rows={4}
              placeholder="디자이너/편집자에게 전달할 참고사항, 레퍼런스 링크 등..."
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
            />
          </CardContent>
        </Card>

        <div className="flex justify-end gap-3 mt-6">
          <Link href="/plans">
            <Button type="button" variant="outline">취소</Button>
          </Link>
          <Button type="submit" disabled={loading}>
            {loading ? '저장 중...' : '기획서 저장'}
          </Button>
        </div>
      </form>
    </div>
  )
}

export default function NewPlanPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64"><p>로딩 중...</p></div>}>
      <NewPlanForm />
    </Suspense>
  )
}
