# 광고 모니터 대시보드 (Next.js)

추적할 업체를 추가/관리하고, 쌓인 광고를 보는 대시보드. **기존 Supabase
프로젝트의 DB를 공유**하며, service_role 키는 서버(API 라우트)에서만 쓰여
브라우저에 노출되지 않습니다.

> 기존 앱 통합 시 좌측 메뉴 '인스타 성과' 아래에 '메타 광고 크롤러'를 추가하는
> 방법은 최상위 [CLAUDE.md](../CLAUDE.md) 참고.

## 구현된 기능

- 브랜드 **추가 / 편집(EDIT) / 삭제 / on-off 토글**
- **대분류(카테고리)** 로 브랜드 분류 + 카테고리별 그룹 보기
- 브랜드별 **광고 조회**, 브랜드별 **수집 통계(광고 수)**
- **신규 배지**(최근 7일) · **광고 유형 배지**(이미지/영상)
- 브랜드별 **AI 요약**(Claude) · **CSV 내보내기**
- page_id 자동 추출(광고 라이브러리 URL 붙여넣기)

## 로컬 실행

```powershell
cd dashboard
npm install
copy .env.local.example .env.local
#  .env.local 에 SUPABASE_URL, SUPABASE_SERVICE_KEY 채우기
#  AI 요약(🧠)을 쓰려면 ANTHROPIC_API_KEY 도 채우기
npm run dev      # http://localhost:3000
```

> 사전 준비: 상위 폴더의 `supabase/schema.sql` 을 Supabase SQL Editor 에서 한 번 실행해
> `am_targets`, `am_ads` 테이블을 만들어 두세요.

## Vercel 배포 (기존 계정 그대로, 추가비용 없음)

1. 이 저장소를 GitHub 에 올린다.
2. Vercel → New Project → **Root Directory 를 `dashboard` 로 지정**.
3. Environment Variables 에 `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `ANTHROPIC_API_KEY` 추가.
4. Deploy.

> **기존 마케팅 프로젝트로 가져가려면**: `app/` 의 페이지/라우트와 `lib/supabase.ts`
> 를 기존 Next.js 앱에 복사해 `/dashboard` 같은 경로로 붙이면 됩니다. (이 폴더는
> "독립 실행 + 가져다 쓰기" 둘 다 되도록 만들어 뒀습니다.)

## ⚠️ 접근 제어 (지금은 없음 — 꼭 추가하세요)

현재는 URL만 알면 누구나 접근 가능합니다. 내부용이라도 다음 중 하나를 권장:

- Vercel **Password Protection** (Pro 기능) 또는
- 간단한 미들웨어 비밀번호 게이트, 또는
- Supabase Auth 로그인

지금은 스캐폴드 단계라 비워뒀습니다. 공개 배포 전에 막아주세요.
