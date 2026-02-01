'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Plus, Search, Trash2, Eye, Image, Video, Filter } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { getPlans, deletePlan } from '@/lib/api/plans'
import { getAdvertisers } from '@/lib/api/advertisers'
import { AdPlan, Advertiser } from '@/lib/supabase'

export default function PlansPage() {
  const [plans, setPlans] = useState<AdPlan[]>([])
  const [advertisers, setAdvertisers] = useState<Advertiser[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [filterType, setFilterType] = useState<string>('all')
  const [filterAdvertiser, setFilterAdvertiser] = useState<string>('all')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    try {
      const [plansData, advertisersData] = await Promise.all([
        getPlans(),
        getAdvertisers()
      ])
      setPlans(plansData)
      setAdvertisers(advertisersData)
    } catch (error) {
      console.error('데이터 로드 실패:', error)
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('정말 삭제하시겠습니까?')) return
    
    try {
      await deletePlan(id)
      setPlans(plans.filter(p => p.id !== id))
    } catch (error) {
      console.error('삭제 실패:', error)
      alert('삭제에 실패했습니다.')
    }
  }

  const filteredPlans = plans.filter(plan => {
    const matchesSearch = plan.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      plan.concept?.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesType = filterType === 'all' || plan.media_type === filterType
    const matchesAdvertiser = filterAdvertiser === 'all' || plan.advertiser_id === filterAdvertiser
    return matchesSearch && matchesType && matchesAdvertiser
  })

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
          <h1 className="text-3xl font-bold">광고 기획서</h1>
          <p className="text-muted-foreground mt-1">
            이미지/영상 광고 소재 기획서를 관리합니다
          </p>
        </div>
        <Link href="/plans/new">
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            기획서 작성
          </Button>
        </Link>
      </div>

      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="기획서 검색..."
            className="pl-10"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <Select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="w-32"
          >
            <option value="all">전체 유형</option>
            <option value="image">이미지</option>
            <option value="video">영상</option>
          </Select>
          <Select
            value={filterAdvertiser}
            onChange={(e) => setFilterAdvertiser(e.target.value)}
            className="w-40"
          >
            <option value="all">전체 광고주</option>
            {advertisers.map((advertiser) => (
              <option key={advertiser.id} value={advertiser.id}>
                {advertiser.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {filteredPlans.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">
              {searchTerm || filterType !== 'all' || filterAdvertiser !== 'all'
                ? '검색 결과가 없습니다.'
                : '작성된 기획서가 없습니다.'}
            </p>
            {!searchTerm && filterType === 'all' && filterAdvertiser === 'all' && (
              <Link href="/plans/new">
                <Button variant="outline" className="mt-4">
                  첫 기획서 작성하기
                </Button>
              </Link>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {filteredPlans.map((plan) => (
            <Card key={plan.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-6">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      {plan.media_type === 'video' ? (
                        <Video className="h-5 w-5 text-purple-500" />
                      ) : (
                        <Image className="h-5 w-5 text-blue-500" />
                      )}
                      <h3 className="text-lg font-semibold">{plan.title}</h3>
                      <Badge variant={plan.media_type === 'video' ? 'secondary' : 'default'}>
                        {plan.media_type === 'video' ? '영상' : '이미지'}
                      </Badge>
                      {plan.size && (
                        <Badge variant="outline">{plan.size.split(' ')[0]}</Badge>
                      )}
                    </div>
                    
                    {(plan.advertiser as unknown as { name: string })?.name && (
                      <p className="text-sm text-muted-foreground mb-2">
                        광고주: {(plan.advertiser as unknown as { name: string }).name}
                      </p>
                    )}
                    
                    {plan.concept && (
                      <p className="text-sm text-gray-600 mb-2 line-clamp-2">
                        {plan.concept}
                      </p>
                    )}
                    
                    <div className="flex flex-wrap gap-4 text-sm mt-3">
                      {plan.main_copy && (
                        <div>
                          <span className="text-muted-foreground">메인 카피: </span>
                          <span className="font-medium">{plan.main_copy}</span>
                        </div>
                      )}
                      {plan.cta_text && (
                        <div>
                          <span className="text-muted-foreground">CTA: </span>
                          <Badge variant="outline">{plan.cta_text}</Badge>
                        </div>
                      )}
                    </div>
                    
                    <p className="text-xs text-muted-foreground mt-3">
                      작성일: {new Date(plan.created_at).toLocaleDateString('ko-KR')}
                    </p>
                  </div>
                  
                  <div className="flex gap-1 ml-4">
                    <Link href={`/plans/${plan.id}`}>
                      <Button variant="ghost" size="icon">
                        <Eye className="h-4 w-4" />
                      </Button>
                    </Link>
                    <Button 
                      variant="ghost" 
                      size="icon"
                      onClick={() => handleDelete(plan.id)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="text-sm text-muted-foreground">
        총 {filteredPlans.length}개의 기획서
      </div>
    </div>
  )
}
