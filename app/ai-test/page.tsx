'use client'

import { useState, useEffect, useRef } from 'react'
import { BookOpen, Upload, Save, Check, Plus, Trash2, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { getAdvertisers, updateAdvertiser } from '@/lib/api/advertisers'
import { Advertiser } from '@/lib/supabase'

interface BPItem {
  id: string
  content: string
}

export default function AILearningPage() {
  const [advertisers, setAdvertisers] = useState<Advertiser[]>([])
  const [selectedAdvertiserId, setSelectedAdvertiserId] = useState('')
  const [selectedAdvertiser, setSelectedAdvertiser] = useState<Advertiser | null>(null)
  const [mediaType, setMediaType] = useState<'image' | 'video'>('video')
  const [bpList, setBpList] = useState<BPItem[]>([{ id: '1', content: '' }])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

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
    setSaved(false)
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>, index: number) {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      const text = event.target?.result as string
      if (text) {
        setBpList(prev => {
          const updated = [...prev]
          updated[index] = { ...updated[index], content: text }
          return updated
        })
      }
    }
    reader.readAsText(file)
    
    // 파일 input 초기화
    e.target.value = ''
  }

  function addBpItem() {
    setBpList(prev => [...prev, { id: Date.now().toString(), content: '' }])
  }

  function removeBpItem(id: string) {
    if (bpList.length <= 1) return
    setBpList(prev => prev.filter(item => item.id !== id))
  }

  function updateBpContent(id: string, content: string) {
    setBpList(prev => prev.map(item => 
      item.id === id ? { ...item, content } : item
    ))
  }

  async function handleSave() {
    if (!selectedAdvertiser) {
      alert('광고주를 선택해주세요.')
      return
    }

    const validBps = bpList.filter(bp => bp.content.trim())
    if (validBps.length === 0) {
      alert('BP 소재를 1개 이상 입력해주세요.')
      return
    }

    setSaving(true)
    try {
      // BP 소재들을 지침서에 추가
      const bpContent = validBps.map((bp, i) => 
        `=== BP 소재 ${i + 1} ===\n${bp.content.trim()}`
      ).join('\n\n')

      const currentGuideline = mediaType === 'image' 
        ? selectedAdvertiser.guidelines_image 
        : selectedAdvertiser.guidelines_video

      const newGuideline = currentGuideline 
        ? `${currentGuideline}\n\n${bpContent}`
        : bpContent

      const updateData: Partial<Advertiser> = {}
      if (mediaType === 'image') {
        updateData.guidelines_image = newGuideline
      } else {
        updateData.guidelines_video = newGuideline
      }

      await updateAdvertiser(selectedAdvertiser.id, updateData)
      
      // 광고주 목록 새로고침
      await loadAdvertisers()
      
      setSaved(true)
      setBpList([{ id: '1', content: '' }])
      alert('BP 소재가 지침서에 저장되었습니다!')
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
          AI 학습 (BP 소재 등록)
        </h1>
        <p className="text-muted-foreground mt-1">
          효과 좋았던 BP(Best Practice) 소재를 등록하면, AI가 카피 생성 시 참고합니다.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>BP 소재 등록</CardTitle>
          <CardDescription>
            광고주별로 효과 좋았던 대본/카피를 등록하세요. 파일(.txt)을 업로드하거나 직접 입력할 수 있습니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* 광고주 선택 */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>광고주 선택</Label>
              <Select
                value={selectedAdvertiserId}
                onChange={(e) => handleAdvertiserChange(e.target.value)}
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
              <div className="text-sm text-gray-600 whitespace-pre-wrap max-h-40 overflow-y-auto bg-white p-3 rounded border">
                {(mediaType === 'image' 
                  ? selectedAdvertiser.guidelines_image 
                  : selectedAdvertiser.guidelines_video) || '(등록된 지침서 없음)'}
              </div>
            </div>
          )}

          {/* BP 소재 입력 목록 */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label>BP 소재 입력</Label>
              <Button 
                type="button" 
                variant="outline" 
                size="sm"
                onClick={addBpItem}
              >
                <Plus className="h-4 w-4 mr-1" />
                추가
              </Button>
            </div>

            {bpList.map((bp, index) => (
              <div key={bp.id} className="border rounded-lg p-4 space-y-3 bg-white">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-purple-700">
                    BP 소재 {index + 1}
                  </span>
                  <div className="flex items-center gap-2">
                    <input
                      type="file"
                      accept=".txt"
                      className="hidden"
                      ref={index === 0 ? fileInputRef : undefined}
                      id={`file-${bp.id}`}
                      onChange={(e) => handleFileUpload(e, index)}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => document.getElementById(`file-${bp.id}`)?.click()}
                    >
                      <Upload className="h-4 w-4 mr-1" />
                      파일 업로드
                    </Button>
                    {bpList.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeBpItem(bp.id)}
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    )}
                  </div>
                </div>
                <Textarea
                  placeholder={mediaType === 'video' 
                    ? "영상 광고 대본을 입력하세요...\n\nScene 1: 화면 설명\n나레이션: \"대사\"\n..."
                    : "이미지 광고 카피를 입력하세요...\n\n메인: 헤드라인\n서브: 서브카피"}
                  rows={8}
                  value={bp.content}
                  onChange={(e) => updateBpContent(bp.id, e.target.value)}
                />
                {bp.content && (
                  <div className="flex items-center gap-2 text-xs text-green-600">
                    <FileText className="h-3 w-3" />
                    {bp.content.length}자 입력됨
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* 저장 버튼 */}
          <Button 
            onClick={handleSave}
            disabled={saving || !selectedAdvertiser}
            className="w-full bg-purple-600 hover:bg-purple-700"
            size="lg"
          >
            {saving ? (
              <>저장 중...</>
            ) : saved ? (
              <>
                <Check className="mr-2 h-4 w-4" />
                저장 완료!
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                지침서에 저장
              </>
            )}
          </Button>

          <p className="text-xs text-muted-foreground text-center">
            저장된 BP 소재는 광고주의 {mediaType === 'image' ? '이미지' : '영상'} 지침서에 추가됩니다.
            <br />
            AI가 카피 생성 시 이 BP 소재를 참고하여 비슷한 스타일로 작성합니다.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
