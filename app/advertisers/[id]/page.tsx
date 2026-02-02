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
    guidelines: '',
    products: [''],
    cautions: '',
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
        guidelines: data.guidelines || '',
        products: (data.products && data.products.length ? data.products : ['']),
        cautions: data.cautions || '',
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
      const products = formData.products
        .map((p) => p.trim())
        .filter(Boolean)

      await updateAdvertiser(id, {
        name: formData.name,
        guidelines: formData.guidelines || null,
        products: products.length ? products : null,
        cautions: formData.cautions || null,
      })
      alert('저장되었습니다.')
    } catch (error) {
      console.error('저장 실패:', error)
      alert('저장에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

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
            광고주 정보 수정
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
          <Button type="submit" disabled={saving}>
            <Save className="mr-2 h-4 w-4" />
            {saving ? '저장 중...' : '변경사항 저장'}
          </Button>
        </div>
      </form>
    </div>
  )
}
