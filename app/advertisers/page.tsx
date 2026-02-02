'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Plus, Search, Trash2, Edit } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getAdvertisers, deleteAdvertiser } from '@/lib/api/advertisers'
import { Advertiser } from '@/lib/supabase'

export default function AdvertisersPage() {
  const [advertisers, setAdvertisers] = useState<Advertiser[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadAdvertisers()
  }, [])

  async function loadAdvertisers() {
    try {
      const data = await getAdvertisers()
      setAdvertisers(data)
    } catch (error) {
      console.error('광고주 목록 로드 실패:', error)
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('정말 삭제하시겠습니까?')) return
    
    try {
      await deleteAdvertiser(id)
      setAdvertisers(advertisers.filter(a => a.id !== id))
    } catch (error) {
      console.error('삭제 실패:', error)
      alert('삭제에 실패했습니다.')
    }
  }

  const filteredAdvertisers = advertisers.filter(a =>
    a.name.toLowerCase().includes(searchTerm.toLowerCase())
  )

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
          <h1 className="text-3xl font-bold">광고주 관리</h1>
          <p className="text-muted-foreground mt-1">
            광고주별 지침서와 제품 정보를 관리합니다
          </p>
        </div>
        <Link href="/advertisers/new">
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            광고주 등록
          </Button>
        </Link>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="광고주 검색..."
          className="pl-10"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {filteredAdvertisers.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">
              {searchTerm ? '검색 결과가 없습니다.' : '등록된 광고주가 없습니다.'}
            </p>
            {!searchTerm && (
              <Link href="/advertisers/new">
                <Button variant="outline" className="mt-4">
                  첫 광고주 등록하기
                </Button>
              </Link>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredAdvertisers.map((advertiser) => (
            <Card key={advertiser.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <CardTitle className="text-lg">{advertiser.name}</CardTitle>
                  <div className="flex gap-1">
                    <Link href={`/advertisers/${advertiser.id}`}>
                      <Button variant="ghost" size="icon">
                        <Edit className="h-4 w-4" />
                      </Button>
                    </Link>
                    <Button 
                      variant="ghost" 
                      size="icon"
                      onClick={() => handleDelete(advertiser.id)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 text-sm">
                  {advertiser.products && advertiser.products.length > 0 && (
                    <div>
                      <span className="text-muted-foreground">제품: </span>
                      <span className="line-clamp-1">{advertiser.products.join(', ')}</span>
                    </div>
                  )}
                  <div className="flex gap-2">
                    {advertiser.guidelines_image && (
                      <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">이미지 지침</span>
                    )}
                    {advertiser.guidelines_video && (
                      <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded">영상 지침</span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground pt-2">
                    등록일: {new Date(advertiser.created_at).toLocaleDateString('ko-KR')}
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
