'use client'

import { ArrowLeft } from 'lucide-react'

// 데이터 추적 전체화면 좌상단 — 컨텐츠 디벨로퍼(da-ad-planner) 대시보드로 복귀.
// ⚠️ window.location 전체 로드(클라 내비 아님): pulseboard 전역 CSS가 da-ad-planner에 남지 않도록 완전 격리.
export function PbBackBar() {
  return (
    <div className="pb-backbar">
      <button type="button" onClick={() => { window.location.href = '/' }} className="pb-back-btn">
        <ArrowLeft size={16} /> 컨텐츠 디벨로퍼로 돌아가기
      </button>
      <span className="pb-backbar-title">데이터 추적</span>
    </div>
  )
}
