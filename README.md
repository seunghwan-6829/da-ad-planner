# DA 광고 기획 플래너

이미지/영상 광고 소재 기획을 효율적으로 관리하는 웹 애플리케이션입니다.

## 주요 기능

- **광고 기획서 관리**: 이미지/영상 소재 기획서 작성, 수정, 삭제
- **광고주 관리**: 광고주별 브랜드 가이드라인 저장 (컬러, 폰트, 톤앤매너, 금지어/필수문구)
- **템플릿 관리**: 자주 사용하는 기획서 형식 템플릿화

## 기술 스택

- **Frontend**: Next.js 14 (App Router), TypeScript, Tailwind CSS
- **Database**: Supabase (PostgreSQL)
- **Deployment**: Vercel

## 시작하기

### 1. 의존성 설치

```bash
npm install
```

### 2. 환경변수 설정

`.env.local.example`을 복사하여 `.env.local` 파일을 생성하고, Supabase 설정을 입력합니다:

```bash
cp .env.local.example .env.local
```

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
```

### 3. Supabase 데이터베이스 설정

Supabase 대시보드의 SQL Editor에서 `supabase-schema.sql` 파일의 내용을 실행합니다.

### 4. 개발 서버 실행

```bash
npm run dev
```

브라우저에서 [http://localhost:3000](http://localhost:3000)을 열어 확인합니다.

## Vercel 배포

### 1. GitHub 연동

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/da-ad-planner.git
git push -u origin main
```

### 2. Vercel 프로젝트 생성

1. [Vercel](https://vercel.com)에 로그인
2. "Add New Project" 클릭
3. GitHub 레포지토리 선택 (da-ad-planner)
4. Environment Variables 설정:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
5. "Deploy" 클릭

이후 main 브랜치에 push할 때마다 자동으로 배포됩니다.

## Supabase 설정 가이드

### 1. Supabase 프로젝트 생성

1. [Supabase](https://supabase.com)에 로그인
2. "New Project" 클릭
3. 프로젝트 이름과 데이터베이스 비밀번호 설정
4. 생성 완료 후 Project Settings > API에서 URL과 anon key 확인

### 2. 데이터베이스 테이블 생성

SQL Editor에서 `supabase-schema.sql` 실행

## 프로젝트 구조

```
da-ad-planner/
├── app/
│   ├── page.tsx              # 대시보드
│   ├── plans/                # 기획서 관련 페이지
│   ├── advertisers/          # 광고주 관련 페이지
│   └── templates/            # 템플릿 관련 페이지
├── components/
│   ├── sidebar.tsx           # 사이드바 네비게이션
│   └── ui/                   # UI 컴포넌트
├── lib/
│   ├── supabase.ts           # Supabase 클라이언트
│   ├── utils.ts              # 유틸리티 함수
│   └── api/                  # API 함수
└── supabase-schema.sql       # 데이터베이스 스키마
```

## 라이선스

MIT
