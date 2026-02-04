'use client'

import { useEffect, useState } from 'react'
import { Plus, Trash2, Upload, Image as ImageIcon, Loader2, Copy, Check, X, RefreshCw, Database, Eye } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { getBPMaterials, createBPMaterial, updateBPMaterial, deleteBPMaterial } from '@/lib/api/bp-materials'
import { BPMaterial } from '@/lib/supabase'

const CATEGORIES = ['전체', '뷰티', '건강', '식품', '패션', '가전', '금융', '교육', '여행', '자동차', '대행', '기타']
const CATEGORY_OPTIONS = ['뷰티', '건강', '식품', '패션', '가전', '금융', '교육', '여행', '자동차', '대행', '기타']

export default function BPMaterialsPage() {
  const [items, setItems] = useState<BPMaterial[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [showDataModal, setShowDataModal] = useState(false)
  const [extracting, setExtracting] = useState<string[]>([])
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [viewImage, setViewImage] = useState<BPMaterial | null>(null)
  const [selectedCategory, setSelectedCategory] = useState('전체')
  
  // 업로드 폼
  const [previewUrls, setPreviewUrls] = useState<string[]>([])
  const [bpName, setBpName] = useState('')
  const [uploading, setUploading] = useState(false)
  
  // 필터링된 아이템
  const filteredItems = selectedCategory === '전체' 
    ? items 
    : items.filter(item => item.category === selectedCategory)
  
  // 카테고리별 개수
  const categoryCounts = CATEGORIES.reduce((acc, cat) => {
    if (cat === '전체') {
      acc[cat] = items.length
    } else {
      acc[cat] = items.filter(item => item.category === cat).length
    }
    return acc
  }, {} as Record<string, number>)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    const data = await getBPMaterials()
    setItems(data)
    setLoading(false)
  }

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

  function removePreview(index: number) {
    setPreviewUrls(prev => prev.filter((_, i) => i !== index))
  }

  async function extractData(imageBase64: string): Promise<{ text: string; category: string }> {
    try {
      const res = await fetch('/api/ai/ocr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imageBase64 }),
      })
      if (!res.ok) return { text: '', category: '' }
      const data = await res.json()
      return { text: data.text || '', category: data.category || '' }
    } catch {
      return { text: '', category: '' }
    }
  }

  async function handleUpload() {
    if (previewUrls.length === 0) {
      alert('이미지를 선택해주세요.')
      return
    }

    setUploading(true)

    for (let i = 0; i < previewUrls.length; i++) {
      const name = bpName ? `${bpName} ${i + 1}` : `BP 소재 ${items.length + i + 1}`
      
      const created = await createBPMaterial({
        name,
        image_url: previewUrls[i],
        extracted_text: null,
        category: null,
      })
      
      if (created) {
        setItems(prev => [created, ...prev])
        
        // 백그라운드에서 추출
        setExtracting(prev => [...prev, created.id])
        const { text, category } = await extractData(previewUrls[i])
        await updateBPMaterial(created.id, { extracted_text: text, category })
        setItems(prev => prev.map(item => 
          item.id === created.id ? { ...item, extracted_text: text, category } : item
        ))
        setExtracting(prev => prev.filter(id => id !== created.id))
      }
    }

    setPreviewUrls([])
    setBpName('')
    setShowForm(false)
    setUploading(false)
  }

  async function reExtract(item: BPMaterial) {
    if (!item.image_url) return
    
    setExtracting(prev => [...prev, item.id])
    const { text, category } = await extractData(item.image_url)
    await updateBPMaterial(item.id, { extracted_text: text, category })
    setItems(prev => prev.map(i => 
      i.id === item.id ? { ...i, extracted_text: text, category } : i
    ))
    setExtracting(prev => prev.filter(id => id !== item.id))
  }

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

  function copyText(text: string, id: string) {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  async function handleDelete(id: string) {
    if (!confirm('정말 삭제하시겠습니까?')) return
    const success = await deleteBPMaterial(id)
    if (success) {
      setItems(prev => prev.filter(i => i.id !== id))
    }
  }

  // 카테고리별 색상
  function getCategoryColor(category: string | null) {
    const colors: Record<string, string> = {
      '뷰티': 'bg-pink-100 text-pink-700',
      '건강': 'bg-green-100 text-green-700',
      '식품': 'bg-orange-100 text-orange-700',
      '패션': 'bg-purple-100 text-purple-700',
      '가전': 'bg-blue-100 text-blue-700',
      '금융': 'bg-yellow-100 text-yellow-700',
      '교육': 'bg-indigo-100 text-indigo-700',
      '여행': 'bg-cyan-100 text-cyan-700',
      '자동차': 'bg-gray-100 text-gray-700',
      '대행': 'bg-red-100 text-red-700',
    }
    return colors[category || ''] || 'bg-gray-100 text-gray-600'
  }

  // 카테고리 변경
  async function handleCategoryChange(itemId: string, newCategory: string) {
    await updateBPMaterial(itemId, { category: newCategory })
    setItems(prev => prev.map(item => 
      item.id === itemId ? { ...item, category: newCategory } : item
    ))
    if (viewImage && viewImage.id === itemId) {
      setViewImage({ ...viewImage, category: newCategory })
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
            Best Practice 소재 이미지를 업로드하면 AI가 카피와 카테고리를 자동 분석합니다
          </p>
        </div>
        <div className="flex gap-2">
          {items.length > 0 && (
            <Button variant="outline" onClick={() => setShowDataModal(true)}>
              <Database className="mr-2 h-4 w-4" />
              BP 데이터
            </Button>
          )}
          {!showForm && (
            <Button onClick={() => setShowForm(true)}>
              <Plus className="mr-2 h-4 w-4" />
              BP 소재 추가
            </Button>
          )}
        </div>
      </div>

      {/* 카테고리 필터 */}
      {items.length > 0 && !showForm && (
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                selectedCategory === cat
                  ? 'bg-primary text-white shadow-md'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {cat}
              {categoryCounts[cat] > 0 && (
                <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-xs ${
                  selectedCategory === cat ? 'bg-white/20' : 'bg-gray-200'
                }`}>
                  {categoryCounts[cat]}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* 업로드 폼 */}
      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>새 BP 소재 업로드</CardTitle>
            <CardDescription>
              이미지를 여러 장 선택하면 AI가 카피와 카테고리를 자동 분석합니다
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
                <p className="text-sm text-muted-foreground">클릭하여 이미지 업로드 (여러 장 선택 가능)</p>
              </div>
            </div>

            {previewUrls.length > 0 && (
              <div className="space-y-2">
                <Label>선택된 이미지 ({previewUrls.length}장)</Label>
                <div className="grid grid-cols-6 gap-2">
                  {previewUrls.map((url, index) => (
                    <div key={index} className="relative group">
                      <img src={url} alt="" className="w-full h-20 object-cover rounded border" />
                      <button
                        onClick={() => removePreview(index)}
                        className="absolute top-0 right-0 bg-red-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setShowForm(false); setPreviewUrls([]); setBpName('') }}>
                취소
              </Button>
              <Button onClick={handleUpload} disabled={uploading || previewUrls.length === 0}>
                {uploading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />업로드 중...</> : <><Upload className="mr-2 h-4 w-4" />업로드</>}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 갤러리 뷰 */}
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
      ) : filteredItems.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <ImageIcon className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">'{selectedCategory}' 카테고리에 소재가 없습니다.</p>
            <Button variant="outline" className="mt-4" onClick={() => setSelectedCategory('전체')}>
              전체 보기
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {filteredItems.map((item) => (
            <div
              key={item.id}
              className="group relative bg-white rounded-lg border overflow-hidden hover:shadow-lg transition-shadow cursor-pointer"
              onClick={() => setViewImage(item)}
            >
              {/* 이미지 */}
              <div className="aspect-square">
                {item.image_url && (
                  <img
                    src={item.image_url}
                    alt={item.name}
                    className="w-full h-full object-cover"
                  />
                )}
              </div>
              
              {/* 카테고리 뱃지 */}
              {item.category && (
                <div className="absolute top-2 left-2">
                  <Badge className={getCategoryColor(item.category)}>
                    {item.category}
                  </Badge>
                </div>
              )}
              
              {/* 추출 중 표시 */}
              {extracting.includes(item.id) && (
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                  <div className="text-white text-center">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto mb-1" />
                    <span className="text-xs">분석 중...</span>
                  </div>
                </div>
              )}
              
              {/* 호버 시 삭제 버튼 */}
              <button
                onClick={(e) => { e.stopPropagation(); handleDelete(item.id) }}
                className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1.5 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Trash2 className="h-3 w-3" />
              </button>
              
              {/* 이름 */}
              <div className="p-2 border-t">
                <p className="text-xs text-gray-600 truncate">{item.name}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 이미지 상세 모달 */}
      {viewImage && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={() => setViewImage(null)}>
          <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-hidden flex" onClick={e => e.stopPropagation()}>
            {/* 이미지 */}
            <div className="w-1/2 bg-gray-100">
              <img src={viewImage.image_url || ''} alt="" className="w-full h-full object-contain" />
            </div>
            
            {/* 정보 */}
            <div className="w-1/2 p-6 flex flex-col">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="font-bold text-lg">{viewImage.name}</h3>
                  <p className="text-sm text-gray-500">{new Date(viewImage.created_at).toLocaleDateString('ko-KR')}</p>
                </div>
                <button onClick={() => setViewImage(null)} className="text-gray-400 hover:text-gray-600">
                  <X className="h-5 w-5" />
                </button>
              </div>
              
              <div className="mb-4">
                <Label className="text-xs text-gray-500 mb-1 block">카테고리</Label>
                <select
                  value={viewImage.category || ''}
                  onChange={(e) => handleCategoryChange(viewImage.id, e.target.value)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border cursor-pointer ${getCategoryColor(viewImage.category)}`}
                >
                  <option value="">카테고리 선택</option>
                  {CATEGORY_OPTIONS.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
              
              <div className="flex-1">
                <div className="flex items-center justify-between mb-2">
                  <Label>추출된 카피</Label>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => reExtract(viewImage)} disabled={extracting.includes(viewImage.id)}>
                      <RefreshCw className={`h-3 w-3 mr-1 ${extracting.includes(viewImage.id) ? 'animate-spin' : ''}`} />
                      재추출
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => copyText(viewImage.extracted_text || '', viewImage.id)}>
                      {copiedId === viewImage.id ? <><Check className="h-3 w-3 mr-1" />복사됨</> : <><Copy className="h-3 w-3 mr-1" />복사</>}
                    </Button>
                  </div>
                </div>
                <Textarea
                  value={viewImage.extracted_text || ''}
                  onChange={(e) => {
                    const newText = e.target.value
                    setViewImage({ ...viewImage, extracted_text: newText })
                    handleTextChange(viewImage.id, newText)
                  }}
                  onBlur={() => saveText(viewImage.id)}
                  placeholder="추출된 카피"
                  className="h-48 resize-none"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* BP 데이터 모달 (테이블) */}
      {showDataModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowDataModal(false)}>
          <div className="bg-white rounded-lg max-w-6xl w-full max-h-[90vh] overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="text-xl font-bold">BP 데이터</h2>
              <button onClick={() => setShowDataModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            
            <div className="overflow-auto max-h-[calc(90vh-80px)]">
              <table className="w-full">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 w-12">No.</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 w-20">이미지</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 w-24">카테고리</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 w-32">이름</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">추출된 카피</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 w-24">등록일</th>
                    <th className="px-4 py-3 text-center text-sm font-medium text-gray-600 w-20">복사</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {items.map((item, index) => (
                    <tr key={item.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-gray-600">{items.length - index}</td>
                      <td className="px-4 py-3">
                        <img src={item.image_url || ''} alt="" className="w-12 h-12 object-cover rounded" />
                      </td>
                      <td className="px-4 py-3">
                        {item.category && (
                          <Badge className={getCategoryColor(item.category)}>{item.category}</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm">{item.name}</td>
                      <td className="px-4 py-3 text-sm">
                        <p className="line-clamp-2 text-gray-600">{item.extracted_text || '-'}</p>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {new Date(item.created_at).toLocaleDateString('ko-KR')}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => copyText(item.extracted_text || '', item.id)}
                          disabled={!item.extracted_text}
                        >
                          {copiedId === item.id ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
