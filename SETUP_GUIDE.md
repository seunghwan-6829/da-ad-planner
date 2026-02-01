# DA 광고 기획 플래너 - 설정 가이드

이 가이드는 프로젝트를 로컬에서 실행하고 Vercel에 배포하는 방법을 단계별로 설명합니다.

---

## Step 1: Supabase 설정

### 1.1 프로젝트 생성

1. [https://supabase.com](https://supabase.com)에 접속하여 로그인
2. Dashboard에서 **"New Project"** 클릭
3. 프로젝트 정보 입력:
   - **Name**: `da-ad-planner` (원하는 이름)
   - **Database Password**: 안전한 비밀번호 입력 (메모해두세요)
   - **Region**: 가까운 지역 선택 (예: Northeast Asia - Tokyo)
4. **"Create new project"** 클릭 후 생성 대기 (1-2분)

### 1.2 API 키 확인

1. 프로젝트 생성 완료 후, 좌측 메뉴에서 **⚙️ Project Settings** 클릭
2. **API** 탭 클릭
3. 다음 두 값을 메모:
   - **Project URL**: `https://xxxxx.supabase.co`
   - **anon public** key: `eyJhbGciOiJI...` (긴 문자열)

### 1.3 데이터베이스 테이블 생성

1. 좌측 메뉴에서 **SQL Editor** 클릭
2. **"New query"** 클릭
3. `supabase-schema.sql` 파일의 전체 내용을 복사하여 붙여넣기
4. **"Run"** 버튼 클릭
5. "Success" 메시지 확인

---

## Step 2: 로컬 환경 설정

### 2.1 환경변수 파일 생성

프로젝트 폴더에서 `.env.local` 파일을 생성하고 다음 내용 입력:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
```

**중요**: Supabase에서 확인한 실제 값으로 대체하세요!

### 2.2 의존성 설치 및 실행

터미널에서 프로젝트 폴더로 이동 후:

```bash
cd da-ad-planner
npm install
npm run dev
```

브라우저에서 http://localhost:3000 접속하여 확인

---

## Step 3: GitHub 레포지토리 생성 및 Push

### 3.1 GitHub에서 레포지토리 생성

1. [https://github.com](https://github.com) 로그인
2. 우측 상단 **"+"** 버튼 → **"New repository"** 클릭
3. Repository name: `da-ad-planner`
4. Public 또는 Private 선택
5. **"Create repository"** 클릭

### 3.2 로컬에서 Git 초기화 및 Push

```bash
cd da-ad-planner
git init
git add .
git commit -m "Initial commit: DA 광고 기획 플래너"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/da-ad-planner.git
git push -u origin main
```

**YOUR_USERNAME**을 본인의 GitHub 사용자명으로 변경하세요.

---

## Step 4: Vercel 배포

### 4.1 Vercel 계정 연동

1. [https://vercel.com](https://vercel.com) 접속
2. **"Continue with GitHub"** 클릭하여 GitHub 계정으로 로그인
3. Vercel이 GitHub 레포지토리에 접근할 수 있도록 권한 부여

### 4.2 새 프로젝트 생성

1. Vercel Dashboard에서 **"Add New..."** → **"Project"** 클릭
2. **"Import Git Repository"** 섹션에서 `da-ad-planner` 레포지토리 찾기
3. **"Import"** 클릭

### 4.3 환경변수 설정

**"Configure Project"** 화면에서:

1. **"Environment Variables"** 섹션 펼치기
2. 다음 변수 추가:

| Name | Value |
|------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://your-project-id.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `your-anon-key-here` |

3. **"Deploy"** 클릭

### 4.4 배포 완료

- 배포가 완료되면 `https://da-ad-planner-xxx.vercel.app` 형태의 URL이 생성됩니다
- 이후 GitHub의 main 브랜치에 push할 때마다 **자동으로 재배포**됩니다

---

## 문제 해결

### "Supabase 연결 오류"

- `.env.local` 파일의 URL과 Key가 정확한지 확인
- Supabase 프로젝트가 활성 상태인지 확인

### "npm install 오류"

- Node.js 18 이상이 설치되어 있는지 확인
- `node -v` 명령어로 버전 확인

### "Vercel 배포 실패"

- 환경변수가 올바르게 설정되었는지 확인
- Vercel Dashboard > Deployments에서 에러 로그 확인

---

## 커스터마이징 팁

### 브랜드 컬러 변경

`app/globals.css` 파일에서 CSS 변수 수정:

```css
:root {
  --primary: 221.2 83.2% 53.3%;  /* 원하는 색상으로 변경 */
}
```

### 추가 사이즈 옵션

`app/plans/new/page.tsx`의 `COMMON_SIZES` 배열에 원하는 사이즈 추가

---

설정 완료! 이제 DA 광고 기획 플래너를 사용할 수 있습니다.
