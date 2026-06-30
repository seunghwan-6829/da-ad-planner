// /data-tracking 진입 시 SSR(데이터 집계) 대기 동안 즉시 표시되는 스켈레톤 → 빈 화면/렉 체감 제거.
// pulseboard CSS에 의존하지 않게 인라인 스타일로 자립 구성.
export default function Loading() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        background: '#f9fafb',
        color: '#6b7280',
        fontSize: 14,
        fontFamily: 'Pretendard, system-ui, -apple-system, sans-serif',
      }}
    >
      <span
        style={{
          width: 18,
          height: 18,
          border: '2px solid #d1d5db',
          borderTopColor: '#2563eb',
          borderRadius: '50%',
          display: 'inline-block',
          animation: 'pbspin 0.7s linear infinite',
        }}
      />
      데이터 추적 불러오는 중…
      <style>{`@keyframes pbspin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
