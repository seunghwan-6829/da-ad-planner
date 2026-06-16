import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "메타 광고 크롤러",
  description: "경쟁사 메타 광고 라이브러리 모니터링",
};

// 좌측 메뉴 패널. 기존 앱에 통합할 때는 이 사이드바 대신 기존 네비의
// '인스타 성과' 아래에 '메타 광고 크롤러' 링크를 넣으면 된다 (CLAUDE.md 참고).
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>
        <div className="shell">
          <aside className="sidebar">
            <div className="brand">📈 마케팅</div>
            <nav>
              <div className="nav-item disabled">인스타 성과</div>
              <div className="nav-item active">↳ 메타 광고 크롤러</div>
            </nav>
            <div className="sidebar-foot">
              기존 앱 통합 시: ‘인스타 성과’ 아래에
              <br />이 메뉴를 추가하세요. (CLAUDE.md)
            </div>
          </aside>
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
