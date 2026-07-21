'use client'

import { useCallback, useEffect, useState } from 'react'
import { Ticket, Loader2, Trash2, Copy, Check, AlertTriangle, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

/* 체험 계정(1일/7일) 발급 패널 — 관리자 화면 전용.
   비밀번호는 발급 순간 딱 한 번만 볼 수 있다(서버가 해시로만 보관).
   그래서 발급 결과를 화면에 크게 띄우고, 복사 버튼을 붙이고, 새로고침 전까지 유지한다. */

type TrialAccount = {
  id: string
  email: string
  name: string | null
  trial_label: string | null
  trial_expires_at: string | null
  created_at: string
  expired: boolean
  hours_left: number | null
}
type Issued = { id: string; email: string; password: string; days: number; expires_at: string; label: string }

function fmt(ts: string | null) {
  if (!ts) return '-'
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}. ${p(d.getHours())}:${p(d.getMinutes())}`
}

function CopyBtn({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setDone(true)
          setTimeout(() => setDone(false), 1500)
        } catch {}
      }}
      className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800"
      title={`${label} 복사`}
    >
      {done ? <Check className="h-3 w-3 text-green-600" /> : <Copy className="h-3 w-3" />}
      {done ? '복사됨' : '복사'}
    </button>
  )
}

export function TrialAccountsPanel() {
  const [accounts, setAccounts] = useState<TrialAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [issuing, setIssuing] = useState<number | null>(null)
  const [issued, setIssued] = useState<Issued | null>(null)
  const [label, setLabel] = useState('')
  const [error, setError] = useState('')
  const [revoking, setRevoking] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/admin/trial-accounts')
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || '불러오기 실패')
      setAccounts(j.accounts || [])
      setError('')
    } catch (e) {
      setError(String((e as Error).message || e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function issue(days: number) {
    setIssuing(days)
    setError('')
    try {
      const r = await fetch('/api/admin/trial-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days, label: label.trim() }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || '발급 실패')
      setIssued(j.account)
      setLabel('')
      void load()
    } catch (e) {
      setError(String((e as Error).message || e))
    } finally {
      setIssuing(null)
    }
  }

  async function revoke(a: TrialAccount) {
    if (!confirm(`체험 계정 ${a.email} 을(를) 지금 회수할까요?\n계정이 삭제되어 즉시 로그인할 수 없게 됩니다.`)) return
    setRevoking(a.id)
    try {
      const r = await fetch(`/api/admin/trial-accounts?id=${encodeURIComponent(a.id)}`, { method: 'DELETE' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || '회수 실패')
      void load()
    } catch (e) {
      setError(String((e as Error).message || e))
    } finally {
      setRevoking(null)
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Ticket className="h-5 w-5" /> 체험 계정 발급
          </CardTitle>
          <CardDescription>
            아이디·비밀번호를 만들어 외부인에게 전달하는 용도예요. 크롤러 3종 열람과 기획 마인드맵·AI 분석만 가능하고,
            네이버 카페 자동화 · 기획안 제작 · 데이터 추적 · 인스타 성과는 열리지 않습니다. 광고주 추가·삭제도 막혀 있어요.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[200px]">
              <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">메모 (누구에게 줬는지 — 선택)</label>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="예: 김대표님 / A업체 미팅"
                maxLength={60}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-900"
              />
            </div>
            <Button onClick={() => issue(1)} disabled={issuing !== null}>
              {issuing === 1 ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              1일 계정 발급
            </Button>
            <Button onClick={() => issue(7)} disabled={issuing !== null} variant="outline">
              {issuing === 7 ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              7일 계정 발급
            </Button>
          </div>

          {error && (
            <p className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
            </p>
          )}

          {issued && (
            <div className="rounded-xl border-2 border-primary/40 bg-primary/5 p-4">
              <p className="mb-3 flex items-center gap-2 text-sm font-bold">
                <Check className="h-4 w-4 text-green-600" />
                {issued.days}일 체험 계정이 발급됐어요{issued.label ? ` — ${issued.label}` : ''}
              </p>
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-16 text-xs text-gray-500">아이디</span>
                  <code className="flex-1 min-w-[220px] rounded-md bg-white px-3 py-2 font-mono text-sm dark:bg-gray-900">{issued.email}</code>
                  <CopyBtn text={issued.email} label="아이디" />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-16 text-xs text-gray-500">비밀번호</span>
                  <code className="flex-1 min-w-[220px] rounded-md bg-white px-3 py-2 font-mono text-sm dark:bg-gray-900">{issued.password}</code>
                  <CopyBtn text={issued.password} label="비밀번호" />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-16 text-xs text-gray-500">둘 다</span>
                  <CopyBtn text={`아이디: ${issued.email}\n비밀번호: ${issued.password}\n만료: ${fmt(issued.expires_at)}`} label="전체" />
                  <span className="text-xs text-gray-500">만료 {fmt(issued.expires_at)}</span>
                </div>
              </div>
              <p className="mt-3 flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                비밀번호는 지금만 볼 수 있어요. 이 화면을 벗어나면 다시 확인할 수 없으니 지금 복사해서 전달해 주세요.
              </p>
              <button onClick={() => setIssued(null)} className="mt-2 text-xs text-gray-500 underline">
                확인했어요 (닫기)
              </button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">발급된 체험 계정 {accounts.length > 0 && `(${accounts.length})`}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="flex items-center gap-2 py-6 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> 불러오는 중…</p>
          ) : accounts.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-500">아직 발급한 체험 계정이 없어요.</p>
          ) : (
            <div className="space-y-2">
              {accounts.map((a) => (
                <div key={a.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                  <div className="min-w-[240px] flex-1">
                    <p className="font-mono text-sm">{a.email}</p>
                    <p className="text-xs text-gray-500">
                      {a.trial_label ? `${a.trial_label} · ` : ''}발급 {fmt(a.created_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {a.expired ? (
                      <Badge variant="secondary" className="bg-gray-100 text-gray-500">만료됨</Badge>
                    ) : (
                      <Badge className="bg-green-100 text-green-700 hover:bg-green-100">
                        <Clock className="mr-1 h-3 w-3" />
                        {a.hours_left != null && a.hours_left >= 24 ? `${Math.floor(a.hours_left / 24)}일 ${a.hours_left % 24}시간 남음` : `${a.hours_left ?? 0}시간 남음`}
                      </Badge>
                    )}
                    <span className="text-xs text-gray-500">~ {fmt(a.trial_expires_at)}</span>
                    <Button size="sm" variant="ghost" onClick={() => revoke(a)} disabled={revoking === a.id} title="지금 회수(계정 삭제)">
                      {revoking === a.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 text-red-500" />}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
