'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { ArrowLeft, Save, Image, Video, Copy, Check } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { getPlan, updatePlan } from '@/lib/api/plans'
import { getAdvertisers } from '@/lib/api/advertisers'
import { AdPlan, Advertiser } from '@/lib/supabase'

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
        size: planData.size || '',
        concept: planData.concept || '',
        main_copy: planData.main_copy || '',
        sub_copy: planData.sub_copy || '',
        cta_text: planData.cta_text || '',
        notes: planData.notes || '',
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
        size: formData.size || null,
        concept: formData.concept || null,
        main_copy: formData.main_copy || null,
        sub_copy: formData.sub_copy || null,
        cta_text: formData.cta_text || null,
        notes: formData.notes || null,
      })
      alert('저장되었습니다.')
    } catch (error) {
      console.error('저장 실패:', error)
      alert('저장에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  function copyToClipboard() {
    const text = `
[광고 기획서: ${formData.title}]

소재 유형: ${formData.media_type === 'image' ? '이미지' : '영상'}
사이즈: ${formData.size || '-'}

[컨셉]
${formData.concept || '-'}

[카피]
메인: ${formData.main_copy || '-'}
서브: ${formData.sub_copy || '-'}
CTA: ${formData.cta_text || '-'}

[메모]
${formData.notes || '-'}
    `.trim()

    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
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
    <div className="max-w-3xl mx-auto space-y-6">
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
              <h1 className="text-3xl font-bold">{plan.title}</h1>
            </div>
            <p className="text-muted-foreground mt-1">
              작성일: {new Date(plan.created_at).toLocaleDateString('ko-KR')}
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={copyToClipboard}>
          {copied ? (
            <>
              <Check className="mr-2 h-4 w-4" />
              복사됨
            </>
          ) : (
            <>
              <Copy className="mr-2 h-4 w-4" />
              텍스트 복사
            </>
          )}
        </Button>
      </div>

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
                value={formData.concept}
                onChange={(e) => setFormData({ ...formData, concept: e.target.value })}
              />
            </div>
          </CardContent>
        </Card>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle>카피라이팅</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="main_copy">메인 카피</Label>
              <Input
                id="main_copy"
                value={formData.main_copy}
                onChange={(e) => setFormData({ ...formData, main_copy: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="sub_copy">서브 카피</Label>
              <Textarea
                id="sub_copy"
                value={formData.sub_copy}
                onChange={(e) => setFormData({ ...formData, sub_copy: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="cta_text">CTA</Label>
              <Input
                id="cta_text"
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
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
            />
          </CardContent>
        </Card>

        <div className="flex justify-end gap-3 mt-6">
          <Link href="/plans">
            <Button type="button" variant="outline">취소</Button>
          </Link>
          <Button type="submit" disabled={saving}>
            <Save className="mr-2 h-4 w-4" />
            {saving ? '저장 중...' : '변경사항 저장'}
          </Button>
        </div>
      </form>
    </div>
  )
}
