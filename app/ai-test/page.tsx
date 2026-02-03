'use client'

import { useState, useEffect } from 'react'
import { Sparkles, Send, Loader2, BookOpen, Check, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { getAdvertisers, updateAdvertiser } from '@/lib/api/advertisers'
import { Advertiser } from '@/lib/supabase'

export default function AILearningPage() {
  const [advertisers, setAdvertisers] = useState<Advertiser[]>([])
  const [selectedAdvertiserId, setSelectedAdvertiserId] = useState('')
  const [selectedAdvertiser, setSelectedAdvertiser] = useState<Advertiser | null>(null)
  const [scriptInput, setScriptInput] = useState('')
  const [mediaType, setMediaType] = useState<'image' | 'video'>('video')
  const [loading, setLoading] = useState(false)
  const [analysisResult, setAnalysisResult] = useState<{
    guidelines: string
    appeals: string[]
    cautions: string
  } | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    loadAdvertisers()
  }, [])

  async function loadAdvertisers() {
    try {
      const data = await getAdvertisers()
      setAdvertisers(data)
    } catch (error) {
      console.error('광고주 로드 실패:', error)
    }
  }

  function handleAdvertiserChange(id: string) {
    setSelectedAdvertiserId(id)
    const advertiser = advertisers.find(a => a.id === id)
    setSelectedAdvertiser(advertiser || null)
    setAnalysisResult(null)
    setSaved(false)
  }

  async function handleAnalyze(e: React.FormEvent) {
    e.preventDefault()
    if (!scriptInput.trim() || !selectedAdvertiser) return

    setLoading(true)
    setAnalysisResult(null)
    setSaved(false)

    try {
      const res = await fetch('/api/ai/learn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          script: scriptInput.trim(),
          mediaType,
          advertiserName: selectedAdvertiser.name,
          existingGuidelines: mediaType === 'image' 
            ? selectedAdvertiser.guidelines_image 
            : selectedAdvertiser.guidelines_video,
          existingAppeals: selectedAdvertiser.appeals,
          existingCautions: selectedAdvertiser.cautions,
        }),
      })

      if (!res.ok) {
        throw new Error('분석 실패')
      }

      const data = await res.json()
      setAnalysisResult(data)
    } catch (error) {
      console.error('분석 실패:', error)
      alert('분석에 실패했습니다.')
    } finally {
      setLoading(false)
    }
  }

  async function handleSave() {
    if (!analysisResult || !selectedAdvertiser) return

    setSaving(true)
    try {
      const updateData: Partial<Advertiser> = {}
      
      if (mediaType === 'image') {
        updateData.guidelines_image = analysisResult.guidelines
      } else {
        updateData.guidelines_video = analysisResult.guidelines
      }
      
      if (analysisResult.appeals.length > 0) {
        // 기존 소구점과 병합 (중복 제거)
        const existingAppeals = selectedAdvertiser.appeals || []
        const newAppeals = [...new Set([...existingAppeals, ...analysisResult.appeals])]
        updateData.appeals = newAppeals
      }
      
      if (analysisResult.cautions) {
        // 기존 주의사항과 병합
        const existingCautions = selectedAdvertiser.cautions || ''
        const newCautions = existingCautions 
          ? `${existingCautions}\n\n${analysisResult.cautions}`
          : analysisResult.cautions
        updateData.cautions = newCautions
      }

      await updateAdvertiser(selectedAdvertiser.id, updateData)
      
      // 광고주 목록 새로고침
      await loadAdvertisers()
      const updated = advertisers.find(a => a.id === selectedAdvertiser.id)
      if (updated) setSelectedAdvertiser(updated)
      
      setSaved(true)
      alert('학습 결과가 광고주 정보에 반영되었습니다!')
    } catch (error) {
      console.error('저장 실패:', error)
      alert('저장에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <BookOpen className="h-8 w-8 text-purple-500" />
          AI 학습
        </h1>
        <p className="text-muted-foreground mt-1">
          기존 대본/카피를 입력하면 AI가 분석하여 광고주 지침서를 자동으로 업데이트합니다.
        </p>
      </div>

      <form onSubmit={handleAnalyze}>
        <Card>
          <CardHeader>
            <CardTitle>대본/카피 분석</CardTitle>
            <CardDescription>
              기존에 사용했던 좋은 대본이나 카피를 입력하면, AI가 패턴을 분석해서 지침서에 반영합니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* 광고주 선택 */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>광고주 선택</Label>
                <Select
                  value={selectedAdvertiserId}
                  onChange={(e) => handleAdvertiserChange(e.target.value)}
                  disabled={loading}
                >
                  <option value="">광고주를 선택하세요</option>
                  {advertisers.map((adv) => (
                    <option key={adv.id} value={adv.id}>
                      {adv.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-2">
                <Label>소재 유형</Label>
                <Select
                  value={mediaType}
                  onChange={(e) => setMediaType(e.target.value as 'image' | 'video')}
                  disabled={loading}
                >
                  <option value="image">이미지 광고</option>
                  <option value="video">영상 광고</option>
                </Select>
              </div>
            </div>

            {/* 현재 지침서 표시 */}
            {selectedAdvertiser && (
              <div className="bg-gray-50 p-4 rounded-lg border">
                <div className="text-sm font-medium text-gray-700 mb-2">
                  현재 {mediaType === 'image' ? '이미지' : '영상'} 지침서:
                </div>
                <div className="text-sm text-gray-600 whitespace-pre-wrap max-h-32 overflow-y-auto">
                  {(mediaType === 'image' 
                    ? selectedAdvertiser.guidelines_image 
                    : selectedAdvertiser.guidelines_video) || '(없음)'}
                </div>
              </div>
            )}

            {/* 대본 입력 */}
            <div className="space-y-2">
              <Label htmlFor="script">
                학습할 대본/카피 입력
              </Label>
              <Textarea
                id="script"
                placeholder={mediaType === 'video' 
                  ? "기존에 효과 좋았던 영상 광고 대본을 입력하세요...\n\n예:\nScene 1: 여성이 거울 앞에서 고민하는 모습\n나레이션: \"또 고민이세요?\"\n..."
                  : "기존에 효과 좋았던 이미지 광고 카피를 입력하세요...\n\n예:\n메인: 당신의 피부가 달라집니다\n서브: 2주만에 느끼는 확실한 변화"}
                rows={10}
                value={scriptInput}
                onChange={(e) => setScriptInput(e.target.value)}
                disabled={loading || !selectedAdvertiser}
              />
            </div>

            <Button 
              type="submit" 
              disabled={loading || !selectedAdvertiser || !scriptInput.trim()}
              className="w-full"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  AI 분석 중...
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" />
                  AI 분석 시작
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      </form>

      {/* 분석 결과 */}
      {analysisResult && (
        <Card className="border-purple-200 bg-purple-50">
          <CardHeader>
            <CardTitle className="text-purple-800 flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
              분석 결과
            </CardTitle>
            <CardDescription>
              AI가 대본을 분석하여 추출한 정보입니다. 저장하면 광고주 정보에 반영됩니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* 지침서 */}
            <div className="bg-white p-4 rounded-lg border">
              <div className="text-sm font-medium text-purple-700 mb-2">
                📝 추출된 지침서 ({mediaType === 'image' ? '이미지' : '영상'}용)
              </div>
              <div className="text-sm text-gray-700 whitespace-pre-wrap">
                {analysisResult.guidelines}
              </div>
            </div>

            {/* 소구점 */}
            {analysisResult.appeals.length > 0 && (
              <div className="bg-white p-4 rounded-lg border">
                <div className="text-sm font-medium text-green-700 mb-2">
                  ✨ 추출된 소구점
                </div>
                <div className="flex flex-wrap gap-2">
                  {analysisResult.appeals.map((appeal, i) => (
                    <span key={i} className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm">
                      {appeal}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* 주의사항 */}
            {analysisResult.cautions && (
              <div className="bg-white p-4 rounded-lg border border-red-200">
                <div className="text-sm font-medium text-red-700 mb-2">
                  ⚠️ 추출된 주의사항
                </div>
                <div className="text-sm text-gray-700">
                  {analysisResult.cautions}
                </div>
              </div>
            )}

            {/* 저장 버튼 */}
            <div className="flex gap-3 pt-2">
              <Button 
                onClick={handleSave} 
                disabled={saving || saved}
                className="flex-1 bg-purple-600 hover:bg-purple-700"
              >
                {saving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    저장 중...
                  </>
                ) : saved ? (
                  <>
                    <Check className="mr-2 h-4 w-4" />
                    저장 완료!
                  </>
                ) : (
                  <>
                    <Send className="mr-2 h-4 w-4" />
                    광고주 정보에 반영하기
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setAnalysisResult(null)
                  setScriptInput('')
                }}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                다시 분석
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
