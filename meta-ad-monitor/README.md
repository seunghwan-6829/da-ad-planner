# Meta Ad Monitor (메타 광고 라이브러리 모니터링)

경쟁사 메타(페이스북/인스타그램) 광고 라이브러리를 주기적으로 크롤링해서
**광고 소재 / 게재 시작일 / 페이지** 를 DB에 계속 누적하는 도구.

DOM이 바뀌어 크롤링이 깨지면, **Claude API가 새 셀렉터를 제안/수정**하는
셀프 힐링 기능이 들어있습니다.

---

## 핵심 설계

- **셀렉터는 코드가 아니라 설정파일(`config/selectors.json`)에 있다.**
  → DOM이 바뀌면 이 파일만 갱신하면 됨. 코드 수정 불필요.
- **수집 대상은 `config/targets.json`에 정해둔 경쟁사 페이지/키워드만.**
  → "업종 전체 무차별"이 아니라 정해둔 대상만 돌아서 차단 위험을 낮춤.
- **중복은 광고의 `Library ID`로 거른다.**
  → 같은 광고는 다시 안 쌓이고, 새 광고만 척척 누적됨.

```
[main.py collect]  매일 실행
   └─ scraper.py (Playwright) → 광고 추출
        └─ storage.py (SQLite) → Library ID 기준 누적

[main.py healthcheck]  2주마다 실행
   └─ 알려진 페이지에서 N개 이상 정상 추출되나 확인
        └─ 깨졌으면 → healer.py (Claude API) 가 새 셀렉터 제안/적용
```

---

## 설치

```powershell
# 1) 가상환경
python -m venv .venv
.\.venv\Scripts\Activate.ps1

# 2) 의존성
pip install -r requirements.txt

# 3) Playwright 브라우저 설치 (최초 1회)
playwright install chromium

# 4) 환경변수 (셀프 힐링 쓸 때만 필요)
copy .env.example .env
#  .env 파일을 열어 ANTHROPIC_API_KEY 를 채운다
```

## 사용법

```powershell
# 추적할 경쟁사 페이지를 먼저 config/targets.json 에 넣는다.

# 광고 수집 (매일 실행 권장)
python -m src.main collect

# 브라우저 띄워서 눈으로 확인하며 수집 (셀렉터 튜닝용)
python -m src.main collect --headful

# DOM 헬스체크 (2주마다 실행 권장)
python -m src.main healthcheck

# 깨졌을 때 AI에게 셀렉터 수정 제안 받기 (반자동: 검토 후 적용)
python -m src.main heal

# 쌓인 광고 통계 보기
python -m src.main stats
```

## 자동 스케줄 (Windows 작업 스케줄러)

- `collect`  → 매일 1회
- `healthcheck` → 2주마다 1회 (실패 시 자동으로 heal 후보 생성)

---

## ⚠️ 주의

- 메타는 자동 수집을 약관상 금지합니다. **속도를 늦추고(사람처럼)**, 추적
  대상을 좁게 유지하세요. (`config/targets.json`의 페이지만)
- 상업 광고는 **광고비/노출수/타게팅은 공개되지 않습니다.** 얻을 수 있는 건
  소재·시작일·페이지·라이브러리 ID 까지입니다.
- `config/selectors.json`의 셀렉터는 **실제 라이브 페이지에 맞춰 한 번
  튜닝**해야 합니다. 메타 DOM은 클래스명이 난독화돼 있어서, 최초 1회는
  `collect --headful`로 보면서 맞추거나 `heal`로 AI 도움을 받으세요.

## ☁️ 클라우드 구성 (대시보드 + Supabase + GitHub Actions)

로컬 SQLite 대신, 대시보드에서 업체를 추가하고 자동으로 크롤링되게 하려면:

```
대시보드(Vercel) ──┐
                   ├─ 같은 Supabase DB 공유 (기존 프로젝트, 추가비용 0)
크롤러(GitHub Actions, 매일) ──┘
```

- **DB**: `supabase/schema.sql` 을 기존 Supabase 프로젝트의 SQL Editor 에서 1회 실행
  (테이블 `am_*` 접두사라 기존 테이블과 충돌 없음).
- **크롤러**: `src/run_cloud.py` 가 `am_targets`(대시보드에서 추가한 업체)를 읽어
  크롤링 → `am_ads` 에 누적. `.github/workflows/crawl.yml` 이 매일 자동 실행.
- **대시보드**: `dashboard/` 폴더 (Next.js). [dashboard/README.md](dashboard/README.md) 참고.

### 셋업 순서

1. Supabase: `supabase/schema.sql` 실행 → URL + `service_role` 키 확보
2. GitHub: 저장소에 push → Settings → Secrets 에 `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` 추가
3. (테스트) Actions 탭 → "Crawl Meta Ad Library" → Run workflow 수동 실행
4. Vercel: `dashboard/` 를 Root Directory 로 배포, 같은 두 환경변수 추가

> 로컬 모드(`collect`/`stats`, SQLite)와 클라우드 모드(`run_cloud`, Supabase)는
> 공존합니다. 셀렉터 튜닝은 로컬 `collect --headful` 로 하고, 운영은 클라우드로.

## 다음에 만들 것 (TODO)

- [ ] 새 광고 발견 시 슬랙/메일 알림
- [ ] 수집된 소재 AI 요약 ("A사 신규 소재 3개, 핵심 메시지는 …")
- [ ] 완전 자동 힐링 모드 (테스트 통과 시 사람 개입 없이 적용)
