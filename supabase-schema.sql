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
  category TEXT,
  guidelines_image TEXT,
  guidelines_video TEXT,
  products TEXT[],
  appeals TEXT[],
  cautions TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE advertisers ADD COLUMN IF NOT EXISTS category TEXT;

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
  category TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE bp_materials ADD COLUMN IF NOT EXISTS category TEXT;

ALTER TABLE bp_materials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all operations on bp_materials" ON bp_materials;
CREATE POLICY "Allow all operations on bp_materials" ON bp_materials FOR ALL USING (true) WITH CHECK (true);

-- =============================================
-- 클라이언트(프로젝트) 테이블
-- =============================================
CREATE TABLE IF NOT EXISTS clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  color TEXT DEFAULT '#3B82F6',
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE clients ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all operations on clients" ON clients;
CREATE POLICY "Allow all operations on clients" ON clients FOR ALL USING (true) WITH CHECK (true);

-- =============================================
-- 클라이언트 권한 테이블 (사용자별 클라이언트 접근 권한)
-- =============================================
CREATE TABLE IF NOT EXISTS client_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, client_id)
);

ALTER TABLE client_permissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all operations on client_permissions" ON client_permissions;
CREATE POLICY "Allow all operations on client_permissions" ON client_permissions FOR ALL USING (true) WITH CHECK (true);

-- =============================================
-- 프로젝트 기획안 테이블
-- =============================================
CREATE TABLE IF NOT EXISTS project_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'in_progress', 'completed')),
  scene_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE project_plans ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'draft';
ALTER TABLE project_plans ADD COLUMN IF NOT EXISTS scene_count INTEGER DEFAULT 0;
ALTER TABLE project_plans ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE project_plans ADD COLUMN IF NOT EXISTS row_heights JSONB;
ALTER TABLE project_plans ADD COLUMN IF NOT EXISTS reference TEXT;
ALTER TABLE project_plans ADD COLUMN IF NOT EXISTS cta_text TEXT;
ALTER TABLE project_plans ADD COLUMN IF NOT EXISTS card_preview TEXT;
ALTER TABLE project_plans ADD COLUMN IF NOT EXISTS is_completed BOOLEAN DEFAULT FALSE;
ALTER TABLE project_plans ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE project_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all operations on project_plans" ON project_plans;
CREATE POLICY "Allow all operations on project_plans" ON project_plans FOR ALL USING (true) WITH CHECK (true);

-- =============================================
-- 기획안 씬(장면) 테이블
-- =============================================
CREATE TABLE IF NOT EXISTS plan_scenes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID REFERENCES project_plans(id) ON DELETE CASCADE,
  scene_number INTEGER NOT NULL,
  image_url TEXT,
  timeline TEXT,
  sources TEXT[],
  effect TEXT,
  special_notes TEXT,
  script TEXT,
  source_info TEXT,
  files JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE plan_scenes ADD COLUMN IF NOT EXISTS files JSONB;

ALTER TABLE plan_scenes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all operations on plan_scenes" ON plan_scenes;
CREATE POLICY "Allow all operations on plan_scenes" ON plan_scenes FOR ALL USING (true) WITH CHECK (true);

-- =============================================
-- 인덱스
-- =============================================
CREATE INDEX IF NOT EXISTS idx_ad_plans_advertiser_id ON ad_plans(advertiser_id);
CREATE INDEX IF NOT EXISTS idx_ad_plans_created_at ON ad_plans(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_advertisers_created_at ON advertisers(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_templates_created_at ON templates(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_plans_client_id ON project_plans(client_id);
CREATE INDEX IF NOT EXISTS idx_plan_scenes_plan_id ON plan_scenes(plan_id);
CREATE INDEX IF NOT EXISTS idx_client_permissions_user_id ON client_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_client_permissions_client_id ON client_permissions(client_id);

-- =============================================
-- 이미지 보드 카테고리 / 이미지 보드
-- =============================================
CREATE TABLE IF NOT EXISTS image_board_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  color TEXT DEFAULT '#E2E8F0',
  thumbnail_url TEXT,
  thumbnail_path TEXT,
  is_default BOOLEAN DEFAULT FALSE,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE image_board_categories ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;
ALTER TABLE image_board_categories ADD COLUMN IF NOT EXISTS thumbnail_path TEXT;

CREATE TABLE IF NOT EXISTS image_board_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  image_url TEXT NOT NULL,
  image_path TEXT NOT NULL UNIQUE,
  category_id UUID REFERENCES image_board_categories(id) ON DELETE SET NULL,
  ai_category TEXT,
  notes TEXT,
  width INTEGER,
  height INTEGER,
  file_size BIGINT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE image_board_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE image_board_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read image board categories" ON image_board_categories;
DROP POLICY IF EXISTS "Admins can manage image board categories" ON image_board_categories;
DROP POLICY IF EXISTS "Authenticated users can read image board items" ON image_board_items;
DROP POLICY IF EXISTS "Admins can manage image board items" ON image_board_items;

CREATE POLICY "Authenticated users can read image board categories" ON image_board_categories
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage image board categories" ON image_board_categories
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE user_profiles.id = auth.uid() AND user_profiles.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_profiles WHERE user_profiles.id = auth.uid() AND user_profiles.role = 'admin'));

CREATE POLICY "Authenticated users can read image board items" ON image_board_items
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage image board items" ON image_board_items
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE user_profiles.id = auth.uid() AND user_profiles.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_profiles WHERE user_profiles.id = auth.uid() AND user_profiles.role = 'admin'));

INSERT INTO image_board_categories (name, slug, color, is_default, sort_order)
VALUES
  ('의류', 'fashion', '#DBEAFE', true, 1),
  ('식품', 'food', '#FEF3C7', true, 2),
  ('부동산', 'real-estate', '#E0E7FF', true, 3),
  ('뷰티', 'beauty', '#FCE7F3', true, 4),
  ('건강', 'health', '#DCFCE7', true, 5),
  ('금융', 'finance', '#FDE68A', true, 6),
  ('교육', 'education', '#EDE9FE', true, 7),
  ('여행', 'travel', '#CFFAFE', true, 8),
  ('자동차', 'auto', '#E5E7EB', true, 9),
  ('가전', 'electronics', '#D1FAE5', true, 10),
  ('기타', 'etc', '#F3F4F6', true, 99)
ON CONFLICT (slug) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_image_board_items_created_at ON image_board_items(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_image_board_items_category_id ON image_board_items(category_id);

INSERT INTO storage.buckets (id, name, public)
VALUES ('image-board', 'image-board', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Authenticated users can view image board storage" ON storage.objects;
DROP POLICY IF EXISTS "Admins can upload image board storage" ON storage.objects;
DROP POLICY IF EXISTS "Admins can update image board storage" ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete image board storage" ON storage.objects;

CREATE POLICY "Authenticated users can view image board storage" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'image-board');

CREATE POLICY "Admins can upload image board storage" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'image-board' AND
    EXISTS (SELECT 1 FROM user_profiles WHERE user_profiles.id = auth.uid() AND user_profiles.role = 'admin')
  );

CREATE POLICY "Admins can update image board storage" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'image-board' AND
    EXISTS (SELECT 1 FROM user_profiles WHERE user_profiles.id = auth.uid() AND user_profiles.role = 'admin')
  )
  WITH CHECK (
    bucket_id = 'image-board' AND
    EXISTS (SELECT 1 FROM user_profiles WHERE user_profiles.id = auth.uid() AND user_profiles.role = 'admin')
  );

CREATE POLICY "Admins can delete image board storage" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'image-board' AND
    EXISTS (SELECT 1 FROM user_profiles WHERE user_profiles.id = auth.uid() AND user_profiles.role = 'admin')
  );

-- =============================================
-- 이미지 보드 세부 그룹 폴더
-- =============================================
CREATE TABLE IF NOT EXISTS image_board_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES image_board_categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  color TEXT DEFAULT '#E2E8F0',
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(category_id, slug)
);

ALTER TABLE image_board_items
  ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES image_board_groups(id) ON DELETE SET NULL;

ALTER TABLE image_board_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read image board groups" ON image_board_groups;
DROP POLICY IF EXISTS "Admins can manage image board groups" ON image_board_groups;

CREATE POLICY "Authenticated users can read image board groups" ON image_board_groups
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage image board groups" ON image_board_groups
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE user_profiles.id = auth.uid() AND user_profiles.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_profiles WHERE user_profiles.id = auth.uid() AND user_profiles.role = 'admin'));

CREATE INDEX IF NOT EXISTS idx_image_board_groups_category_id ON image_board_groups(category_id);
CREATE INDEX IF NOT EXISTS idx_image_board_items_group_id ON image_board_items(group_id);

-- =============================================
-- 영상 보드
-- =============================================
CREATE TABLE IF NOT EXISTS video_board_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  color TEXT DEFAULT '#E2E8F0',
  is_default BOOLEAN DEFAULT FALSE,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS video_board_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES video_board_categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  color TEXT DEFAULT '#E2E8F0',
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(category_id, slug)
);

CREATE TABLE IF NOT EXISTS video_board_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  video_url TEXT NOT NULL,
  video_path TEXT NOT NULL UNIQUE,
  poster_url TEXT,
  poster_path TEXT,
  category_id UUID REFERENCES video_board_categories(id) ON DELETE SET NULL,
  group_id UUID REFERENCES video_board_groups(id) ON DELETE SET NULL,
  ai_category TEXT,
  summary TEXT,
  timeline_notes TEXT,
  script_notes TEXT,
  duration NUMERIC,
  width INTEGER,
  height INTEGER,
  file_size BIGINT,
  mime_type TEXT,
  share_id TEXT NOT NULL UNIQUE,
  is_public BOOLEAN DEFAULT TRUE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE video_board_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_board_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_board_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read video board categories" ON video_board_categories;
DROP POLICY IF EXISTS "Admins can manage video board categories" ON video_board_categories;
DROP POLICY IF EXISTS "Authenticated users can read video board groups" ON video_board_groups;
DROP POLICY IF EXISTS "Admins can manage video board groups" ON video_board_groups;
DROP POLICY IF EXISTS "Authenticated users can read video board items" ON video_board_items;
DROP POLICY IF EXISTS "Admins can manage video board items" ON video_board_items;
DROP POLICY IF EXISTS "Public can view shared video board items" ON video_board_items;

CREATE POLICY "Authenticated users can read video board categories" ON video_board_categories
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage video board categories" ON video_board_categories
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE user_profiles.id = auth.uid() AND user_profiles.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_profiles WHERE user_profiles.id = auth.uid() AND user_profiles.role = 'admin'));

CREATE POLICY "Authenticated users can read video board groups" ON video_board_groups
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage video board groups" ON video_board_groups
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE user_profiles.id = auth.uid() AND user_profiles.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_profiles WHERE user_profiles.id = auth.uid() AND user_profiles.role = 'admin'));

CREATE POLICY "Authenticated users can read video board items" ON video_board_items
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage video board items" ON video_board_items
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE user_profiles.id = auth.uid() AND user_profiles.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_profiles WHERE user_profiles.id = auth.uid() AND user_profiles.role = 'admin'));

CREATE POLICY "Public can view shared video board items" ON video_board_items
  FOR SELECT TO anon USING (is_public = true);

INSERT INTO video_board_categories (name, slug, color, is_default, sort_order)
VALUES
  ('의류', 'fashion', '#DBEAFE', true, 1),
  ('식품', 'food', '#FEF3C7', true, 2),
  ('부동산', 'real-estate', '#E0E7FF', true, 3),
  ('뷰티', 'beauty', '#FCE7F3', true, 4),
  ('건강', 'health', '#DCFCE7', true, 5),
  ('금융', 'finance', '#FDE68A', true, 6),
  ('교육', 'education', '#EDE9FE', true, 7),
  ('여행', 'travel', '#CFFAFE', true, 8),
  ('자동차', 'auto', '#E5E7EB', true, 9),
  ('가전', 'electronics', '#D1FAE5', true, 10),
  ('기타', 'etc', '#F3F4F6', true, 99)
ON CONFLICT (slug) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_video_board_groups_category_id ON video_board_groups(category_id);
CREATE INDEX IF NOT EXISTS idx_video_board_items_category_id ON video_board_items(category_id);
CREATE INDEX IF NOT EXISTS idx_video_board_items_group_id ON video_board_items(group_id);
CREATE INDEX IF NOT EXISTS idx_video_board_items_share_id ON video_board_items(share_id);
CREATE INDEX IF NOT EXISTS idx_video_board_items_created_at ON video_board_items(created_at DESC);

INSERT INTO storage.buckets (id, name, public)
VALUES ('video-board', 'video-board', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Authenticated users can view video board storage" ON storage.objects;
DROP POLICY IF EXISTS "Public can view video board storage" ON storage.objects;
DROP POLICY IF EXISTS "Admins can upload video board storage" ON storage.objects;
DROP POLICY IF EXISTS "Admins can update video board storage" ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete video board storage" ON storage.objects;

CREATE POLICY "Authenticated users can view video board storage" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'video-board');

CREATE POLICY "Public can view video board storage" ON storage.objects
  FOR SELECT TO anon
  USING (bucket_id = 'video-board');

CREATE POLICY "Admins can upload video board storage" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'video-board' AND
    EXISTS (SELECT 1 FROM user_profiles WHERE user_profiles.id = auth.uid() AND user_profiles.role = 'admin')
  );

CREATE POLICY "Admins can update video board storage" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'video-board' AND
    EXISTS (SELECT 1 FROM user_profiles WHERE user_profiles.id = auth.uid() AND user_profiles.role = 'admin')
  )
  WITH CHECK (
    bucket_id = 'video-board' AND
    EXISTS (SELECT 1 FROM user_profiles WHERE user_profiles.id = auth.uid() AND user_profiles.role = 'admin')
  );

CREATE POLICY "Admins can delete video board storage" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'video-board' AND
    EXISTS (SELECT 1 FROM user_profiles WHERE user_profiles.id = auth.uid() AND user_profiles.role = 'admin')
  );
