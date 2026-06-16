# 지침: 메타 광고 크롤러 통합 (기존 프로젝트에 붙이기)

> 이 폴더(`meta-ad-monitor`)를 **기존 마케팅 웹앱 프로젝트 안에 넣고** 작업할 때
> 반드시 이 지침을 따른다. **새 Supabase/GitHub/Vercel 프로젝트를 만들지 않는다.**
> 이미 있는 것들을 그대로 재사용한다.

---

## 0. 가장 중요한 요구사항 (HARD REQUIREMENT)

- 기존 앱의 **좌측 메뉴 패널**에서 **'인스타 성과' 바로 아래에 '메타 광고 크롤러'**
  메뉴 항목을 추가한다.
- 그 메뉴를 클릭하면 이 폴더의 대시보드 화면(`dashboard/app/page.tsx` 의 내용)이
  열리도록 라우트를 연결한다. (예: `/meta-ad-crawler`)
- **아래 "기능 체크리스트"의 모든 항목이 하나도 빠짐없이 동작해야 한다.**

## 1. 기존 인프라 재사용 (새로 만들지 말 것)

| 인프라 | 할 일 |
|---|---|
| **Supabase** (기존 프로젝트) | `supabase/schema.sql` 을 SQL Editor 에서 1회 실행. 테이블은 `am_` 접두사라 기존 테이블과 충돌 없음. **새 프로젝트 생성 금지.** |
| **GitHub** (기존 저장소) | `.github/workflows/crawl.yml` 을 기존 저장소에 추가하고, Secrets 에 `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` 추가. |
| **Vercel** (기존 프로젝트) | 별도 배포 X. 기존 앱에 라우트/메뉴로 통합하고, 환경변수 `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `ANTHROPIC_API_KEY` 를 기존 프로젝트에 추가. |

## 2. 통합 방법 (기존 앱이 Next.js App Router 인 경우)

1. `dashboard/app/api/*` 의 라우트들을 기존 앱의 `app/api/meta-ad/*` 등으로 복사
   (경로 충돌 피해서). `dashboard/lib/supabase.ts` 도 가져온다.
2. `dashboard/app/page.tsx` 의 화면을 기존 앱의 새 페이지(예: `app/meta-ad-crawler/page.tsx`)로 옮긴다.
3. 좌측 네비 컴포넌트에서 '인스타 성과' 항목 바로 아래에 링크를 추가:
   `{ label: '메타 광고 크롤러', href: '/meta-ad-crawler' }`
4. fetch 경로(`/api/targets` 등)를 복사한 위치에 맞게 조정.

> 기존 앱이 Next.js 가 아니면: 대시보드를 별도 Vercel 프로젝트로 띄우고(같은
> Supabase 공유), 기존 앱 좌측 메뉴의 '메타 광고 크롤러' 링크가 그 URL 을
> 가리키게 한다. 데이터/크롤러는 동일하게 동작한다.

## 3. 기능 체크리스트 (전부 구현되어야 함)

### 크롤러 (Python, GitHub Actions)
- [x] 메타 광고 라이브러리 크롤링: **소재 / 시작일 / 페이지 / Library ID**
- [x] Library ID 기준 **중복 제거 누적** (새 광고만 쌓임)
- [x] **텍스트 앵커 추출** — 클래스명 바뀌어도 버팀 (`src/scraper.py`)
- [x] **매일 자동 실행** (`.github/workflows/crawl.yml`, 무료 크론)
- [x] **DOM 깨짐 감지**(`healthcheck`) + **AI 셀프힐링**(`heal`, Claude API)
- [x] 대시보드에서 추가한 브랜드(`am_targets`)를 읽어 크롤링 (`src/run_cloud.py`)

### 대시보드 (Next.js)
- [ ] **좌측 메뉴 '인스타 성과' 아래 '메타 광고 크롤러' 추가** ← 통합 시 필수
- [x] 브랜드(업체) **추가** — 광고 라이브러리 URL 붙여넣기로 page_id 자동 추출
- [x] 브랜드 **삭제**
- [x] 브랜드 **편집(EDIT)** — 이름/대분류/page_id·검색어/국가/on-off
- [x] 브랜드 크롤링 **on/off 토글**
- [x] **대분류(카테고리)** 로 브랜드 분류 + 카테고리별 그룹 보기
- [x] 브랜드별 **광고 조회** (소재 썸네일/시작일/Library ID/본문)
- [x] **신규 광고 배지** (최근 7일 내 첫 발견)
- [x] **광고 유형 배지** (이미지/영상)
- [x] 브랜드별 **수집 통계** (광고 수)
- [x] 브랜드별 **AI 요약** (소구점/프로모션/타겟/신규변화/인사이트) — Claude API
- [x] **CSV 내보내기**

## 4. 데이터 모델 (Supabase, `am_` 접두사)

- `am_targets`: id, label, **category(대분류)**, type(page|keyword), page_id, query, country, enabled, created_at
- `am_ads`: library_id(PK), target_id, page_name, started_on, ad_text, media_type, media_url, first_seen_at, last_seen_at
- `am_health_checks`: id, ran_at, target_id, extracted_count, status

## 5. 환경변수

| 키 | 어디에 |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | GitHub Secrets(크롤러) + Vercel/기존앱(대시보드) |
| `ANTHROPIC_API_KEY` | Vercel/기존앱 (AI 요약). heal 을 클라우드에서 돌리면 GitHub 에도. |

> `service_role` 키는 **서버(API 라우트)에서만** 사용. 브라우저에 절대 노출 금지.

## 6. 누락 금지 원칙

이 기능을 통합/수정할 때, 위 **3. 기능 체크리스트**의 항목을 임의로 빼지 않는다.
범위를 줄여야 할 사정이 생기면 사용자에게 먼저 알리고 확인을 받는다.
대시보드 공개 배포 전 **접근 제어(비밀번호/Auth)** 를 반드시 추가한다(현재 없음).
