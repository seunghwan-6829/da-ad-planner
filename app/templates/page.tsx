'use client'

import { useEffect, useState } from 'react'
import { Plus, Trash2, Upload, Image as ImageIcon, Loader2, Copy, Check, X, RefreshCw, Eye } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { getBPMaterials, createBPMaterial, updateBPMaterial, deleteBPMaterial } from '@/lib/api/bp-materials'
import { BPMaterial } from '@/lib/supabase'

export default function BPMaterialsPage() {
  const [items, setItems] = useState<BPMaterial[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [extracting, setExtracting] = useState<string[]>([])
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [viewImage, setViewImage] = useState<string | null>(null)
  
  // 업로드 폼
  const [previewUrls, setPreviewUrls] = useState<string[]>([])
  const [bpName, setBpName] = useState('')
  const [uploading, setUploading] = useState(false)

  // 데이터 로드
  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    const data = await getBPMaterials()
    setItems(data)
    setLoading(false)
  }

  // 파일 선택
  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || [])
    const imageFiles = files.filter(f => f.type.startsWith('image/'))
    
    imageFiles.forEach(file => {
      const reader = new FileReader()
      reader.onload = (event) => {
        setPreviewUrls(prev => [...prev, event.target?.result as string])
      }
      reader.readAsDataURL(file)
    })
    
    e.target.value = ''
  }

  // 미리보기 삭제
  function removePreview(index: number) {
    setPreviewUrls(prev => prev.filter((_, i) => i !== index))
  }

  // OCR 추출
  async function extractText(imageBase64: string): Promise<string> {
    try {
      const res = await fetch('/api/ai/ocr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imageBase64 }),
      })
      if (!res.ok) return ''
      const data = await res.json()
      return data.text || ''
    } catch {
      return ''
    }
  }

  // 업로드
  async function handleUpload() {
    if (previewUrls.length === 0) {
      alert('이미지를 선택해주세요.')
      return
    }

    setUploading(true)

    for (let i = 0; i < previewUrls.length; i++) {
      const name = bpName ? `${bpName} ${i + 1}` : `BP 소재 ${items.length + i + 1}`
      
      // DB에 저장
      const created = await createBPMaterial({
        name,
        image_url: previewUrls[i],
        extracted_text: null,
      })
      
      if (created) {
        setItems(prev => [created, ...prev])
        
        // 백그라운드에서 텍스트 추출
        setExtracting(prev => [...prev, created.id])
        const text = await extractText(previewUrls[i])
        await updateBPMaterial(created.id, { extracted_text: text })
        setItems(prev => prev.map(item => 
          item.id === created.id ? { ...item, extracted_text: text } : item
        ))
        setExtracting(prev => prev.filter(id => id !== created.id))
      }
    }

    // 폼 초기화
    setPreviewUrls([])
    setBpName('')
    setShowForm(false)
    setUploading(false)
  }

  // 재추출
  async function reExtract(item: BPMaterial) {
    if (!item.image_url) return
    
    setExtracting(prev => [...prev, item.id])
    const text = await extractText(item.image_url)
    await updateBPMaterial(item.id, { extracted_text: text })
    setItems(prev => prev.map(i => 
      i.id === item.id ? { ...i, extracted_text: text } : i
    ))
    setExtracting(prev => prev.filter(id => id !== item.id))
  }

  // 텍스트 수정
  async function handleTextChange(id: string, text: string) {
    setItems(prev => prev.map(item => 
      item.id === id ? { ...item, extracted_text: text } : item
    ))
  }

  async function saveText(id: string) {
    const item = items.find(i => i.id === id)
    if (item) {
      await updateBPMaterial(id, { extracted_text: item.extracted_text })
    }
  }

  // 복사
  function copyText(text: string, id: string) {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  // 삭제
  async function handleDelete(id: string) {
    if (!confirm('정말 삭제하시겠습니까?')) return
    const success = await deleteBPMaterial(id)
    if (success) {
      setItems(prev => prev.filter(i => i.id !== id))
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">BP 소재 관리</h1>
          <p className="text-muted-foreground mt-1">
            Best Practice 소재 이미지를 업로드하면 AI가 카피를 자동으로 추출합니다
          </p>
        </div>
        {!showForm && (
          <Button onClick={() => setShowForm(true)}>
            <Plus className="mr-2 h-4 w-4" />
            BP 소재 추가
          </Button>
        )}
      </div>

      {/* 업로드 폼 */}
      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>새 BP 소재 업로드</CardTitle>
            <CardDescription>
              이미지를 여러 장 선택하면 각각의 카피를 AI가 자동으로 추출합니다
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>소재 이름 (선택)</Label>
              <Input
                placeholder="예: 2024년 1월 성과 좋았던 소재"
                value={bpName}
                onChange={(e) => setBpName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>이미지 업로드</Label>
              <div
                className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary transition-colors"
                onClick={() => document.getElementById('bp-upload')?.click()}
              >
                <input
                  id="bp-upload"
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={handleFileSelect}
                />
                <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                <p className="text-sm text-muted-foreground">
                  클릭하거나 이미지를 드래그해서 업로드
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  여러 장 선택 가능
                </p>
              </div>
            </div>

            {previewUrls.length > 0 && (
              <div className="space-y-2">
                <Label>선택된 이미지 ({previewUrls.length}장)</Label>
                <div className="grid grid-cols-6 gap-2">
                  {previewUrls.map((url, index) => (
                    <div key={index} className="relative group">
                      <img
                        src={url}
                        alt={`미리보기 ${index + 1}`}
                        className="w-full h-20 object-cover rounded border"
                      />
                      <button
                        onClick={() => removePreview(index)}
                        className="absolute top-0 right-0 bg-red-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button 
                variant="outline" 
                onClick={() => {
                  setShowForm(false)
                  setPreviewUrls([])
                  setBpName('')
                }}
              >
                취소
              </Button>
              <Button onClick={handleUpload} disabled={uploading || previewUrls.length === 0}>
                {uploading ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />업로드 중...</>
                ) : (
                  <><Upload className="mr-2 h-4 w-4" />업로드</>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 테이블 형태 목록 */}
      {items.length === 0 && !showForm ? (
        <Card>
          <CardContent className="py-12 text-center">
            <ImageIcon className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">등록된 BP 소재가 없습니다.</p>
            <Button variant="outline" className="mt-4" onClick={() => setShowForm(true)}>
              첫 BP 소재 업로드
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="bg-white rounded-lg border overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 w-12">No.</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 w-24">이미지</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 w-40">이름</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">추출된 카피</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 w-28">등록일</th>
                <th className="px-4 py-3 text-center text-sm font-medium text-gray-600 w-32">작업</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((item, index) => (
                <tr key={item.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {items.length - index}
                  </td>
                  <td className="px-4 py-3">
                    {item.image_url && (
                      <img
                        src={item.image_url}
                        alt={item.name}
                        className="w-16 h-16 object-cover rounded cursor-pointer hover:opacity-80"
                        onClick={() => setViewImage(item.image_url)}
                      />
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm font-medium">{item.name}</span>
                  </td>
                  <td className="px-4 py-3">
                    {extracting.includes(item.id) ? (
                      <div className="flex items-center text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        AI가 카피 추출 중...
                      </div>
                    ) : (
                      <Textarea
                        value={item.extracted_text || ''}
                        onChange={(e) => handleTextChange(item.id, e.target.value)}
                        onBlur={() => saveText(item.id)}
                        placeholder="추출된 카피가 여기 표시됩니다"
                        className="text-sm h-20 resize-none"
                      />
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {new Date(item.created_at).toLocaleDateString('ko-KR')}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        title="재추출"
                        onClick={() => reExtract(item)}
                        disabled={extracting.includes(item.id)}
                      >
                        <RefreshCw className={`h-4 w-4 ${extracting.includes(item.id) ? 'animate-spin' : ''}`} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="복사"
                        onClick={() => copyText(item.extracted_text || '', item.id)}
                        disabled={!item.extracted_text}
                      >
                        {copiedId === item.id ? (
                          <Check className="h-4 w-4 text-green-600" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="삭제"
                        onClick={() => handleDelete(item.id)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 이미지 확대 모달 */}
      {viewImage && (
        <div 
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-8"
          onClick={() => setViewImage(null)}
        >
          <div className="relative max-w-4xl max-h-full">
            <img
              src={viewImage}
              alt="확대 이미지"
              className="max-w-full max-h-[80vh] object-contain rounded-lg"
            />
            <button
              onClick={() => setViewImage(null)}
              className="absolute top-2 right-2 bg-white rounded-full p-2 shadow-lg"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
