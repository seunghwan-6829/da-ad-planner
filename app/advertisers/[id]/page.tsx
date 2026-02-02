'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { ArrowLeft, Save, Image, Video, Upload } from 'lucide-react'
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
  const imageFileRef = useRef<HTMLInputElement>(null)
  const videoFileRef = useRef<HTMLInputElement>(null)
  const [formData, setFormData] = useState({
    name: '',
    guidelines_image: '',
    guidelines_video: '',
    products: [''],
    appeals: [''],
    cautions: '',
  })

  // 파일 업로드 처리
  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>, field: 'guidelines_image' | 'guidelines_video') {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.name.endsWith('.txt') && file.type !== 'text/plain') {
      alert('텍스트 파일(.txt)만 업로드 가능합니다.')
      return
    }

    const reader = new FileReader()
    reader.onload = (event) => {
      const content = event.target?.result as string
      setFormData(prev => ({ ...prev, [field]: content }))
    }
    reader.onerror = () => {
      alert('파일을 읽는 중 오류가 발생했습니다.')
    }
    reader.readAsText(file, 'UTF-8')
    e.target.value = ''
  }

  useEffect(() => {
    loadAdvertiser()
  }, [id])

  async function loadAdvertiser() {
    try {
      const data = await getAdvertiser(id)
      setAdvertiser(data)
      setFormData({
        name: data.name,
        guidelines_image: data.guidelines_image || '',
        guidelines_video: data.guidelines_video || '',
        products: (data.products && data.products.length ? data.products : ['']),
        appeals: (data.appeals && data.appeals.length ? data.appeals : ['']),
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
      const appeals = formData.appeals
        .map((a) => a.trim())
        .filter(Boolean)

      await updateAdvertiser(id, {
        name: formData.name,
        guidelines_image: formData.guidelines_image || null,
        guidelines_video: formData.guidelines_video || null,
        products: products.length ? products : null,
        appeals: appeals.length ? appeals : null,
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

        {/* 이미지 지침서 */}
        <Card className="mt-4 border-blue-200 bg-blue-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-blue-800">
              <Image className="h-5 w-5" />
              이미지 광고 지침서
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="guidelines_image">이미지 소재용 지침</Label>
                <div>
                  <input
                    ref={imageFileRef}
                    type="file"
                    accept=".txt,text/plain"
                    className="hidden"
                    onChange={(e) => handleFileUpload(e, 'guidelines_image')}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="text-xs"
                    onClick={() => imageFileRef.current?.click()}
                  >
                    <Upload className="h-3 w-3 mr-1" />
                    파일 업로드
                  </Button>
                </div>
              </div>
              <Textarea
                id="guidelines_image"
                rows={5}
                placeholder="이미지 광고 카피 작성 시 참고할 지침을 적어주세요.&#10;예: 짧고 임팩트 있는 헤드라인 위주, 감성적인 톤 유지...&#10;&#10;또는 위의 '파일 업로드' 버튼으로 .txt 파일을 올려주세요."
                value={formData.guidelines_image}
                onChange={(e) => setFormData({ ...formData, guidelines_image: e.target.value })}
              />
            </div>
          </CardContent>
        </Card>

        {/* 영상 지침서 */}
        <Card className="mt-4 border-purple-200 bg-purple-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-purple-800">
              <Video className="h-5 w-5" />
              영상 광고 지침서
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="guidelines_video">영상 소재용 지침</Label>
                <div>
                  <input
                    ref={videoFileRef}
                    type="file"
                    accept=".txt,text/plain"
                    className="hidden"
                    onChange={(e) => handleFileUpload(e, 'guidelines_video')}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="text-xs"
                    onClick={() => videoFileRef.current?.click()}
                  >
                    <Upload className="h-3 w-3 mr-1" />
                    파일 업로드
                  </Button>
                </div>
              </div>
              <Textarea
                id="guidelines_video"
                rows={5}
                placeholder="영상 광고 카피 작성 시 참고할 지침을 적어주세요.&#10;예: 초반 3초 후킹 중요, 스토리텔링 구조, 내레이션 톤...&#10;&#10;또는 위의 '파일 업로드' 버튼으로 .txt 파일을 올려주세요."
                value={formData.guidelines_video}
                onChange={(e) => setFormData({ ...formData, guidelines_video: e.target.value })}
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
