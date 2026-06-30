import '../pb-styles.css'
import '../pb-theme.css'
import { HeatmapClient } from '@/components/pb/HeatmapClient'
import { getHeatmapData } from '@/lib/pb/heatmap-data'
import { PbBackBar } from '../back-bar'

export const dynamic = 'force-dynamic'

type Props = { searchParams?: Promise<Record<string, string | string[] | undefined>> }

export default async function PbHeatmapPage({ searchParams }: Props) {
  const resolved = (await searchParams) ?? {}
  const project = typeof resolved.project === 'string' ? resolved.project : undefined
  const start = typeof resolved.start === 'string' ? resolved.start : undefined
  const end = typeof resolved.end === 'string' ? resolved.end : undefined
  const preset = typeof resolved.preset === 'string' ? resolved.preset : undefined
  const page = typeof resolved.page === 'string' ? resolved.page : undefined
  const device = typeof resolved.device === 'string' ? resolved.device : undefined
  const secret = typeof resolved.secret === 'string' ? resolved.secret : undefined
  const data = await getHeatmapData(project, start, end, preset, page, device)

  return (
    <div className="pb-app">
      <PbBackBar />
      <HeatmapClient data={data} initialSecretMode={secret} />
    </div>
  )
}
