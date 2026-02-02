'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { ArrowLeft, Save, Image, Video, Copy, Check, Sparkles, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getPlan, updatePlan } from '@/lib/api/plans'
import { getAdvertisers } from '@/lib/api/advertisers'
import { AdPlan, Advertiser } from '@/lib/supabase'

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

  function copyToClipboard() {
    let text = `[광고 기획서: ${formData.title}]\n\n`
    text += `소재 유형: ${formData.media_type === 'image' ? '이미지' : '영상'}\n`
    if (selectedAdvertiser) {
      text += `광고주: ${selectedAdvertiser.name}\n`
    }
    if (aiResults.length > 0) {
      text += `\n[AI 생성 카피]\n`
      aiResults.forEach((r, i) => {
        text += `${i + 1}. ${r.title}: ${r.description}\n`
      })
    }

    navigator.clipboard.writeText(text.trim())
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // AI 카피 생성
  async function generateAiCopies() {
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
            guidelines: selectedAdvertiser.guidelines,
            products: selectedAdvertiser.products,
            appeals: selectedAdvertiser.appeals,
            cautions: selectedAdvertiser.cautions,
          } : null,
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
              // 파싱해서 결과로 변환
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
    <div className="max-w-3xl mx-auto space-y-6 pb-32">
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
          </CardContent>
        </Card>

        {/* 선택된 광고주 정보 표시 */}
        {selectedAdvertiser && (
          <Card className="mt-4 border-blue-200 bg-blue-50">
            <CardHeader className="pb-2">
              <CardTitle className="text-base text-blue-800">
                {selectedAdvertiser.name} 정보
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {selectedAdvertiser.products && selectedAdvertiser.products.length > 0 && (
                <div>
                  <span className="text-blue-700 font-medium">제품: </span>
                  <span className="text-blue-900">{selectedAdvertiser.products.join(', ')}</span>
                </div>
              )}
              {selectedAdvertiser.appeals && selectedAdvertiser.appeals.length > 0 && (
                <div>
                  <span className="text-blue-700 font-medium">소구점: </span>
                  <span className="text-blue-900">{selectedAdvertiser.appeals.join(', ')}</span>
                </div>
              )}
              {selectedAdvertiser.guidelines && (
                <div>
                  <span className="text-blue-700 font-medium">지침서: </span>
                  <span className="text-blue-900 line-clamp-2">{selectedAdvertiser.guidelines}</span>
                </div>
              )}
            </CardContent>
          </Card>
        )}

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

      {/* AI 생성 결과 패널 */}
      {showAiPanel && (
        <Card className="mt-6 border-purple-200 bg-purple-50">
          <CardHeader>
            <CardTitle className="text-purple-800 flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
              AI 생성 카피 ({formData.media_type === 'image' ? '이미지' : '영상'})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {aiLoading ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-purple-700">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>카피 생성 중...</span>
                </div>
                <pre className="whitespace-pre-wrap text-sm text-purple-900 bg-white/50 p-3 rounded">
                  {streamText || '...'}
                </pre>
              </div>
            ) : aiResults.length > 0 ? (
              <div className="space-y-3">
                {aiResults.map((result, index) => (
                  <div key={index} className="bg-white p-3 rounded-lg shadow-sm border border-purple-100">
                    <div className="font-medium text-purple-800">{index + 1}. {result.title}</div>
                    <div className="text-sm text-gray-600 mt-1">{result.description}</div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-purple-700">생성된 카피가 없습니다.</p>
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
          onClick={generateAiCopies}
          disabled={aiLoading}
        >
          {aiLoading ? (
            <>
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              생성 중...
            </>
          ) : (
            <>
              <Sparkles className="mr-2 h-5 w-5" />
              AI 카피 6개 생성
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
