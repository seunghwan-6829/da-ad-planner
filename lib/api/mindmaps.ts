import { supabase } from '@/lib/supabase'

// 마인드맵 노드(7갈래). key 는 고정, label/items 는 AI 생성.
export type MindmapNodeKey =
  | 'develop'      // 디벨롭할 부분
  | 'storytelling' // 스토리텔링
  | 'script'       // 대본
  | 'plan'         // 기획안
  | 'segment'      // 세그먼트(반응 좋을 타겟 역추적)
  | 'weakness'     // 못한 점
  | 'strength'     // 잘한 점

export interface MindmapNode {
  key: MindmapNodeKey
  label: string
  items: string[]
}

// AI(생성/레거시) 출력 형태
export interface MindmapData {
  summary?: string
  nodes: MindmapNode[]
  charts?: { title?: string; kind?: 'bar' | 'line'; data?: { label: string; value: number }[] }[]
  narration?: string
  media?: { url?: string | null; type?: string | null; poster?: string | null }
}

// ── v2 편집 캔버스 그래프 모델(노드 좌표 + 연결선) ──
export type MMNodeType = 'center' | 'category' | 'item' | 'note' | 'chart' | 'narration' | 'image'
export interface MMChart {
  kind: 'bar' | 'line'
  data: { label: string; value: number }[]
}
export interface MMNode {
  id: string
  type: MMNodeType
  x: number
  y: number
  w?: number
  h?: number
  title?: string
  text?: string
  items?: string[]
  color?: string
  key?: string
  media_url?: string | null
  media_type?: string | null
  poster?: string | null
  chart?: MMChart
}
export interface MMEdge {
  id: string
  from: string
  to: string
}
export interface MMDoc {
  version: 2
  summary?: string
  nodes: MMNode[]
  edges: MMEdge[]
}

export interface Mindmap {
  id: string
  client_id: string
  library_id: string | null
  title: string | null
  source_brand: string | null
  source_thumb: string | null
  data: MindmapData | MMDoc
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface CreateMindmapInput {
  client_id: string
  library_id?: string | null
  title?: string | null
  source_brand?: string | null
  source_thumb?: string | null
  data: MindmapData | MMDoc
  created_by?: string | null
}

// 브랜드(클라이언트)별 마인드맵 히스토리 (최신순)
export async function getMindmaps(clientId: string): Promise<Mindmap[]> {
  const { data, error } = await supabase
    .from('plan_mindmaps')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data || []
}

export async function getMindmap(id: string): Promise<Mindmap | null> {
  const { data, error } = await supabase
    .from('plan_mindmaps')
    .select('*')
    .eq('id', id)
    .single()

  if (error) return null
  return data
}

export async function createMindmap(input: CreateMindmapInput): Promise<Mindmap> {
  const { data, error } = await supabase
    .from('plan_mindmaps')
    .insert([input])
    .select()
    .single()

  if (error) throw error
  return data
}

export async function updateMindmap(id: string, patch: Partial<CreateMindmapInput>): Promise<Mindmap> {
  const { data, error } = await supabase
    .from('plan_mindmaps')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function deleteMindmap(id: string): Promise<void> {
  const { error } = await supabase.from('plan_mindmaps').delete().eq('id', id)
  if (error) throw error
}
