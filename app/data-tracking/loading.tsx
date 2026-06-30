// /data-tracking 진입 즉시 표시되는 로딩 화면.
// ⚠️ 이 파일이 없으면 Next가 "데이터 준비될 때까지 이전 페이지(대시보드)를 그대로 띄워" → '데이터 추적' 눌러도
//    로딩 동안 대시보드 화면 + 대시보드 active 가 유지됨. 이 파일이 있으면 클릭 즉시 라우트가 바뀌어 '데이터 추적'이 활성화됨.
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
