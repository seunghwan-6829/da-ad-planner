# 네이버 카페 · 쓰레드 자동화 셋업 가이드

리뉴얼 반영. **코드는 배포되면 대부분 자동 동작**하지만, 아래 3가지(사장님만 하실 수 있는 것)를 세팅하면 완전 동작합니다.
① Supabase에 SQL 실행  ② Vercel 환경변수  ③ 로컬 워커 실행(발행/수집 중 브라우저 필요한 부분).

---

## 공통 개념
- **서버(제작 사이트, Vercel)** = "두뇌". 페이스(계정 밴 방지) 판정·자동 스케줄·발행 큐·AI 생성·인사이트.
- **로컬 워커** = "손". 로그인 세션이 필요한 브라우저 작업만 담당.
  - 네이버: 발행(웨일 로그인 필요) + 24h 반응 측정 → `naver-cafe-agent`
  - 쓰레드: 수집(Threads/게시판 크롤링) → `threads-agent`. (쓰레드 **발행은 서버가** Threads API로 하므로 로컬 불필요)
- 워커는 이제 **service_role 키가 필요 없습니다**(서버 URL + AGENT 토큰만).

---

## 1) Supabase SQL 실행 (한 번)
Supabase → SQL Editor 에 아래 두 파일을 통째로 붙여넣고 실행(멱등 — 여러 번 실행해도 안전, 데이터 안 지워짐):
- `db/naver-cafe.sql`  (기존 v2에 v3 컬럼/테이블 가산: 브랜드·발행처 필드·큐 상태·페이스·자동스케줄)
- `db/threads.sql`     (쓰레드 신규 8테이블)

---

## 2) Vercel 환경변수
Vercel → Project → Settings → Environment Variables 에 추가(값은 사장님이 직접 입력):

| 변수 | 용도 | 필수? |
|---|---|---|
| `ANTHROPIC_API_KEY` | AI 초안/댓글/스타일가이드(회사 공용 키) | 자동 생성 쓰려면 필요 |
| `THREADS_TOKEN_<브랜드ID>` | 쓰레드 브랜드별 발행 토큰(장기 60일) | 쓰레드 발행 시 브랜드마다 |
| `NC_AGENT_TOKEN` | 네이버 워커 인증(서버↔워커) | 선택(권장) |
| `TH_AGENT_TOKEN` | 쓰레드 워커 인증(서버↔워커) | 선택(권장) |
| `CRON_SECRET` | 발행 크론 엔드포인트 보호 | 선택(권장) |

- `THREADS_TOKEN_<ID>` 의 `<ID>`는 쓰레드 브랜드 설정 화면에 표시되는 이름 그대로(예: 브랜드 id `main` → `THREADS_TOKEN_MAIN`). 화면에 정확한 환경변수명이 뜹니다.
- `NC_AGENT_TOKEN`/`TH_AGENT_TOKEN`/`CRON_SECRET`을 설정하면, 워커/크론 호출 시 동일 값을 맞춰야 동작(미설정 시 개방).

### Threads 토큰 발급(브랜드당 1회)
Meta 개발자 콘솔에서 Threads API 앱 생성 → 권한 `threads_basic`, `threads_content_publish`, `threads_manage_insights` → OAuth로 단기 토큰 → **장기 토큰(60일)** 으로 교환 → 그 값을 `THREADS_TOKEN_<ID>` 에 넣기. (계정은 프로페셔널/크리에이터, 하루 250개·글 500자 제한)
> 60일마다 갱신 필요. 서버에 `refresh_access_token`도 있으나, 가장 확실한 건 만료 전 재발급.

### GitHub Actions 크론(자동)
푸시하면 아래 워크플로가 자동 등록됩니다(레포 Actions 활성 필요). `CRON_SECRET`을 쓰면 **GitHub → Settings → Secrets → Actions** 에도 같은 `CRON_SECRET` 추가.
- `naver-cafe-tick.yml` (매시각) — 발행처 자동 스케줄
- `naver-cafe-drafts.yml` (매일 07:00 KST) — 카페별 하루치 초안(기존)
- `threads-tick.yml` (10분) — 예약/슬롯 발행
- `threads-snapshot.yml` (6시간) — 내 글 성과 수집
- `threads-analyze.yml` (매주 월 07:00 KST) — 스타일가이드 갱신

---

## 3) 로컬 워커 실행

### 네이버 발행 에이전트 (`naver-cafe-agent`)
1. `naver-cafe-agent/.env.example` → `.env` 복사 후 채우기:
   - `CC_SERVER_URL=https://da-ad-planner.vercel.app`
   - `NC_AGENT_TOKEN=` (Vercel에 넣은 값과 동일. 서버에 안 넣었으면 비워둠)
2. 네이버 로그인된 **웨일 프로필** 준비(기존 `.whale-profile` 사용 — 자동 탐색).
3. `naver-cafe-agent/publish-agent.bat` 더블클릭 → 창 유지(닫으면 멈춤).
   - 승인(발행 대기)된 글을 **서버 페이스 규칙에 맞춰** 실제 타이핑으로 등록 + 24h 후 반응 측정.

### 쓰레드 수집 워커 (`threads-agent`)
1. `threads-agent/.env.example` → `.env` 복사 후 채우기:
   - `CC_SERVER_URL=https://da-ad-planner.vercel.app`
   - `TH_AGENT_TOKEN=` (Vercel 값과 동일)
2. `threads-agent/collect.bat` 더블클릭 → 첫 실행 시 열린 크롬/엣지 창에서 (필요하면) Threads 로그인.
   - 브랜드/카테고리(수집 소스)를 크롤링해 스크랩 적재. 발행은 서버가 담당.

---

## 사용 흐름
### 네이버
브랜드(페르소나) 추가 → 발행처(카페 보드) 추가(운영설정에서 club/board·말머리·자동스케줄) → 초안 생성/검수(승인·보관·반려) → 승인 글은 페이스 규칙대로 자동 발행 → 24h 반응.
- **페이스 설정**(상단 게이지 칩): 활동시간[9,23]·하루 글2/댓8·카페 주2·간격25~90분. 보수적일수록 안전.

### 쓰레드
브랜드 추가(모드=발행, 슬롯·토큰) → 카테고리(수집 소스: 쓰레드 키워드/게시판) → 수집 워커가 소재 수집 → 스크랩 보드에서 🔥hot 소재로 초안 생성 → 발행 큐(슬롯/예약) → 서버가 Threads API로 발행 → 내 글 성과.

---

## 보안 메모
- 두 이식 원본 폴더(`네이버카페 자동화_신규버전/`, `쓰레드 자동화/`)와 `api key.txt`·`.env`·`.whale-profile`·`.playwright-threads`·`*.db`·토큰은 **.gitignore로 커밋 차단**되어 있습니다. 절대 커밋 금지.
- service_role 키는 서버/워커 환경변수에만. 채팅·커밋 금지.
