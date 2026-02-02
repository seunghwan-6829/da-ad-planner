-- DA 광고 기획 플래너 데이터베이스 스키마
-- Supabase SQL Editor에서 실행하세요
-- ⚠️ 기존 테이블이 있어도 안전하게 실행됩니다

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

-- 기존 테이블에 새 컬럼 추가 (이미 테이블이 있을 때)
ALTER TABLE advertisers ADD COLUMN IF NOT EXISTS guidelines_image TEXT;
ALTER TABLE advertisers ADD COLUMN IF NOT EXISTS guidelines_video TEXT;
ALTER TABLE advertisers ADD COLUMN IF NOT EXISTS products TEXT[];
ALTER TABLE advertisers ADD COLUMN IF NOT EXISTS appeals TEXT[];
ALTER TABLE advertisers ADD COLUMN IF NOT EXISTS cautions TEXT;

-- 기존 guidelines 컬럼 삭제 (있으면)
ALTER TABLE advertisers DROP COLUMN IF EXISTS guidelines;

-- 기존에 쓰던 불필요한 컬럼 삭제 (있으면 삭제, 없으면 무시)
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
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 기존 ad_plans 테이블에 새 컬럼 추가
ALTER TABLE ad_plans ADD COLUMN IF NOT EXISTS reference_links TEXT[];
ALTER TABLE ad_plans ADD COLUMN IF NOT EXISTS cta_texts TEXT[];
ALTER TABLE ad_plans ADD COLUMN IF NOT EXISTS td_title TEXT;
ALTER TABLE ad_plans ADD COLUMN IF NOT EXISTS td_description TEXT;
ALTER TABLE ad_plans ADD COLUMN IF NOT EXISTS copy_history TEXT;
ALTER TABLE ad_plans ADD COLUMN IF NOT EXISTS custom_prompt TEXT;

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
-- RLS (Row Level Security) - 로그인 없이 사용
-- =============================================
ALTER TABLE advertisers ENABLE ROW LEVEL SECURITY;
ALTER TABLE ad_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE templates ENABLE ROW LEVEL SECURITY;

-- 모든 사용자에게 CRUD 권한 부여 (정책이 없으면 생성)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'advertisers' AND policyname = 'Allow all operations on advertisers') THEN
    CREATE POLICY "Allow all operations on advertisers" ON advertisers FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ad_plans' AND policyname = 'Allow all operations on ad_plans') THEN
    CREATE POLICY "Allow all operations on ad_plans" ON ad_plans FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'templates' AND policyname = 'Allow all operations on templates') THEN
    CREATE POLICY "Allow all operations on templates" ON templates FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- =============================================
-- 인덱스 (성능 최적화)
-- =============================================
CREATE INDEX IF NOT EXISTS idx_ad_plans_advertiser_id ON ad_plans(advertiser_id);
CREATE INDEX IF NOT EXISTS idx_ad_plans_created_at ON ad_plans(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_advertisers_created_at ON advertisers(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_templates_created_at ON templates(created_at DESC);
