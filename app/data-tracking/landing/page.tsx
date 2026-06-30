import '../pb-styles.css'
import '../pb-theme.css'
import { LandingAnalysisClient } from '@/components/pb/LandingAnalysisClient'
import { getLandingAnalysisData } from '@/lib/pb/landing-analysis'

export const dynamic = 'force-dynamic'

export default async function PbLandingPage() {
  const data = await getLandingAnalysisData()
  return (
    <div className="pb-app">
      <LandingAnalysisClient initialData={data} />
    </div>
  )
}
