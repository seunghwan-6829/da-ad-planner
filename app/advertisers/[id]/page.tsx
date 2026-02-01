'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { ArrowLeft, Save } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { getAdvertiser, updateAdvertiser } from '@/lib/api/advertisers'
import { Advertiser } from '@/lib/supabase'

export default function AdvertiserDetailPage() {
  const router = useRouter()
  const params = useParams()
  const id = params.id as string

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [advertiser, setAdvertiser] = useState<Advertiser | null>(null)
  const [formData, setFormData] = useState({
    name: '',
    brand_color: '',
    brand_font: '',
    tone_manner: '',
    forbidden_words: '',
    required_phrases: '',
    guidelines: '',
  })

  useEffect(() => {
    loadAdvertiser()
  }, [id])

  async function loadAdvertiser() {
    try {
      const data = await getAdvertiser(id)
      setAdvertiser(data)
      setFormData({
        name: data.name,
        brand_color: data.brand_color || '#3B82F6',
        brand_font: data.brand_font || '',
        tone_manner: data.tone_manner || '',
        forbidden_words: data.forbidden_words?.join(', ') || '',
        required_phrases: data.required_phrases?.join(', ') || '',
        guidelines: data.guidelines || '',
      })
    } catch (error) {
      console.error('광고주 로드 실패:', error)
      router.push('/advertisers')
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    
    if (!formData.name.trim()) {
      alert('광고주명을 입력해주세요.')
      return
    }

    setSaving(true)
    try {
      await updateAdvertiser(id, {
        name: formData.name,
        brand_color: formData.brand_color || null,
        brand_font: formData.brand_font || null,
        tone_manner: formData.tone_manner || null,
        forbidden_words: formData.forbidden_words 
          ? formData.forbidden_words.split(',').map(w => w.trim()).filter(Boolean)
          : null,
        required_phrases: formData.required_phrases
          ? formData.required_phrases.split(',').map(w => w.trim()).filter(Boolean)
          : null,
        guidelines: formData.guidelines || null,
      })
      alert('저장되었습니다.')
    } catch (error) {
      console.error('저장 실패:', error)
      alert('저장에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">로딩 중...</p>
      </div>
    )
  }

  if (!advertiser) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">광고주를 찾을 수 없습니다.</p>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/advertisers">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-3xl font-bold">{advertiser.name}</h1>
          <p className="text-muted-foreground mt-1">
            브랜드 가이드라인 수정
          </p>
        </div>
        <Badge variant="secondary">
          등록일: {new Date(advertiser.created_at).toLocaleDateString('ko-KR')}
        </Badge>
      </div>

      <form onSubmit={handleSubmit}>
        <Card>
          <CardHeader>
            <CardTitle>기본 정보</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">광고주명 *</Label>
              <Input
                id="name"
                placeholder="예: ABC 화장품"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="brand_color">브랜드 컬러</Label>
                <div className="flex gap-2">
                  <Input
                    type="color"
                    id="brand_color"
                    className="w-16 h-10 p-1"
                    value={formData.brand_color}
                    onChange={(e) => setFormData({ ...formData, brand_color: e.target.value })}
                  />
                  <Input
                    value={formData.brand_color}
                    onChange={(e) => setFormData({ ...formData, brand_color: e.target.value })}
                    placeholder="#3B82F6"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="brand_font">브랜드 폰트</Label>
                <Input
                  id="brand_font"
                  placeholder="예: Pretendard, Noto Sans KR"
                  value={formData.brand_font}
                  onChange={(e) => setFormData({ ...formData, brand_font: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="tone_manner">톤앤매너</Label>
              <Textarea
                id="tone_manner"
                placeholder="예: 친근하고 따뜻한 톤, 전문적이면서도 쉬운 설명"
                value={formData.tone_manner}
                onChange={(e) => setFormData({ ...formData, tone_manner: e.target.value })}
              />
            </div>
          </CardContent>
        </Card>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle>카피라이팅 가이드</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="forbidden_words">금지어 (쉼표로 구분)</Label>
              <Input
                id="forbidden_words"
                placeholder="예: 최고, 1등, 완벽"
                value={formData.forbidden_words}
                onChange={(e) => setFormData({ ...formData, forbidden_words: e.target.value })}
              />
              {formData.forbidden_words && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {formData.forbidden_words.split(',').map((word, i) => (
                    word.trim() && (
                      <Badge key={i} variant="destructive" className="text-xs">
                        {word.trim()}
                      </Badge>
                    )
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="required_phrases">필수 문구 (쉼표로 구분)</Label>
              <Input
                id="required_phrases"
                placeholder="예: 공식 온라인몰, 무료배송"
                value={formData.required_phrases}
                onChange={(e) => setFormData({ ...formData, required_phrases: e.target.value })}
              />
              {formData.required_phrases && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {formData.required_phrases.split(',').map((phrase, i) => (
                    phrase.trim() && (
                      <Badge key={i} variant="success" className="text-xs">
                        {phrase.trim()}
                      </Badge>
                    )
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="guidelines">상세 가이드라인</Label>
              <Textarea
                id="guidelines"
                rows={6}
                placeholder="광고 소재 제작 시 참고할 상세 가이드라인을 입력하세요..."
                value={formData.guidelines}
                onChange={(e) => setFormData({ ...formData, guidelines: e.target.value })}
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-3 mt-6">
          <Link href="/advertisers">
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
