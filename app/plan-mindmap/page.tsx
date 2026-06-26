'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Folder, Search, Loader2, ChevronRight, Network, Trash2, Film, Pencil } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/lib/auth-context'
import { getClients, getClientsForUser, Client } from '@/lib/api/clients'
import { getMindmaps, deleteMindmap, updateMindmap, Mindmap } from '@/lib/api/mindmaps'

// 카드 썸네일용 미디어 해석: 영상이면 첫 프레임을, 없으면 포스터/소재썸네일을.
function resolveMedia(mm: Mindmap): { url: string | null; type: string | null; poster: string | null } {
  const data = mm.data as { media?: { url?: string; type?: string; poster?: string }; nodes?: { type?: string; media_url?: string; media_type?: string; poster?: string }[] } | undefined
  const center = Array.isArray(data?.nodes) ? data!.nodes!.find((n) => n?.type === 'center') : null
  return {
    url: center?.media_url || data?.media?.url || null,
    type: center?.media_type || data?.media?.type || null,
    poster: center?.poster || data?.media?.poster || mm.source_thumb || null,
  }
}

export default function PlanMindmapPage() {
  const router = useRouter()
  const { user, isAdmin } = useAuth()

  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')

  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  const [mindmaps, setMindmaps] = useState<Mindmap[]>([])
  const [mmLoading, setMmLoading] = useState(false)

  useEffect(() => {
    loadClients()
  }, [user, isAdmin])

  async function loadClients() {
    if (!user) {
      setLoading(false)
      return
    }
    try {
      const data = isAdmin ? await getClients() : await getClientsForUser(user.id)
      setClients(data)
    } catch (e) {
      console.error('클라이언트 로드 실패:', e)
    } finally {
      setLoading(false)
    }
  }

  async function handleSelectClient(client: Client) {
    setSelectedClient(client)
    setMmLoading(true)
    try {
      setMindmaps(await getMindmaps(client.id))
    } catch (e) {
      console.error('마인드맵 로드 실패:', e)
    } finally {
      setMmLoading(false)
    }
  }

  async function handleDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirm('이 마인드맵을 삭제하시겠습니까?')) return
    try {
      await deleteMindmap(id)
      setMindmaps((prev) => prev.filter((m) => m.id !== id))
    } catch (err) {
      console.error('삭제 실패:', err)
      alert('삭제에 실패했습니다.')
    }
  }

  async function handleRename(id: string, title: string) {
    const t = title.trim() || '마인드맵'
    setMindmaps((prev) => prev.map((m) => (m.id === id ? { ...m, title: t } : m)))
    try {
      await updateMindmap(id, { title: t })
    } catch {
      alert('이름 변경에 실패했습니다.')
    }
  }

  const filteredClients = clients.filter((c) => c.name.toLowerCase().includes(searchTerm.toLowerCase()))

  if (!user) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-gray-500 dark:text-gray-400">로그인이 필요합니다.</p>
      </div>
    )
  }

  return (
    <div className="flex h-full">
      {/* 좌측: 브랜드(클라이언트) 목록 — 기획안 제작과 동일 소스(clients) */}
      <div className="w-72 border-r dark:border-gray-800 bg-gray-50 dark:bg-gray-900 flex flex-col">
        <div className="p-4 border-b dark:border-gray-800 bg-white dark:bg-gray-950">
          <h2 className="font-bold text-lg flex items-center gap-2 mb-3">
            <Network className="h-5 w-5 text-primary" />
            기획 마인드맵
          </h2>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input placeholder="브랜드 검색..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9" />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </div>
          ) : filteredClients.length === 0 ? (
            <div className="text-center py-8">
              <Folder className="h-12 w-12 mx-auto text-gray-300 mb-2" />
              <p className="text-sm text-gray-400">
                {searchTerm ? '검색 결과 없음' : "'기획안 제작'에서 브랜드를 먼저 추가하세요"}
              </p>
            </div>
          ) : (
            filteredClients.map((client) => (
              <div
                key={client.id}
                className={`flex items-center gap-2 p-3 rounded-lg cursor-pointer transition-all ${
                  selectedClient?.id === client.id ? 'bg-primary text-white shadow-md' : 'hover:bg-white dark:hover:bg-gray-900 hover:shadow-sm'
                }`}
                onClick={() => handleSelectClient(client)}
              >
                <div
                  className="w-3 h-3 rounded-full flex-shrink-0"
                  style={{ backgroundColor: selectedClient?.id === client.id ? 'white' : client.color || '#3B82F6' }}
                />
                <span className="text-sm font-medium flex-1 truncate">{client.name}</span>
                <ChevronRight className={`h-4 w-4 ${selectedClient?.id === client.id ? 'opacity-100' : 'opacity-0'}`} />
              </div>
            ))
          )}
        </div>
        <p className="px-4 py-3 text-[11px] text-gray-400 border-t dark:border-gray-800">
          브랜드는 &apos;기획안 제작&apos;과 자동 연동됩니다.
        </p>
      </div>

      {/* 우측: 선택 브랜드의 마인드맵 히스토리 (4×4 그리드) */}
      <div className="flex-1 flex flex-col bg-gray-50/50 dark:bg-gray-950">
        {selectedClient ? (
          <>
            <div className="p-6 border-b dark:border-gray-800 bg-white dark:bg-gray-950">
              <div className="flex items-center gap-3">
                <div className="w-4 h-4 rounded-full" style={{ backgroundColor: selectedClient.color || '#3B82F6' }} />
                <h2 className="text-2xl font-bold">{selectedClient.name}</h2>
                <span className="text-sm text-gray-500 dark:text-gray-400">마인드맵 {mindmaps.length}개</span>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {mmLoading ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
                </div>
              ) : mindmaps.length === 0 ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center">
                    <Network className="h-16 w-16 mx-auto text-gray-300 mb-4" />
                    <p className="text-gray-500 dark:text-gray-400 mb-1">아직 마인드맵이 없습니다.</p>
                    <p className="text-sm text-gray-400">
                      &apos;메타 광고 크롤러&apos;에서 광고를 열고 <b>기획 마인드맵</b> 버튼으로 만들 수 있어요.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                  {mindmaps.map((mm) => (
                    <MindmapCard
                      key={mm.id}
                      mm={mm}
                      color={selectedClient.color || '#3B82F6'}
                      onOpen={() => router.push(`/plan-mindmap/${mm.id}`)}
                      onDelete={(e) => handleDelete(mm.id, e)}
                      onRename={(t) => handleRename(mm.id, t)}
                    />
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <Network className="h-20 w-20 mx-auto text-gray-200 mb-4" />
              <h3 className="text-xl font-medium text-gray-400 mb-2">브랜드를 선택해주세요</h3>
              <p className="text-sm text-gray-400">
                좌측에서 브랜드를 선택하면
                <br />
                해당 브랜드의 마인드맵 히스토리가 표시됩니다.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function MindmapCard({ mm, color, onOpen, onDelete, onRename }: {
  mm: Mindmap
  color: string
  onOpen: () => void
  onDelete: (e: React.MouseEvent) => void
  onRename: (title: string) => void
}) {
  const [broken, setBroken] = useState(false)
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(mm.title || '마인드맵')
  const m = resolveMedia(mm)
  const dt = new Date(mm.created_at)
  const when = `${dt.toLocaleDateString('ko-KR')} ${dt.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}`

  return (
    <div onClick={() => !editing && onOpen()} className="group relative cursor-pointer overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm hover:shadow-lg transition-shadow">
      <div className="aspect-video w-full overflow-hidden bg-gray-100 dark:bg-gray-800">
        {m.type === 'video' && m.url && !broken ? (
          <video src={m.url} poster={m.poster || undefined} muted preload="metadata" playsInline className="pointer-events-none h-full w-full object-cover" onError={() => setBroken(true)} />
        ) : m.poster && !broken ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={m.poster} alt="" loading="lazy" className="h-full w-full object-cover" onError={() => setBroken(true)} />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1.5" style={{ background: `linear-gradient(135deg, ${color}1f, ${color}40)` }}>
            <Film className="h-6 w-6" style={{ color }} />
            <span className="line-clamp-1 px-2 text-center text-[11px] font-medium text-gray-600 dark:text-gray-300">{mm.source_brand || '소재'}</span>
          </div>
        )}
      </div>
      <div className="p-3">
        {editing ? (
          <input
            autoFocus
            value={title}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => { setEditing(false); onRename(title) }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { setEditing(false); onRename(title) }
              if (e.key === 'Escape') { setEditing(false); setTitle(mm.title || '마인드맵') }
            }}
            className="w-full rounded border border-primary/40 bg-white px-1.5 py-1 text-sm dark:bg-gray-800 dark:text-gray-100"
          />
        ) : (
          <div className="flex items-start gap-1">
            <p className="line-clamp-2 flex-1 text-sm font-semibold text-gray-800 dark:text-gray-100">{mm.title || '마인드맵'}</p>
            <button
              onClick={(e) => { e.stopPropagation(); setTitle(mm.title || '마인드맵'); setEditing(true) }}
              title="이름 변경"
              className="shrink-0 rounded p-0.5 text-gray-300 opacity-0 hover:text-primary group-hover:opacity-100"
            >
              <Pencil className="h-3 w-3" />
            </button>
          </div>
        )}
        <p className="mt-1 text-[11px] text-gray-400">{when}</p>
      </div>
      <button onClick={onDelete} title="삭제" className="absolute right-2 top-2 rounded-full bg-black/40 p-1.5 text-white opacity-0 transition-opacity hover:bg-red-500 group-hover:opacity-100">
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
