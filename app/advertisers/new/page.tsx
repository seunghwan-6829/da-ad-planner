'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { createAdvertiser } from '@/lib/api/advertisers'

export default function NewAdvertiserPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState({
    name: '',
    brand_color: '#3B82F6',
    brand_font: '',
    tone_manner: '',
    forbidden_words: '',
    required_phrases: '',
    guidelines: '',
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    
    if (!formData.name.trim()) {
      alert('광고주명을 입력해주세요.')
      return
    }

    setLoading(true)
    try {
      await createAdvertiser({
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
      router.push('/advertisers')
    } catch (error) {
      console.error('광고주 등록 실패:', error)
      alert('등록에 실패했습니다.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/advertisers">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold">광고주 등록</h1>
          <p className="text-muted-foreground mt-1">
            새로운 광고주와 브랜드 가이드라인을 등록합니다
          </p>
        </div>
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
            </div>

            <div className="space-y-2">
              <Label htmlFor="required_phrases">필수 문구 (쉼표로 구분)</Label>
              <Input
                id="required_phrases"
                placeholder="예: 공식 온라인몰, 무료배송"
                value={formData.required_phrases}
                onChange={(e) => setFormData({ ...formData, required_phrases: e.target.value })}
              />
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
          <Button type="submit" disabled={loading}>
            {loading ? '등록 중...' : '광고주 등록'}
          </Button>
        </div>
      </form>
    </div>
  )
}
