import '../pb-styles.css'
import '../pb-theme.css'
import { LandingAnalysisClient } from '@/components/pb/LandingAnalysisClient'
import { getLandingAnalysisData } from '@/lib/pb/landing-analysis'
import { PbBackBar } from '../back-bar'

export const dynamic = 'force-dynamic'

export default async function PbLandingPage() {
  const data = await getLandingAnalysisData()
  return (
    <div className="pb-app">
      <PbBackBar />
      <LandingAnalysisClient initialData={data} />
    </div>
  )
}
