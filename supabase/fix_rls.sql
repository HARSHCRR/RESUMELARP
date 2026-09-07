-- ============================================================
-- Resume Recall Map — FIX: Infinite recursion in RLS policies
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- ── Step 1: Drop ALL existing policies that cause the loop ──

DROP POLICY IF EXISTS "Users can read own maps" ON maps;
DROP POLICY IF EXISTS "Anyone can read public maps" ON maps;
DROP POLICY IF EXISTS "Collaborators can read shared maps" ON maps;
DROP POLICY IF EXISTS "Users can create maps" ON maps;
DROP POLICY IF EXISTS "Users can update own maps" ON maps;
DROP POLICY IF EXISTS "Editors can update shared maps" ON maps;
DROP POLICY IF EXISTS "Users can delete own maps" ON maps;

DROP POLICY IF EXISTS "Owners can manage collaborators" ON collaborators;
DROP POLICY IF EXISTS "Users can see own collaborations" ON collaborators;

-- ── Step 2: Recreate maps policies (NO cross-table subqueries) ──

-- Users can read their own maps
CREATE POLICY "maps_select_own"
  ON maps FOR SELECT
  USING (auth.uid() = user_id);

-- Anyone can read public maps (no auth needed)
CREATE POLICY "maps_select_public"
  ON maps FOR SELECT
  USING (is_public = true);

-- Users can insert their own maps
CREATE POLICY "maps_insert_own"
  ON maps FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own maps
CREATE POLICY "maps_update_own"
  ON maps FOR UPDATE
  USING (auth.uid() = user_id);

-- Users can delete their own maps
CREATE POLICY "maps_delete_own"
  ON maps FOR DELETE
  USING (auth.uid() = user_id);

-- ── Step 3: Recreate collaborators policies (safe, no recursion) ──

-- Users can see collaborations they are part of
CREATE POLICY "collabs_select_own"
  ON collaborators FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert collaborators for maps they own
-- Uses a SECURITY DEFINER function to avoid recursion
CREATE OR REPLACE FUNCTION is_map_owner(map_uuid UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM maps WHERE id = map_uuid AND user_id = auth.uid()
  );
$$;

-- Map owners can add collaborators
CREATE POLICY "collabs_insert_owner"
  ON collaborators FOR INSERT
  WITH CHECK (is_map_owner(map_id));

-- Map owners can delete collaborators
CREATE POLICY "collabs_delete_owner"
  ON collaborators FOR DELETE
  USING (is_map_owner(map_id));

-- ── Step 4: Allow collaborators to read shared maps ──
-- Uses SECURITY DEFINER function to break the recursion cycle

CREATE OR REPLACE FUNCTION is_collaborator(map_uuid UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM collaborators WHERE map_id = map_uuid AND user_id = auth.uid()
  );
$$;

CREATE POLICY "maps_select_collab"
  ON maps FOR SELECT
  USING (is_collaborator(id));

-- Collaborator editors can update shared maps
CREATE OR REPLACE FUNCTION is_editor(map_uuid UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM collaborators
    WHERE map_id = map_uuid AND user_id = auth.uid() AND role = 'editor'
  );
$$;

CREATE POLICY "maps_update_collab"
  ON maps FOR UPDATE
  USING (is_editor(id));
