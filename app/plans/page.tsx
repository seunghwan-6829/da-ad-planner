'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Plus, Search, Trash2, Image, Video } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Card, CardContent } from '@/components/ui/card'
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

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.preventDefault()
    e.stopPropagation()
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
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {filteredPlans.map((plan) => (
            <Link key={plan.id} href={`/plans/${plan.id}`}>
              <Card className="hover:shadow-md transition-shadow cursor-pointer h-full group">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    {plan.media_type === 'video' ? (
                      <Video className="h-4 w-4 text-purple-500 flex-shrink-0" />
                    ) : (
                      <Image className="h-4 w-4 text-blue-500 flex-shrink-0" />
                    )}
                    <Badge variant={plan.media_type === 'video' ? 'secondary' : 'default'} className="text-xs">
                      {plan.media_type === 'video' ? '영상' : '이미지'}
                    </Badge>
                  </div>
                  
                  <h3 className="font-semibold text-sm line-clamp-2 mb-2 group-hover:text-primary transition-colors">
                    {plan.title}
                  </h3>
                  
                  {(plan.advertiser as unknown as { name: string })?.name && (
                    <p className="text-xs text-muted-foreground mb-2">
                      {(plan.advertiser as unknown as { name: string }).name}
                    </p>
                  )}
                  
                  <div className="flex items-center justify-between mt-auto pt-2 border-t">
                    <span className="text-xs text-muted-foreground">
                      {new Date(plan.created_at).toLocaleDateString('ko-KR')}
                    </span>
                    <Button 
                      variant="ghost" 
                      size="sm"
                      className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => handleDelete(e, plan.id)}
                    >
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <div className="text-sm text-muted-foreground">
        총 {filteredPlans.length}개의 기획서
      </div>
    </div>
  )
}
