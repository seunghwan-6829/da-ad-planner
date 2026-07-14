# 네이버 카페 자동화 셋업 가이드

리뉴얼 반영(브랜드→발행처 + 서버 페이스 게이트 + 승인 큐 + 자동 스케줄). 배포되면 대부분 자동 동작하고, 아래 3가지(사장님만 하실 수 있는 것)만 세팅하면 완전 동작합니다.

## 공통 개념
- **서버(제작 사이트, Vercel)** = "두뇌": 페이스(계정 밴 방지) 판정·자동 스케줄·발행 큐·AI 초안 생성.
- **로컬 워커(`naver-cafe-agent`)** = "손": 로그인된 웨일 브라우저로 발행 + 24h 반응 측정만. **service_role 키 불필요**(서버 URL + AGENT 토큰만).

## 1) Supabase SQL 실행 (한 번)
Supabase → SQL Editor 에 `db/naver-cafe.sql` 을 통째로 붙여넣고 실행(멱등 — 여러 번 실행해도 안전, 기존 데이터 무손실).

## 2) Vercel 환경변수
Vercel → Project → Settings → Environment Variables (값은 사장님이 직접 입력):

| 변수 | 용도 | 필수? |
|---|---|---|
| `ANTHROPIC_API_KEY` | AI 초안(회사 공용 키) | 자동 생성 쓰려면 필요(이미 있으면 그대로) |
| `NC_AGENT_TOKEN` | 워커 인증(서버↔워커) | 선택(권장) |
| `CRON_SECRET` | 자동스케줄 크론 엔드포인트 보호 | 선택(권장) |

- `NC_AGENT_TOKEN`/`CRON_SECRET` 설정 시 워커·크론에 동일 값을 맞춰야 동작(미설정 시 개방).
- `CRON_SECRET`을 쓰면 **GitHub → Settings → Secrets → Actions** 에도 같은 값 추가.
- 넣고 나면 **Redeploy**(또는 PR 머지 시 자동 배포)해야 적용됩니다.

### GitHub Actions 크론(자동)
- `naver-cafe-tick.yml` (매시각) — 발행처 자동 스케줄(auto_mode 발행처, PC 꺼져도 초안 생성)
- `naver-cafe-drafts.yml` (매일 07:00 KST) — 카페별 하루치 초안(기존)

## 3) 로컬 워커 실행 (`naver-cafe-agent`)
1. `naver-cafe-agent/.env.example` → `.env` 복사 후 채우기:
   - `CC_SERVER_URL=https://da-ad-planner.vercel.app`
   - `NC_AGENT_TOKEN=` (Vercel 값과 동일. 서버에 안 넣었으면 비워둠)
2. 네이버 로그인된 **웨일 프로필** 준비(기존 `.whale-profile` 자동 탐색).
3. `naver-cafe-agent/publish-agent.bat` 더블클릭 → 창 유지(닫으면 멈춤).
   - 승인(발행 대기)된 글을 **서버 페이스 규칙에 맞춰** 실제 타이핑으로 등록 + 24h 후 반응 측정.

## 사용 흐름
브랜드(페르소나) 추가 → 발행처(카페 보드) 추가(운영설정에서 club/board·말머리·자동스케줄) → 초안 생성/검수(승인·보관·반려) → 승인 글은 페이스 규칙대로 자동 발행 → 24h 반응.
- **페이스 설정**(상단 게이지 칩): 활동시간[9,23]·하루 글2/댓8·카페 주2·간격25~90분. 보수적일수록 안전.
- 크래시로 '발행 중'에 멈춘 글은 **카페에 이미 올라갔는지 확인 후** UI에서 '되돌리기'(중복 발행 방지).

## 보안 메모
- 이식 원본 폴더(`네이버 카페 자동화/` 등)와 `api key.txt`·`.env`·`.whale-profile`·`*.db`는 **.gitignore로 커밋 차단**. 절대 커밋 금지.
- service_role 키는 서버/워커 환경변수에만. 채팅·커밋 금지.
