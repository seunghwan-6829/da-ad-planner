-- DA 광고 기획 플래너 데이터베이스 스키마
-- Supabase SQL Editor에서 실행하세요

CREATE TABLE IF NOT EXISTS advertisers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  brand_color TEXT,
  brand_font TEXT,
  tone_manner TEXT,
  forbidden_words TEXT[],
  required_phrases TEXT[],
  guidelines TEXT,
  products TEXT[],
  cautions TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 광고 기획서 테이블
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
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 템플릿 테이블
CREATE TABLE IF NOT EXISTS templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  media_type TEXT,
  default_size TEXT,
  structure JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS (Row Level Security) 비활성화 (로그인 없이 사용)
ALTER TABLE advertisers ENABLE ROW LEVEL SECURITY;
ALTER TABLE ad_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE templates ENABLE ROW LEVEL SECURITY;

-- 모든 사용자에게 CRUD 권한 부여
CREATE POLICY "Allow all operations on advertisers" ON advertisers
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all operations on ad_plans" ON ad_plans
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all operations on templates" ON templates
  FOR ALL USING (true) WITH CHECK (true);

-- 인덱스 생성 (성능 최적화)
CREATE INDEX IF NOT EXISTS idx_ad_plans_advertiser_id ON ad_plans(advertiser_id);
CREATE INDEX IF NOT EXISTS idx_ad_plans_created_at ON ad_plans(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_advertisers_created_at ON advertisers(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_templates_created_at ON templates(created_at DESC);

-- 기존 프로젝트용 컬럼 추가 (이미 advertisers 테이블이 있을 때)
ALTER TABLE advertisers ADD COLUMN IF NOT EXISTS products TEXT[];
ALTER TABLE advertisers ADD COLUMN IF NOT EXISTS cautions TEXT;
