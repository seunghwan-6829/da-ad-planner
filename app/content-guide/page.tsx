'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Folder, Search, Loader2, ChevronRight, Film, Trash2, Pencil } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/lib/auth-context'
import { getClients, getClientsForUser, Client } from '@/lib/api/clients'
import { getContentGuides, deleteContentGuide, updateContentGuide, ContentGuide } from '@/lib/api/content-guides'

function thumbOf(cg: ContentGuide): string | null {
  if (cg.source_thumb) return cg.source_thumb
  const first = cg.data?.scenes?.find((s) => s.image)?.image
  return first || null
}

export default function ContentGuideListPage() {
  const router = useRouter()
  const { user, isAdmin } = useAuth()

  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  const [guides, setGuides] = useState<ContentGuide[]>([])
  const [gLoading, setGLoading] = useState(false)

  useEffect(() => { loadClients() }, [user, isAdmin])

  async function loadClients() {
    if (!user) { setLoading(false); return }
    try {
      setClients(isAdmin ? await getClients() : await getClientsForUser(user.id))
    } catch (e) {
      console.error('클라이언트 로드 실패:', e)
    } finally {
      setLoading(false)
    }
  }

  async function handleSelectClient(client: Client) {
    setSelectedClient(client)
    setGLoading(true)
    try { setGuides(await getContentGuides(client.id)) } catch (e) { console.error(e) } finally { setGLoading(false) }
  }

  async function handleDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirm('이 컨텐츠 가이드를 삭제할까요?')) return
    try { await deleteContentGuide(id); setGuides((p) => p.filter((g) => g.id !== id)) } catch { alert('삭제 실패') }
  }

  async function handleRename(id: string, title: string) {
    const t = title.trim() || '컨텐츠 가이드'
    setGuides((p) => p.map((g) => (g.id === id ? { ...g, title: t } : g)))
    try { await updateContentGuide(id, { title: t }) } catch { alert('이름 변경 실패') }
  }

  const filteredClients = clients.filter((c) => c.name.toLowerCase().includes(searchTerm.toLowerCase()))

  if (!user) return <div className="flex h-full items-center justify-center"><p className="text-gray-500 dark:text-gray-400">로그인이 필요합니다.</p></div>

  return (
    <div className="flex h-full">
      {/* 좌: 브랜드(클라이언트) */}
      <div className="flex w-72 flex-col border-r bg-gray-50 dark:border-gray-800 dark:bg-gray-900">
        <div className="border-b bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-bold"><Film className="h-5 w-5 text-primary" /> 컨텐츠 가이드</h2>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input placeholder="브랜드 검색..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9" />
          </div>
        </div>
        <div className="flex-1 space-y-1 overflow-y-auto p-2">
          {loading ? (
            <div className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
          ) : filteredClients.length === 0 ? (
            <div className="py-8 text-center">
              <Folder className="mx-auto mb-2 h-12 w-12 text-gray-300" />
              <p className="text-sm text-gray-400">{searchTerm ? '검색 결과 없음' : "'기획안 제작'에서 브랜드를 먼저 추가하세요"}</p>
            </div>
          ) : (
            filteredClients.map((client) => (
              <div
                key={client.id}
                onClick={() => handleSelectClient(client)}
                className={`flex cursor-pointer items-center gap-2 rounded-lg p-3 transition-all ${selectedClient?.id === client.id ? 'bg-primary text-white shadow-md' : 'hover:bg-white hover:shadow-sm dark:hover:bg-gray-900'}`}
              >
                <div className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: selectedClient?.id === client.id ? 'white' : client.color || '#3B82F6' }} />
                <span className="flex-1 truncate text-sm font-medium">{client.name}</span>
                <ChevronRight className={`h-4 w-4 ${selectedClient?.id === client.id ? 'opacity-100' : 'opacity-0'}`} />
              </div>
            ))
          )}
        </div>
        <p className="border-t px-4 py-3 text-[11px] text-gray-400 dark:border-gray-800">브랜드는 &apos;기획안 제작&apos;과 자동 연동됩니다.</p>
      </div>

      {/* 우: 선택 브랜드의 컨텐츠 가이드 */}
      <div className="flex flex-1 flex-col bg-gray-50/50 dark:bg-gray-950">
        {selectedClient ? (
          <>
            <div className="border-b bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
              <div className="flex items-center gap-3">
                <div className="h-4 w-4 rounded-full" style={{ backgroundColor: selectedClient.color || '#3B82F6' }} />
                <h2 className="text-2xl font-bold">{selectedClient.name}</h2>
                <span className="text-sm text-gray-500 dark:text-gray-400">컨텐츠 가이드 {guides.length}개</span>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {gLoading ? (
                <div className="flex h-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-gray-400" /></div>
              ) : guides.length === 0 ? (
                <div className="flex h-full items-center justify-center">
                  <div className="text-center">
                    <Film className="mx-auto mb-4 h-16 w-16 text-gray-300" />
                    <p className="mb-1 text-gray-500 dark:text-gray-400">아직 컨텐츠 가이드가 없습니다.</p>
                    <p className="text-sm text-gray-400">&apos;메타 광고 크롤러&apos;에서 광고를 열고 <b>컨텐츠 가이드</b> 버튼으로 만들 수 있어요.</p>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                  {guides.map((cg) => (
                    <GuideCard key={cg.id} cg={cg} color={selectedClient.color || '#3B82F6'} onOpen={() => router.push(`/content-guide/${cg.id}`)} onDelete={(e) => handleDelete(cg.id, e)} onRename={(t) => handleRename(cg.id, t)} />
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center">
              <Film className="mx-auto mb-4 h-20 w-20 text-gray-200" />
              <h3 className="mb-2 text-xl font-medium text-gray-400">브랜드를 선택해주세요</h3>
              <p className="text-sm text-gray-400">좌측에서 브랜드를 선택하면<br />해당 브랜드의 컨텐츠 가이드가 표시됩니다.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function GuideCard({ cg, color, onOpen, onDelete, onRename }: { cg: ContentGuide; color: string; onOpen: () => void; onDelete: (e: React.MouseEvent) => void; onRename: (t: string) => void }) {
  const [broken, setBroken] = useState(false)
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(cg.title || '컨텐츠 가이드')
  const thumb = thumbOf(cg)
  const dt = new Date(cg.created_at)
  const when = `${dt.toLocaleDateString('ko-KR')} ${dt.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}`
  return (
    <div onClick={() => !editing && onOpen()} className="group relative cursor-pointer overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition-shadow hover:shadow-lg dark:border-gray-800 dark:bg-gray-900">
      <div className="aspect-[9/16] w-full overflow-hidden bg-gray-100 dark:bg-gray-800">
        {thumb && !broken ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb} alt="" loading="lazy" className="h-full w-full object-cover" onError={() => setBroken(true)} />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1.5" style={{ background: `linear-gradient(135deg, ${color}1f, ${color}40)` }}>
            <Film className="h-6 w-6" style={{ color }} />
            <span className="line-clamp-1 px-2 text-center text-[11px] font-medium text-gray-600 dark:text-gray-300">{cg.source_brand || '소재'}</span>
          </div>
        )}
      </div>
      <div className="p-3">
        {editing ? (
          <input
            autoFocus value={title} onClick={(e) => e.stopPropagation()}
            onChange={(e) => setTitle(e.target.value)} onBlur={() => { setEditing(false); onRename(title) }}
            onKeyDown={(e) => { if (e.key === 'Enter') { setEditing(false); onRename(title) } if (e.key === 'Escape') { setEditing(false); setTitle(cg.title || '컨텐츠 가이드') } }}
            className="w-full rounded border border-primary/40 bg-white px-1.5 py-1 text-sm dark:bg-gray-800 dark:text-gray-100"
          />
        ) : (
          <div className="flex items-start gap-1">
            <p className="line-clamp-2 flex-1 text-sm font-semibold text-gray-800 dark:text-gray-100">{cg.title || '컨텐츠 가이드'}</p>
            <button onClick={(e) => { e.stopPropagation(); setTitle(cg.title || '컨텐츠 가이드'); setEditing(true) }} title="이름 변경" className="shrink-0 rounded p-0.5 text-gray-300 opacity-0 hover:text-primary group-hover:opacity-100"><Pencil className="h-3 w-3" /></button>
          </div>
        )}
        <p className="mt-1 text-[11px] text-gray-400">씬 {cg.data?.scenes?.length || 0}개 · {when}</p>
      </div>
      <button onClick={onDelete} title="삭제" className="absolute right-2 top-2 rounded-full bg-black/40 p-1.5 text-white opacity-0 transition-opacity hover:bg-red-500 group-hover:opacity-100"><Trash2 className="h-3.5 w-3.5" /></button>
    </div>
  )
}
