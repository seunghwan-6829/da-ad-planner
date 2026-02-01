'use client'

import { useEffect, useState } from 'react'
import { Plus, Trash2, Edit, FileCode, Image, Video, X, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { getTemplates, createTemplate, updateTemplate, deleteTemplate } from '@/lib/api/templates'
import { Template } from '@/lib/supabase'

const COMMON_SIZES = [
  '1080x1080 (Instagram Square)',
  '1200x628 (Facebook Feed)',
  '1080x1920 (Story/Reels)',
  '300x250 (Medium Rectangle)',
  '728x90 (Leaderboard)',
  '160x600 (Wide Skyscraper)',
  '320x100 (Mobile Banner)',
]

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formData, setFormData] = useState({
    name: '',
    media_type: 'image',
    default_size: '',
    structure: {
      fields: ['main_copy', 'sub_copy', 'cta_text'],
      description: '',
    },
  })

  useEffect(() => {
    loadTemplates()
  }, [])

  async function loadTemplates() {
    try {
      const data = await getTemplates()
      setTemplates(data)
    } catch (error) {
      console.error('템플릿 로드 실패:', error)
    } finally {
      setLoading(false)
    }
  }

  function resetForm() {
    setFormData({
      name: '',
      media_type: 'image',
      default_size: '',
      structure: {
        fields: ['main_copy', 'sub_copy', 'cta_text'],
        description: '',
      },
    })
    setShowForm(false)
    setEditingId(null)
  }

  function handleEdit(template: Template) {
    setFormData({
      name: template.name,
      media_type: template.media_type || 'image',
      default_size: template.default_size || '',
      structure: (template.structure as typeof formData.structure) || {
        fields: ['main_copy', 'sub_copy', 'cta_text'],
        description: '',
      },
    })
    setEditingId(template.id)
    setShowForm(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    
    if (!formData.name.trim()) {
      alert('템플릿 이름을 입력해주세요.')
      return
    }

    try {
      if (editingId) {
        const updated = await updateTemplate(editingId, {
          name: formData.name,
          media_type: formData.media_type,
          default_size: formData.default_size || null,
          structure: formData.structure,
        })
        setTemplates(templates.map(t => t.id === editingId ? updated : t))
      } else {
        const created = await createTemplate({
          name: formData.name,
          media_type: formData.media_type,
          default_size: formData.default_size || null,
          structure: formData.structure,
        })
        setTemplates([created, ...templates])
      }
      resetForm()
    } catch (error) {
      console.error('저장 실패:', error)
      alert('저장에 실패했습니다.')
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('정말 삭제하시겠습니까?')) return
    
    try {
      await deleteTemplate(id)
      setTemplates(templates.filter(t => t.id !== id))
    } catch (error) {
      console.error('삭제 실패:', error)
      alert('삭제에 실패했습니다.')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">로딩 중...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">템플릿 관리</h1>
          <p className="text-muted-foreground mt-1">
            자주 사용하는 기획서 형식을 템플릿으로 저장합니다
          </p>
        </div>
        {!showForm && (
          <Button onClick={() => setShowForm(true)}>
            <Plus className="mr-2 h-4 w-4" />
            템플릿 추가
          </Button>
        )}
      </div>

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>{editingId ? '템플릿 수정' : '새 템플릿'}</CardTitle>
            <CardDescription>
              광고 기획서 작성 시 빠르게 적용할 수 있는 템플릿을 만듭니다
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">템플릿 이름 *</Label>
                  <Input
                    id="name"
                    placeholder="예: SNS 피드 기본형"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="media_type">소재 유형</Label>
                  <Select
                    id="media_type"
                    value={formData.media_type}
                    onChange={(e) => setFormData({ ...formData, media_type: e.target.value })}
                  >
                    <option value="image">이미지</option>
                    <option value="video">영상</option>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="default_size">기본 사이즈</Label>
                <Select
                  id="default_size"
                  value={formData.default_size}
                  onChange={(e) => setFormData({ ...formData, default_size: e.target.value })}
                >
                  <option value="">사이즈 선택</option>
                  {COMMON_SIZES.map((size) => (
                    <option key={size} value={size}>{size}</option>
                  ))}
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">템플릿 설명</Label>
                <Textarea
                  id="description"
                  placeholder="이 템플릿의 용도나 사용 방법을 설명해주세요..."
                  value={formData.structure.description}
                  onChange={(e) => setFormData({
                    ...formData,
                    structure: { ...formData.structure, description: e.target.value }
                  })}
                />
              </div>

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={resetForm}>
                  <X className="mr-2 h-4 w-4" />
                  취소
                </Button>
                <Button type="submit">
                  <Check className="mr-2 h-4 w-4" />
                  {editingId ? '수정' : '추가'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {templates.length === 0 && !showForm ? (
        <Card>
          <CardContent className="py-12 text-center">
            <FileCode className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">등록된 템플릿이 없습니다.</p>
            <Button variant="outline" className="mt-4" onClick={() => setShowForm(true)}>
              첫 템플릿 만들기
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {templates.map((template) => (
            <Card key={template.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    {template.media_type === 'video' ? (
                      <Video className="h-5 w-5 text-purple-500" />
                    ) : (
                      <Image className="h-5 w-5 text-blue-500" />
                    )}
                    <CardTitle className="text-lg">{template.name}</CardTitle>
                  </div>
                  <div className="flex gap-1">
                    <Button 
                      variant="ghost" 
                      size="icon"
                      onClick={() => handleEdit(template)}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="icon"
                      onClick={() => handleDelete(template.id)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 text-sm">
                  <div className="flex gap-2">
                    <Badge variant={template.media_type === 'video' ? 'secondary' : 'default'}>
                      {template.media_type === 'video' ? '영상' : '이미지'}
                    </Badge>
                    {template.default_size && (
                      <Badge variant="outline">{template.default_size.split(' ')[0]}</Badge>
                    )}
                  </div>
                  {(template.structure as { description?: string })?.description && (
                    <p className="text-muted-foreground line-clamp-2 mt-2">
                      {(template.structure as { description: string }).description}
                    </p>
                  )}
                  <div className="text-xs text-muted-foreground pt-2">
                    생성일: {new Date(template.created_at).toLocaleDateString('ko-KR')}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
