'use client'

import { useState, useEffect } from 'react'
import {
  BarChart3,
  Loader2,
  Plus,
  Trash2,
  RefreshCw,
  Users,
  Heart,
  Eye,
  MessageCircle,
  Image as ImageIcon,
  TrendingUp,
  AlertCircle,
  ExternalLink,
  Key,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/lib/auth-context'

interface InstagramAccount {
  id: string
  username: string
  accessToken: string
  name?: string
  profilePicture?: string
  followersCount?: number
  mediaCount?: number
  followsCount?: number
}

interface InstagramMedia {
  id: string
  caption?: string
  media_type: string
  timestamp: string
  like_count?: number
  comments_count?: number
  permalink?: string
  thumbnail_url?: string
  media_url?: string
}

interface AccountInsights {
  followers: number
  follows: number
  mediaCount: number
  recentMedia: InstagramMedia[]
}

export default function InstagramPage() {
  const { user } = useAuth()
  const [accounts, setAccounts] = useState<InstagramAccount[]>([])
  const [selectedAccount, setSelectedAccount] = useState<InstagramAccount | null>(null)
  const [insights, setInsights] = useState<AccountInsights | null>(null)
  const [insightsLoading, setInsightsLoading] = useState(false)

  // 계정 추가
  const [showAddForm, setShowAddForm] = useState(false)
  const [newUsername, setNewUsername] = useState('')
  const [newToken, setNewToken] = useState('')
  const [addLoading, setAddLoading] = useState(false)
  const [error, setError] = useState('')

  // localStorage에서 계정 로드
  useEffect(() => {
    if (!user) return
    const saved = localStorage.getItem(`instagram_accounts_${user.id}`)
    if (saved) {
      try {
        setAccounts(JSON.parse(saved))
      } catch {}
    }
  }, [user])

  // 계정 저장
  function saveAccounts(accs: InstagramAccount[]) {
    if (!user) return
    setAccounts(accs)
    localStorage.setItem(`instagram_accounts_${user.id}`, JSON.stringify(accs))
  }

  // 계정 추가 (Instagram Graph API 연동)
  async function handleAddAccount() {
    if (!newToken.trim()) {
      setError('액세스 토큰을 입력해주세요.')
      return
    }

    setAddLoading(true)
    setError('')

    try {
      // Instagram Graph API로 계정 정보 조회
      const res = await fetch(
        `https://graph.instagram.com/v21.0/me?fields=id,username,name,profile_picture_url,followers_count,media_count,follows_count&access_token=${newToken.trim()}`
      )

      if (!res.ok) {
        const errData = await res.json()
        throw new Error(
          errData.error?.message || '유효하지 않은 액세스 토큰입니다.'
        )
      }

      const data = await res.json()

      const newAccount: InstagramAccount = {
        id: data.id,
        username: data.username || newUsername || 'unknown',
        accessToken: newToken.trim(),
        name: data.name,
        profilePicture: data.profile_picture_url,
        followersCount: data.followers_count,
        mediaCount: data.media_count,
        followsCount: data.follows_count,
      }

      // 중복 체크
      if (accounts.find((a) => a.id === newAccount.id)) {
        setError('이미 추가된 계정입니다.')
        setAddLoading(false)
        return
      }

      saveAccounts([...accounts, newAccount])
      setNewToken('')
      setNewUsername('')
      setShowAddForm(false)
    } catch (err: any) {
      setError(err.message || '계정 연동에 실패했습니다.')
    } finally {
      setAddLoading(false)
    }
  }

  // 계정 삭제
  function handleRemoveAccount(id: string) {
    if (!confirm('이 계정을 삭제하시겠습니까?')) return
    const updated = accounts.filter((a) => a.id !== id)
    saveAccounts(updated)
    if (selectedAccount?.id === id) {
      setSelectedAccount(null)
      setInsights(null)
    }
  }

  // 계정 선택 & 인사이트 로드
  async function handleSelectAccount(account: InstagramAccount) {
    setSelectedAccount(account)
    setInsightsLoading(true)

    try {
      // 계정 기본 정보 새로고침
      const profileRes = await fetch(
        `https://graph.instagram.com/v21.0/me?fields=id,username,name,followers_count,media_count,follows_count&access_token=${account.accessToken}`
      )

      let followers = account.followersCount || 0
      let follows = account.followsCount || 0
      let mediaCount = account.mediaCount || 0

      if (profileRes.ok) {
        const profileData = await profileRes.json()
        followers = profileData.followers_count || 0
        follows = profileData.follows_count || 0
        mediaCount = profileData.media_count || 0
      }

      // 최근 미디어 조회
      const mediaRes = await fetch(
        `https://graph.instagram.com/v21.0/me/media?fields=id,caption,media_type,timestamp,like_count,comments_count,permalink,thumbnail_url,media_url&limit=12&access_token=${account.accessToken}`
      )

      let recentMedia: InstagramMedia[] = []
      if (mediaRes.ok) {
        const mediaData = await mediaRes.json()
        recentMedia = mediaData.data || []
      }

      setInsights({ followers, follows, mediaCount, recentMedia })
    } catch (err) {
      console.error('인사이트 로드 실패:', err)
    } finally {
      setInsightsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <div className="flex h-screen">
        {/* 왼쪽 계정 목록 */}
        <div className="w-72 border-r bg-white dark:bg-gray-900 dark:border-gray-800 flex flex-col">
          <div className="p-4 border-b dark:border-gray-800">
            <div className="flex items-center gap-2 mb-1">
              <BarChart3 className="h-5 w-5 text-pink-500" />
              <h1 className="text-lg font-bold dark:text-white">인스타 성과</h1>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              인스타그램 계정별 성과 대시보드
            </p>
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            {accounts.map((account) => (
              <div
                key={account.id}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg mb-1 cursor-pointer transition-colors group ${
                  selectedAccount?.id === account.id
                    ? 'bg-pink-500 text-white'
                    : 'hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
                onClick={() => handleSelectAccount(account)}
              >
                {account.profilePicture ? (
                  <img
                    src={account.profilePicture}
                    alt=""
                    className="w-8 h-8 rounded-full"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white text-xs font-bold">
                    {account.username[0]?.toUpperCase()}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p
                    className={`text-sm font-medium truncate ${
                      selectedAccount?.id === account.id
                        ? ''
                        : 'dark:text-gray-200'
                    }`}
                  >
                    @{account.username}
                  </p>
                  {account.followersCount !== undefined && (
                    <p
                      className={`text-xs ${
                        selectedAccount?.id === account.id
                          ? 'text-pink-200'
                          : 'text-gray-400 dark:text-gray-500'
                      }`}
                    >
                      팔로워 {account.followersCount?.toLocaleString()}
                    </p>
                  )}
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleRemoveAccount(account.id)
                  }}
                  className={`opacity-0 group-hover:opacity-100 p-1 rounded transition-opacity ${
                    selectedAccount?.id === account.id
                      ? 'hover:bg-pink-600'
                      : 'hover:bg-gray-200 dark:hover:bg-gray-700'
                  }`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}

            {accounts.length === 0 && !showAddForm && (
              <div className="text-center py-8">
                <BarChart3 className="h-8 w-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                <p className="text-sm text-gray-400 dark:text-gray-500 mb-3">
                  연동된 계정이 없습니다
                </p>
              </div>
            )}
          </div>

          <div className="p-3 border-t dark:border-gray-800">
            {showAddForm ? (
              <div className="space-y-2">
                <Input
                  placeholder="Instagram 액세스 토큰"
                  value={newToken}
                  onChange={(e) => setNewToken(e.target.value)}
                  type="password"
                  className="text-sm"
                />
                {error && (
                  <p className="text-xs text-red-500 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    {error}
                  </p>
                )}
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="flex-1 bg-pink-500 hover:bg-pink-600"
                    onClick={handleAddAccount}
                    disabled={addLoading}
                  >
                    {addLoading ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      '연동'
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setShowAddForm(false)
                      setError('')
                    }}
                  >
                    취소
                  </Button>
                </div>
                <a
                  href="https://developers.facebook.com/tools/explorer/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-blue-500 hover:underline justify-center"
                >
                  <Key className="h-3 w-3" />
                  토큰 발급 방법
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            ) : (
              <Button
                variant="outline"
                className="w-full dark:border-gray-700 dark:text-gray-300"
                onClick={() => setShowAddForm(true)}
              >
                <Plus className="h-4 w-4 mr-2" />
                계정 추가
              </Button>
            )}
          </div>
        </div>

        {/* 오른쪽 대시보드 */}
        <div className="flex-1 overflow-y-auto">
          {!selectedAccount ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <BarChart3 className="h-16 w-16 text-gray-200 dark:text-gray-700 mx-auto mb-4" />
                <h2 className="text-xl font-bold text-gray-400 dark:text-gray-500 mb-2">
                  계정을 선택하세요
                </h2>
                <p className="text-sm text-gray-400 dark:text-gray-500">
                  왼쪽에서 인스타그램 계정을 선택하면
                  <br />
                  성과 대시보드가 표시됩니다
                </p>
              </div>
            </div>
          ) : insightsLoading ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <Loader2 className="h-8 w-8 animate-spin text-pink-500 mx-auto mb-3" />
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  인사이트 불러오는 중...
                </p>
              </div>
            </div>
          ) : insights ? (
            <div className="p-6">
              {/* 계정 헤더 */}
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-4">
                  {selectedAccount.profilePicture ? (
                    <img
                      src={selectedAccount.profilePicture}
                      alt=""
                      className="w-14 h-14 rounded-full border-2 border-pink-300"
                    />
                  ) : (
                    <div className="w-14 h-14 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white text-xl font-bold">
                      {selectedAccount.username[0]?.toUpperCase()}
                    </div>
                  )}
                  <div>
                    <h2 className="text-xl font-bold dark:text-white">
                      @{selectedAccount.username}
                    </h2>
                    {selectedAccount.name && (
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {selectedAccount.name}
                      </p>
                    )}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleSelectAccount(selectedAccount)}
                >
                  <RefreshCw className="h-4 w-4 mr-1" />
                  새로고침
                </Button>
              </div>

              {/* 핵심 지표 카드 */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
                <div className="bg-white dark:bg-gray-900 rounded-xl border dark:border-gray-800 p-5">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-pink-100 dark:bg-pink-900/30 rounded-lg">
                      <Users className="h-5 w-5 text-pink-500" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold dark:text-white">
                        {insights.followers.toLocaleString()}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        팔로워
                      </p>
                    </div>
                  </div>
                </div>
                <div className="bg-white dark:bg-gray-900 rounded-xl border dark:border-gray-800 p-5">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                      <TrendingUp className="h-5 w-5 text-blue-500" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold dark:text-white">
                        {insights.follows.toLocaleString()}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        팔로잉
                      </p>
                    </div>
                  </div>
                </div>
                <div className="bg-white dark:bg-gray-900 rounded-xl border dark:border-gray-800 p-5">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
                      <ImageIcon className="h-5 w-5 text-purple-500" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold dark:text-white">
                        {insights.mediaCount.toLocaleString()}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        게시물
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* 최근 게시물 */}
              <div>
                <h3 className="text-lg font-bold dark:text-white mb-4">
                  최근 게시물
                </h3>
                {insights.recentMedia.length === 0 ? (
                  <div className="text-center py-12 bg-white dark:bg-gray-900 rounded-xl border dark:border-gray-800">
                    <ImageIcon className="h-10 w-10 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                    <p className="text-sm text-gray-400 dark:text-gray-500">
                      게시물이 없습니다
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {insights.recentMedia.map((media) => (
                      <div
                        key={media.id}
                        className="bg-white dark:bg-gray-900 rounded-xl border dark:border-gray-800 overflow-hidden hover:shadow-lg transition-shadow"
                      >
                        {/* 미디어 이미지 */}
                        {(media.media_url || media.thumbnail_url) && (
                          <div className="aspect-square bg-gray-100 dark:bg-gray-800">
                            <img
                              src={media.thumbnail_url || media.media_url}
                              alt=""
                              className="w-full h-full object-cover"
                            />
                          </div>
                        )}

                        <div className="p-3">
                          {/* 반응 지표 */}
                          <div className="flex items-center gap-4 mb-2">
                            <span className="flex items-center gap-1 text-sm text-gray-600 dark:text-gray-400">
                              <Heart className="h-4 w-4 text-red-400" />
                              {(media.like_count || 0).toLocaleString()}
                            </span>
                            <span className="flex items-center gap-1 text-sm text-gray-600 dark:text-gray-400">
                              <MessageCircle className="h-4 w-4 text-blue-400" />
                              {(media.comments_count || 0).toLocaleString()}
                            </span>
                          </div>

                          {/* 캡션 */}
                          {media.caption && (
                            <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2">
                              {media.caption}
                            </p>
                          )}

                          {/* 날짜 */}
                          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                            {new Date(media.timestamp).toLocaleDateString(
                              'ko-KR'
                            )}
                          </p>

                          {media.permalink && (
                            <a
                              href={media.permalink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 text-xs text-pink-500 hover:underline mt-2"
                            >
                              인스타에서 보기
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
