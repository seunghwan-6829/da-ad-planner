import './pb-styles.css'
import './pb-theme.css'
import { ProjectWorkspaceClient } from '@/components/pb/ProjectWorkspaceClient'
import { getWorkspaceData } from '@/lib/pb/home-data'

export const dynamic = 'force-dynamic'

type Props = { searchParams?: Promise<Record<string, string | string[] | undefined>> }

export default async function DataTrackingPage({ searchParams }: Props) {
  const resolved = (await searchParams) ?? {}
  const start = typeof resolved.start === 'string' ? resolved.start : undefined
  const end = typeof resolved.end === 'string' ? resolved.end : undefined
  const preset = typeof resolved.preset === 'string' ? resolved.preset : undefined
  const projectId = typeof resolved.project === 'string' ? resolved.project : undefined
  const data = await getWorkspaceData(true, start, end, preset)

  return (
    <div className="pb-app">
      <ProjectWorkspaceClient initialData={data} initialSelectedProjectId={projectId} />
    </div>
  )
}
