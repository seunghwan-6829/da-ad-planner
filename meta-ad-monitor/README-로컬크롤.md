# 내 PC에서 직접 크롤하기 (광고 전량 수집)

GitHub 자동 크롤은 서버 IP(데이터센터)라 메타가 브랜드당 **~30개만** 내줍니다.
내 PC(집 IP)에서 **화면을 띄워(headful)** 돌리면 봇 차단을 덜 받아 **훨씬 많이(보통 100개+)** 받아집니다.
신규 브랜드를 추가했을 때 이 방법으로 전량 수집하세요.

## 처음 한 번만 (설치)

1. 파이썬이 없다면 https://www.python.org/downloads/ 에서 설치
   (설치 화면에서 **"Add Python to PATH"** 꼭 체크)
2. 이 폴더의 **`setup-local.bat`** 더블클릭 → 자동으로 라이브러리·크롬엔진 설치
3. 같은 폴더의 **`.env.example`** 을 복사해 파일명을 **`.env`** 로 바꾼 뒤,
   메모장으로 열어 두 줄을 채웁니다:
   ```
   SUPABASE_URL=https://...supabase.co
   SUPABASE_SERVICE_KEY=eyJ... (service_role 키)
   ```
   - 값은 Supabase 대시보드 → **Project Settings → API** 에서 복사
   - ⚠️ `service_role` 키는 비밀키입니다. 누구에게도 공유/업로드하지 마세요.
     (`.env` 는 git 에 안 올라가게 되어 있습니다.)

## 매번 (크롤 실행)

웹에서 신규 브랜드를 추가한 뒤:

- **`crawl-new.bat`** 더블클릭 → **최근 7일 내 추가한 브랜드만** 전량 크롤 (추천)
- **`crawl-all.bat`** 더블클릭 → **등록된 모든 브랜드** 다시 크롤 (기존 30개 브랜드도 전량으로 채워짐, 오래 걸림)

실행하면 크롬 창이 떠서 **스스로 스크롤**합니다. 끝날 때까지 창을 닫지 마세요.
다 끝나면 웹 갤러리에서 **새로고침** 하면 바로 반영됩니다.

## 참고
- 결과는 GitHub 크롤과 **같은 Supabase**에 저장됩니다(중복은 자동 누적, 새 광고만 추가).
- 영상 프레임 썸네일은 `ffmpeg` 가 있어야 생성됩니다(없어도 광고·영상은 정상 저장).
  필요하면 https://www.gyan.dev/ffmpeg/builds/ 에서 받아 PATH 에 추가하세요.
- 조절용 환경변수(고급): `CRAWL_SINCE_DAYS`(신규 기준 일수), `CRAWL_MAX_SCROLLS`(스크롤 횟수).
