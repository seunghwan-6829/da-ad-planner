-- =============================================
-- 촬영 가이드 (Shooting Guide) 스키마
-- Supabase SQL Editor에서 1회 실행하세요.
-- video_board_items 의 공개 공유 패턴을 그대로 따릅니다.
-- =============================================

-- 1) user_settings 에 OpenAI 키 컬럼 추가 (촬영 가이드 이미지 생성용)
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS openai_api_key TEXT;

-- 2) 촬영 가이드 (브랜드별 N건의 샷 리스트)
CREATE TABLE IF NOT EXISTS shooting_guides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '촬영 가이드',
  ratio TEXT NOT NULL DEFAULT '9:16',
  tips TEXT,
  share_id TEXT NOT NULL UNIQUE,
  is_public BOOLEAN DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'draft', -- draft | generating | ready
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3) 컷 (가이드당 여러 컷)
CREATE TABLE IF NOT EXISTS shooting_guide_shots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guide_id UUID NOT NULL REFERENCES shooting_guides(id) ON DELETE CASCADE,
  shot_number INTEGER NOT NULL,
  name TEXT,
  description TEXT,
  framing TEXT,
  angle TEXT,
  duration TEXT,
  direction TEXT,
  image_url TEXT,
  image_path TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE shooting_guides ENABLE ROW LEVEL SECURITY;
ALTER TABLE shooting_guide_shots ENABLE ROW LEVEL SECURITY;

-- 4) RLS 정책
DROP POLICY IF EXISTS "Authenticated manage shooting guides" ON shooting_guides;
DROP POLICY IF EXISTS "Public can view shared shooting guides" ON shooting_guides;
DROP POLICY IF EXISTS "Authenticated manage shooting guide shots" ON shooting_guide_shots;
DROP POLICY IF EXISTS "Public can view shared shooting guide shots" ON shooting_guide_shots;

CREATE POLICY "Authenticated manage shooting guides" ON shooting_guides
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Public can view shared shooting guides" ON shooting_guides
  FOR SELECT TO anon USING (is_public = true);

CREATE POLICY "Authenticated manage shooting guide shots" ON shooting_guide_shots
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Public can view shared shooting guide shots" ON shooting_guide_shots
  FOR SELECT TO anon USING (
    EXISTS (SELECT 1 FROM shooting_guides g WHERE g.id = guide_id AND g.is_public = true)
  );

-- 5) 인덱스
CREATE INDEX IF NOT EXISTS idx_shooting_guides_client_id ON shooting_guides(client_id);
CREATE INDEX IF NOT EXISTS idx_shooting_guides_share_id ON shooting_guides(share_id);
CREATE INDEX IF NOT EXISTS idx_shooting_guides_created_at ON shooting_guides(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shooting_guide_shots_guide_id ON shooting_guide_shots(guide_id);

-- 6) 스토리지 버킷 (공개 읽기)
INSERT INTO storage.buckets (id, name, public)
VALUES ('shooting-guides', 'shooting-guides', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Public can view shooting guide storage" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can upload shooting guide storage" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can update shooting guide storage" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can delete shooting guide storage" ON storage.objects;

CREATE POLICY "Public can view shooting guide storage" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'shooting-guides');

CREATE POLICY "Authenticated can upload shooting guide storage" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'shooting-guides');

CREATE POLICY "Authenticated can update shooting guide storage" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'shooting-guides')
  WITH CHECK (bucket_id = 'shooting-guides');

CREATE POLICY "Authenticated can delete shooting guide storage" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'shooting-guides');
