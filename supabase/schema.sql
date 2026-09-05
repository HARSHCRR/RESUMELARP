-- ============================================================
-- Resume Recall Map — Supabase Schema
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- Maps table: stores each canvas/map
CREATE TABLE IF NOT EXISTS maps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title TEXT DEFAULT 'Untitled Map',
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_public BOOLEAN DEFAULT false,
  share_code TEXT UNIQUE DEFAULT encode(gen_random_bytes(6), 'hex'),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Collaborators table: who has access to shared maps
CREATE TABLE IF NOT EXISTS collaborators (
  map_id UUID REFERENCES maps(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'editor' CHECK (role IN ('editor', 'viewer')),
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (map_id, user_id)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_maps_user_id ON maps(user_id);
CREATE INDEX IF NOT EXISTS idx_maps_share_code ON maps(share_code);
CREATE INDEX IF NOT EXISTS idx_collaborators_user_id ON collaborators(user_id);

-- Enable Row Level Security
ALTER TABLE maps ENABLE ROW LEVEL SECURITY;
ALTER TABLE collaborators ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Policies: maps
-- ============================================================

-- Users can see their own maps
CREATE POLICY "Users can read own maps"
  ON maps FOR SELECT
  USING (auth.uid() = user_id);

-- Users can see public maps
CREATE POLICY "Anyone can read public maps"
  ON maps FOR SELECT
  USING (is_public = true);

-- Collaborators can see shared maps
CREATE POLICY "Collaborators can read shared maps"
  ON maps FOR SELECT
  USING (
    id IN (SELECT map_id FROM collaborators WHERE user_id = auth.uid())
  );

-- Users can insert their own maps
CREATE POLICY "Users can create maps"
  ON maps FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own maps
CREATE POLICY "Users can update own maps"
  ON maps FOR UPDATE
  USING (auth.uid() = user_id);

-- Collaborator editors can update shared maps
CREATE POLICY "Editors can update shared maps"
  ON maps FOR UPDATE
  USING (
    id IN (SELECT map_id FROM collaborators WHERE user_id = auth.uid() AND role = 'editor')
  );

-- Users can delete their own maps
CREATE POLICY "Users can delete own maps"
  ON maps FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================
-- Policies: collaborators
-- ============================================================

-- Map owners can manage collaborators
CREATE POLICY "Owners can manage collaborators"
  ON collaborators FOR ALL
  USING (
    map_id IN (SELECT id FROM maps WHERE user_id = auth.uid())
  );

-- Users can see their own collaborations
CREATE POLICY "Users can see own collaborations"
  ON collaborators FOR SELECT
  USING (auth.uid() = user_id);

-- ============================================================
-- Enable Realtime on maps table
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE maps;

-- ============================================================
-- Auto-update updated_at timestamp
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER maps_updated_at
  BEFORE UPDATE ON maps
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();
