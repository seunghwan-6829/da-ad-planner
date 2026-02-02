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
    guidelines: '',
    products: [''],
    appeals: [''],  // 소구점
    cautions: '',
  })

  function updateProduct(index: number, value: string) {
    setFormData((prev) => {
      const next = [...prev.products]
      next[index] = value
      return { ...prev, products: next }
    })
  }

  function addProduct() {
    setFormData((prev) => ({ ...prev, products: [...prev.products, ''] }))
  }

  function removeProduct(index: number) {
    setFormData((prev) => {
      const next = prev.products.filter((_, i) => i !== index)
      return { ...prev, products: next.length ? next : [''] }
    })
  }

  // 소구점 관련 함수
  function updateAppeal(index: number, value: string) {
    setFormData((prev) => {
      const next = [...prev.appeals]
      next[index] = value
      return { ...prev, appeals: next }
    })
  }

  function addAppeal() {
    setFormData((prev) => ({ ...prev, appeals: [...prev.appeals, ''] }))
  }

  function removeAppeal(index: number) {
    setFormData((prev) => {
      const next = prev.appeals.filter((_, i) => i !== index)
      return { ...prev, appeals: next.length ? next : [''] }
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    
    if (!formData.name.trim()) {
      alert('광고주명을 입력해주세요.')
      return
    }

    setLoading(true)
    try {
      const products = formData.products
        .map((p) => p.trim())
        .filter(Boolean)
      const appeals = formData.appeals
        .map((a) => a.trim())
        .filter(Boolean)

      await createAdvertiser({
        name: formData.name,
        guidelines: formData.guidelines || null,
        products: products.length ? products : null,
        appeals: appeals.length ? appeals : null,
        cautions: formData.cautions || null,
      })
      router.push('/advertisers')
    } catch (error) {
      console.error('광고주 등록 실패:', error)
      const msg = error instanceof Error ? error.message : ''
      const isSupabase = msg.includes('Supabase') || msg.includes('supabase') || msg.includes('PGRST')
      alert(
        isSupabase || !msg
          ? '등록에 실패했습니다. Supabase 연동을 확인해주세요.\n\n1) .env.local에 NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY 설정\n2) Supabase SQL Editor에서 supabase-schema.sql 실행\n3) 개발 서버 재시작 (npm run dev)'
          : `등록에 실패했습니다. (${msg})`
      )
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
            새로운 광고주와 지침서를 등록합니다
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
                autoComplete="off"
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>제품 정보</Label>
              <p className="text-sm text-muted-foreground">
                이 광고주가 보유한 제품 이름을 입력하세요. 여러 개라면 + 버튼으로 추가할 수 있습니다.
              </p>
              <div className="space-y-3">
                {formData.products.map((product, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      placeholder="예: 이공이샴푸 500ml"
                      value={product}
                      onChange={(e) => updateProduct(index, e.target.value)}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => removeProduct(index)}
                      disabled={formData.products.length === 1}
                    >
                      -
                    </Button>
                    {index === formData.products.length - 1 && (
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={addProduct}
                      >
                        +
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="mt-4 border-green-200 bg-green-50">
          <CardHeader>
            <CardTitle>소구점</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>소구점 목록</Label>
              <p className="text-sm text-muted-foreground">
                광고에서 강조할 핵심 포인트를 입력하세요. AI가 카피 작성 시 참고합니다.
              </p>
              <div className="space-y-3">
                {formData.appeals.map((appeal, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      placeholder="예: 자연 유래 성분 99%, 무향료, 피부과 테스트 완료"
                      value={appeal}
                      onChange={(e) => updateAppeal(index, e.target.value)}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => removeAppeal(index)}
                      disabled={formData.appeals.length === 1}
                    >
                      -
                    </Button>
                    {index === formData.appeals.length - 1 && (
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={addAppeal}
                      >
                        +
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle>지침서</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="guidelines">지침서 내용</Label>
              <Textarea
                id="guidelines"
                rows={6}
                placeholder="클로드가 카피를 쓸 때 꼭 참고해야 할 브랜드/상품 지침서를 자유롭게 적어주세요."
                value={formData.guidelines}
                onChange={(e) => setFormData({ ...formData, guidelines: e.target.value })}
              />
            </div>
          </CardContent>
        </Card>

        <Card className="mt-4 border-red-200 bg-red-50">
          <CardHeader>
            <CardTitle>주의사항 (선택)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label htmlFor="cautions">하면 안 되는 것 / 꼭 피해야 할 상황</Label>
              <Textarea
                id="cautions"
                rows={4}
                placeholder="예: 의료 효능을 단정적으로 표현하지 말 것, 경쟁사 브랜드 직접 언급 금지 등"
                value={formData.cautions}
                onChange={(e) => setFormData({ ...formData, cautions: e.target.value })}
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
