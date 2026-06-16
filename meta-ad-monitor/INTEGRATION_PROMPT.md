# 통합 요청 프롬프트

기존 마케팅 웹앱 프로젝트를 다른 곳에서 열고, `meta-ad-monitor/` 폴더를 그 안에
복사해 넣은 뒤, 아래 내용을 그대로 붙여넣으세요.

---

```
우리 기존 마케팅 웹앱에 경쟁사 메타 광고 크롤러를 통합해줘.
이 저장소에 `meta-ad-monitor/` 폴더가 들어있어 (크롤러 + 대시보드 코드).
폴더가 안 보이면 멈추고 나한테 위치를 물어봐.

[먼저 반드시 읽기]
1. meta-ad-monitor/CLAUDE.md  ← 통합 지침 + 기능 체크리스트(전부 구현해야 함)
2. meta-ad-monitor/dashboard/  ← 대시보드: app/page.tsx, app/api/*, lib/supabase.ts
3. meta-ad-monitor/supabase/schema.sql, meta-ad-monitor/.github/workflows/crawl.yml

[작업 전 우리 앱부터 파악]
- 프레임워크 (Next.js App Router인지 / Pages Router인지 / 다른 건지)
- 좌측 메뉴(네비) 컴포넌트가 어디 있는지
- app/api 구조와, 이미 쓰고 있는 Supabase 클라이언트가 있는지
- 패키지 매니저(npm/pnpm/yarn)
파악한 내용과 통합 계획을 먼저 간단히 보여주고 시작해.

[필수 요구사항 — 절대 빼지 말 것]
- 좌측 메뉴에서 '인스타 성과' 바로 아래에 '메타 광고 크롤러' 항목을 추가하고,
  클릭하면 대시보드 화면이 열리도록 라우트를 연결해 (예: /meta-ad-crawler).
- 새 Supabase / GitHub / Vercel 프로젝트를 만들지 마. 기존 것을 그대로 재사용해.
- CLAUDE.md의 기능 체크리스트가 하나도 빠짐없이 동작해야 함:
  브랜드 추가/편집(EDIT)/삭제/on-off, 대분류(카테고리) 그룹 보기, 브랜드별 광고
  조회, 신규 배지·광고유형 배지, 브랜드별 수집 통계, 브랜드별 AI 요약, CSV 내보내기.

[통합 방식 — 우리 앱이 Next.js App Router인 경우]
- meta-ad-monitor/dashboard/app/api/* 를 우리 app/api/meta-ad/* 로 경로 충돌
  없이 이식해. lib/supabase.ts도 가져오되, 우리에게 이미 서버용 supabase 클라이언트가
  있으면 그걸 재사용해.
- dashboard/app/page.tsx 화면을 우리 app/meta-ad-crawler/page.tsx 로 옮겨.
- 화면 안의 fetch 경로(/api/targets 등)를 이식한 실제 경로에 맞게 수정해.
- 좌측 네비 컴포넌트에 '메타 광고 크롤러' 링크를 '인스타 성과' 아래에 추가해.
- 우리 앱이 Next.js가 아니면 멈추고 나에게 어떻게 붙일지 물어봐.

[환경변수 / 시크릿 — 코드만 넣고, 실제 값 입력이 필요한 건 목록으로 알려줘]
- 앱(서버): SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY
- GitHub Actions Secrets: SUPABASE_URL, SUPABASE_SERVICE_KEY
- service_role 키는 서버(API 라우트)에서만 쓰고 절대 브라우저에 노출하지 마.

[DB]
- supabase/schema.sql 은 내가 기존 Supabase SQL Editor에서 직접 실행할 거야.
  우리 DB에 충돌 가능성(테이블명 등) 점검하고, 내가 실행할 SQL을 정리해서 줘.
  (테이블은 am_ 접두사라 일반적으로 충돌 없음)

[크롤러]
- .github/workflows/crawl.yml 을 우리 저장소 관례에 맞게 추가해.
  파이썬 크롤러(meta-ad-monitor/src, requirements.txt, config)는 그대로 두거나
  적절한 위치로 옮겨도 돼. run_cloud가 Supabase에서 타겟을 읽어 돈다는 점 유지.

[작업 원칙]
- 기능을 임의로 빼지 마. 범위를 줄여야 하면 먼저 나에게 확인받아.
- 공개 배포 전 대시보드 접근 제어(비밀번호 또는 Auth)도 제안해줘 (지금은 없음).
- 다 끝나면 보고해줘:
  (1) 추가/수정한 파일 목록
  (2) 내가 직접 해야 할 일 체크리스트
      — 앱 환경변수 입력, GitHub Secrets 등록, Supabase에서 schema.sql 실행,
        재배포 등.
```
