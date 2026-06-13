'use client'

import { useState, useEffect } from 'react'
import { User, Key, Moon, Sun, Save, Loader2, Eye, EyeOff, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { useAuth } from '@/lib/auth-context'
import { useTheme } from '@/lib/theme-context'
import { getUserSettings, upsertUserSettings } from '@/lib/api/user-settings'

export default function MyPage() {
  const { user, profile } = useAuth()
  const { theme, setTheme } = useTheme()

  const [apiKey, setApiKey] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)

  const [openaiKey, setOpenaiKey] = useState('')
  const [showOpenaiKey, setShowOpenaiKey] = useState(false)
  const [savingOpenai, setSavingOpenai] = useState(false)
  const [savedOpenai, setSavedOpenai] = useState(false)

  useEffect(() => {
    if (user) loadSettings()
  }, [user])

  async function loadSettings() {
    if (!user) return
    try {
      const settings = await getUserSettings(user.id)
      if (settings) {
        setApiKey(settings.anthropic_api_key || '')
        setOpenaiKey(settings.openai_api_key || '')
        if (settings.theme) {
          setTheme(settings.theme)
        }
      }
    } catch (error) {
      console.error('설정 로드 실패:', error)
    } finally {
      setLoading(false)
    }
  }

  async function handleSaveApiKey() {
    if (!user) return
    setSaving(true)
    try {
      await upsertUserSettings(user.id, { anthropic_api_key: apiKey || null })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (error) {
      console.error('API 키 저장 실패:', error)
      alert('저장에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveOpenaiKey() {
    if (!user) return
    setSavingOpenai(true)
    try {
      await upsertUserSettings(user.id, { openai_api_key: openaiKey || null })
      setSavedOpenai(true)
      setTimeout(() => setSavedOpenai(false), 2000)
    } catch (error) {
      console.error('OpenAI API 키 저장 실패:', error)
      alert('저장에 실패했습니다.')
    } finally {
      setSavingOpenai(false)
    }
  }

  async function handleThemeChange(newTheme: 'light' | 'dark') {
    setTheme(newTheme)
    if (user) {
      try {
        await upsertUserSettings(user.id, { theme: newTheme })
      } catch (error) {
        console.error('테마 저장 실패:', error)
      }
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold dark:text-white">마이페이지</h1>
        <p className="text-muted-foreground mt-1">계정 설정 및 환경 설정을 관리합니다.</p>
      </div>

      {/* 프로필 정보 */}
      <Card className="dark:bg-gray-900 dark:border-gray-800">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 dark:text-white">
            <User className="h-5 w-5" />
            프로필 정보
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-gray-500 dark:text-gray-400">이메일</label>
              <p className="mt-1 text-sm dark:text-gray-200">{profile?.email || '-'}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-500 dark:text-gray-400">이름</label>
              <p className="mt-1 text-sm dark:text-gray-200">{profile?.name || '-'}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-500 dark:text-gray-400">권한</label>
              <p className="mt-1 text-sm dark:text-gray-200">
                {profile?.role === 'admin' ? '관리자' : profile?.role === 'approved' ? '승인됨' : '승인 대기중'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* API 키 설정 */}
      <Card className="dark:bg-gray-900 dark:border-gray-800">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 dark:text-white">
            <Key className="h-5 w-5" />
            AI API 키 설정
          </CardTitle>
          <CardDescription>
            Anthropic API 키를 입력하면 AI 기능을 사용할 수 있습니다. 키는 본인만 사용할 수 있으며 안전하게 저장됩니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium dark:text-gray-300">Anthropic API Key</label>
            <div className="mt-1 flex gap-2">
              <div className="relative flex-1">
                <Input
                  type={showApiKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-ant-api03-..."
                  className="pr-10 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-200"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <Button onClick={handleSaveApiKey} disabled={saving} className="min-w-[80px]">
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : saved ? (
                  <>
                    <Check className="h-4 w-4 mr-1" />
                    완료
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4 mr-1" />
                    저장
                  </>
                )}
              </Button>
            </div>
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-500">
              API 키가 없으면 AI 기능을 사용할 수 없습니다. <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer" className="text-primary underline">Anthropic Console</a>에서 발급받을 수 있습니다.
            </p>
          </div>

          <div className="pt-2 border-t dark:border-gray-800">
            <label className="text-sm font-medium dark:text-gray-300">OpenAI API Key</label>
            <div className="mt-1 flex gap-2">
              <div className="relative flex-1">
                <Input
                  type={showOpenaiKey ? 'text' : 'password'}
                  value={openaiKey}
                  onChange={(e) => setOpenaiKey(e.target.value)}
                  placeholder="sk-proj-..."
                  className="pr-10 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-200"
                />
                <button
                  type="button"
                  onClick={() => setShowOpenaiKey(!showOpenaiKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showOpenaiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <Button onClick={handleSaveOpenaiKey} disabled={savingOpenai} className="min-w-[80px]">
                {savingOpenai ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : savedOpenai ? (
                  <>
                    <Check className="h-4 w-4 mr-1" />
                    완료
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4 mr-1" />
                    저장
                  </>
                )}
              </Button>
            </div>
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-500">
              촬영 가이드의 레퍼런스 컷 이미지 생성에 사용됩니다. <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-primary underline">OpenAI Platform</a>에서 발급받을 수 있습니다.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* 테마 설정 */}
      <Card className="dark:bg-gray-900 dark:border-gray-800">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 dark:text-white">
            {theme === 'dark' ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
            테마 설정
          </CardTitle>
          <CardDescription>화면 테마를 선택합니다.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3">
            <button
              onClick={() => handleThemeChange('light')}
              className={`flex-1 flex items-center justify-center gap-2 p-4 rounded-xl border-2 transition-all ${
                theme === 'light'
                  ? 'border-primary bg-primary/5 dark:bg-primary/10'
                  : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
              }`}
            >
              <Sun className={`h-5 w-5 ${theme === 'light' ? 'text-primary' : 'text-gray-400'}`} />
              <span className={`font-medium ${theme === 'light' ? 'text-primary' : 'text-gray-500 dark:text-gray-400'}`}>
                라이트 모드
              </span>
            </button>
            <button
              onClick={() => handleThemeChange('dark')}
              className={`flex-1 flex items-center justify-center gap-2 p-4 rounded-xl border-2 transition-all ${
                theme === 'dark'
                  ? 'border-primary bg-primary/5 dark:bg-primary/10'
                  : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
              }`}
            >
              <Moon className={`h-5 w-5 ${theme === 'dark' ? 'text-primary' : 'text-gray-400'}`} />
              <span className={`font-medium ${theme === 'dark' ? 'text-primary' : 'text-gray-500 dark:text-gray-400'}`}>
                다크 모드
              </span>
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
