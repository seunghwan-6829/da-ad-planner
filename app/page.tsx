'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { 
  FileText, 
  Users, 
  FileCode, 
  Plus, 
  ArrowRight,
  Image,
  Video,
  TrendingUp
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { getPlans } from '@/lib/api/plans'
import { getAdvertisers } from '@/lib/api/advertisers'
import { getTemplates } from '@/lib/api/templates'
import { AdPlan, Advertiser, Template } from '@/lib/supabase'

export default function DashboardPage() {
  const [plans, setPlans] = useState<AdPlan[]>([])
  const [advertisers, setAdvertisers] = useState<Advertiser[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    try {
      const [plansData, advertisersData, templatesData] = await Promise.all([
        getPlans(),
        getAdvertisers(),
        getTemplates()
      ])
      setPlans(plansData)
      setAdvertisers(advertisersData)
      setTemplates(templatesData)
    } catch (error) {
      console.error('데이터 로드 실패:', error)
    } finally {
      setLoading(false)
    }
  }

  const imagePlans = plans.filter(p => p.media_type === 'image').length
  const videoPlans = plans.filter(p => p.media_type === 'video').length
  const recentPlans = plans.slice(0, 5)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">로딩 중...</p>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">DA 광고 기획 플래너</h1>
        <p className="text-muted-foreground mt-2">
          이미지/영상 광고 소재 기획을 효율적으로 관리하세요
        </p>
      </div>

      {/* Quick Actions */}
      <div className="grid gap-4 md:grid-cols-3">
        <Link href="/plans/new">
          <Card className="hover:shadow-lg transition-shadow cursor-pointer border-primary/20 hover:border-primary">
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-full bg-primary/10">
                  <Plus className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold">새 기획서 작성</h3>
                  <p className="text-sm text-muted-foreground">
                    광고 소재 기획서를 작성합니다
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link href="/advertisers/new">
          <Card className="hover:shadow-lg transition-shadow cursor-pointer">
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-full bg-green-100">
                  <Users className="h-6 w-6 text-green-600" />
                </div>
                <div>
                  <h3 className="font-semibold">광고주 등록</h3>
                  <p className="text-sm text-muted-foreground">
                    브랜드 가이드라인을 등록합니다
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link href="/templates">
          <Card className="hover:shadow-lg transition-shadow cursor-pointer">
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-full bg-purple-100">
                  <FileCode className="h-6 w-6 text-purple-600" />
                </div>
                <div>
                  <h3 className="font-semibold">템플릿 관리</h3>
                  <p className="text-sm text-muted-foreground">
                    기획서 템플릿을 관리합니다
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">전체 기획서</p>
                <p className="text-3xl font-bold">{plans.length}</p>
              </div>
              <FileText className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">이미지 소재</p>
                <p className="text-3xl font-bold text-blue-600">{imagePlans}</p>
              </div>
              <Image className="h-8 w-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">영상 소재</p>
                <p className="text-3xl font-bold text-purple-600">{videoPlans}</p>
              </div>
              <Video className="h-8 w-8 text-purple-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">등록 광고주</p>
                <p className="text-3xl font-bold text-green-600">{advertisers.length}</p>
              </div>
              <Users className="h-8 w-8 text-green-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Plans & Advertisers */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent Plans */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>최근 기획서</CardTitle>
              <CardDescription>최근 작성된 기획서 목록</CardDescription>
            </div>
            <Link href="/plans">
              <Button variant="ghost" size="sm">
                전체보기 <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {recentPlans.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-muted-foreground mb-4">작성된 기획서가 없습니다</p>
                <Link href="/plans/new">
                  <Button variant="outline" size="sm">
                    첫 기획서 작성하기
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="space-y-4">
                {recentPlans.map((plan) => (
                  <Link key={plan.id} href={`/plans/${plan.id}`}>
                    <div className="flex items-center justify-between p-3 rounded-lg hover:bg-muted transition-colors">
                      <div className="flex items-center gap-3">
                        {plan.media_type === 'video' ? (
                          <Video className="h-4 w-4 text-purple-500" />
                        ) : (
                          <Image className="h-4 w-4 text-blue-500" />
                        )}
                        <div>
                          <p className="font-medium">{plan.title}</p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(plan.created_at).toLocaleDateString('ko-KR')}
                          </p>
                        </div>
                      </div>
                      <Badge variant={plan.media_type === 'video' ? 'secondary' : 'default'}>
                        {plan.media_type === 'video' ? '영상' : '이미지'}
                      </Badge>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Advertisers */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>광고주 목록</CardTitle>
              <CardDescription>등록된 광고주 및 브랜드 가이드라인</CardDescription>
            </div>
            <Link href="/advertisers">
              <Button variant="ghost" size="sm">
                전체보기 <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {advertisers.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-muted-foreground mb-4">등록된 광고주가 없습니다</p>
                <Link href="/advertisers/new">
                  <Button variant="outline" size="sm">
                    첫 광고주 등록하기
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="space-y-4">
                {advertisers.slice(0, 5).map((advertiser) => (
                  <Link key={advertiser.id} href={`/advertisers/${advertiser.id}`}>
                    <div className="flex items-center justify-between p-3 rounded-lg hover:bg-muted transition-colors">
                      <div className="flex items-center gap-3">
                        {advertiser.brand_color && (
                          <div 
                            className="w-4 h-4 rounded-full border"
                            style={{ backgroundColor: advertiser.brand_color }}
                          />
                        )}
                        <div>
                          <p className="font-medium">{advertiser.name}</p>
                          {advertiser.tone_manner && (
                            <p className="text-xs text-muted-foreground line-clamp-1">
                              {advertiser.tone_manner}
                            </p>
                          )}
                        </div>
                      </div>
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Templates Quick Access */}
      {templates.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>빠른 기획서 작성</CardTitle>
            <CardDescription>템플릿을 선택하여 빠르게 기획서를 작성하세요</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              {templates.map((template) => (
                <Link key={template.id} href={`/plans/new?template=${template.id}`}>
                  <Button variant="outline">
                    {template.media_type === 'video' ? (
                      <Video className="mr-2 h-4 w-4 text-purple-500" />
                    ) : (
                      <Image className="mr-2 h-4 w-4 text-blue-500" />
                    )}
                    {template.name}
                  </Button>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
