-- DA 광고 기획 플래너 데이터베이스 스키마
-- Supabase SQL Editor에서 실행하세요
-- ⚠️ 기존 테이블이 있어도 안전하게 실행됩니다

-- =============================================
-- 사용자 프로필 테이블 (인증용)
-- =============================================
CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT,
  role TEXT DEFAULT 'pending' CHECK (role IN ('admin', 'approved', 'pending')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 기존 테이블에 컬럼 추가
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'pending';

-- user_profiles RLS
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- 기존 정책 삭제
DROP POLICY IF EXISTS "Users can read own profile" ON user_profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON user_profiles;
DROP POLICY IF EXISTS "Admins can read all profiles" ON user_profiles;
DROP POLICY IF EXISTS "Admins can update all profiles" ON user_profiles;
DROP POLICY IF EXISTS "Authenticated users can read all profiles" ON user_profiles;
DROP POLICY IF EXISTS "Authenticated users can insert own profile" ON user_profiles;
DROP POLICY IF EXISTS "Anyone can read profiles" ON user_profiles;
DROP POLICY IF EXISTS "Anyone can update profiles" ON user_profiles;

-- 단순화된 RLS 정책: 로그인한 사용자 누구나 읽기/쓰기 가능
CREATE POLICY "Enable read for authenticated users" ON user_profiles 
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Enable update for authenticated users" ON user_profiles 
  FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Enable insert for authenticated users" ON user_profiles 
  FOR INSERT TO authenticated WITH CHECK (true);

-- 새 사용자 가입 시 자동으로 프로필 생성하는 함수
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profiles (id, email, role)
  VALUES (
    NEW.id,
    NEW.email,
    CASE WHEN NEW.email = 'motiol_6829@naver.com' THEN 'admin' ELSE 'pending' END
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 트리거 생성
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =============================================
-- motiol_6829@naver.com 관리자 설정
-- =============================================
UPDATE user_profiles SET role = 'admin' WHERE email = 'motiol_6829@naver.com';

-- =============================================
-- 광고주 테이블
-- =============================================
CREATE TABLE IF NOT EXISTS advertisers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  guidelines_image TEXT,
  guidelines_video TEXT,
  products TEXT[],
  appeals TEXT[],
  cautions TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE advertisers ADD COLUMN IF NOT EXISTS guidelines_image TEXT;
ALTER TABLE advertisers ADD COLUMN IF NOT EXISTS guidelines_video TEXT;
ALTER TABLE advertisers ADD COLUMN IF NOT EXISTS products TEXT[];
ALTER TABLE advertisers ADD COLUMN IF NOT EXISTS appeals TEXT[];
ALTER TABLE advertisers ADD COLUMN IF NOT EXISTS cautions TEXT;

ALTER TABLE advertisers DROP COLUMN IF EXISTS guidelines;
ALTER TABLE advertisers DROP COLUMN IF EXISTS brand_color;
ALTER TABLE advertisers DROP COLUMN IF EXISTS brand_font;
ALTER TABLE advertisers DROP COLUMN IF EXISTS tone_manner;
ALTER TABLE advertisers DROP COLUMN IF EXISTS forbidden_words;
ALTER TABLE advertisers DROP COLUMN IF EXISTS required_phrases;

-- =============================================
-- 광고 기획서 테이블
-- =============================================
CREATE TABLE IF NOT EXISTS ad_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  advertiser_id UUID REFERENCES advertisers(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  media_type TEXT CHECK (media_type IN ('image', 'video')),
  size TEXT,
  concept TEXT,
  main_copy TEXT,
  sub_copy TEXT,
  cta_text TEXT,
  notes TEXT,
  reference_links TEXT[],
  cta_texts TEXT[],
  td_title TEXT,
  td_description TEXT,
  copy_history TEXT,
  custom_prompt TEXT,
  ai_results TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE ad_plans ADD COLUMN IF NOT EXISTS reference_links TEXT[];
ALTER TABLE ad_plans ADD COLUMN IF NOT EXISTS cta_texts TEXT[];
ALTER TABLE ad_plans ADD COLUMN IF NOT EXISTS td_title TEXT;
ALTER TABLE ad_plans ADD COLUMN IF NOT EXISTS td_description TEXT;
ALTER TABLE ad_plans ADD COLUMN IF NOT EXISTS copy_history TEXT;
ALTER TABLE ad_plans ADD COLUMN IF NOT EXISTS custom_prompt TEXT;
ALTER TABLE ad_plans ADD COLUMN IF NOT EXISTS ai_results TEXT;

-- =============================================
-- 템플릿 테이블
-- =============================================
CREATE TABLE IF NOT EXISTS templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  media_type TEXT,
  default_size TEXT,
  structure JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- RLS - 모든 테이블 공개
-- =============================================
ALTER TABLE advertisers ENABLE ROW LEVEL SECURITY;
ALTER TABLE ad_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all operations on advertisers" ON advertisers;
DROP POLICY IF EXISTS "Allow all operations on ad_plans" ON ad_plans;
DROP POLICY IF EXISTS "Allow all operations on templates" ON templates;

CREATE POLICY "Allow all operations on advertisers" ON advertisers FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on ad_plans" ON ad_plans FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on templates" ON templates FOR ALL USING (true) WITH CHECK (true);

-- =============================================
-- BP 소재 테이블
-- =============================================
CREATE TABLE IF NOT EXISTS bp_materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  image_url TEXT,
  extracted_text TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE bp_materials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all operations on bp_materials" ON bp_materials;
CREATE POLICY "Allow all operations on bp_materials" ON bp_materials FOR ALL USING (true) WITH CHECK (true);

-- =============================================
-- 인덱스
-- =============================================
CREATE INDEX IF NOT EXISTS idx_ad_plans_advertiser_id ON ad_plans(advertiser_id);
CREATE INDEX IF NOT EXISTS idx_ad_plans_created_at ON ad_plans(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_advertisers_created_at ON advertisers(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_templates_created_at ON templates(created_at DESC);
