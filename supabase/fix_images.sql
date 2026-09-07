-- ============================================================
-- Resume Recall Map — FIX: Missing PDF Image Data
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- Create a table for storing PDF image chunks
CREATE TABLE IF NOT EXISTS sheet_chunks (
  sheet_id TEXT NOT NULL,
  chunk_index INT NOT NULL,
  data TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (sheet_id, chunk_index)
);

-- Enable Row Level Security
ALTER TABLE sheet_chunks ENABLE ROW LEVEL SECURITY;

-- 1. Anyone can read any chunk (since sheet_ids are randomized UI UUIDs)
CREATE POLICY "Anyone can read chunks"
  ON sheet_chunks FOR SELECT
  USING (true);

-- 2. Authenticated users can insert chunks
CREATE POLICY "Users can insert chunks"
  ON sheet_chunks FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- 3. Authenticated users can update chunks
CREATE POLICY "Users can update chunks"
  ON sheet_chunks FOR UPDATE
  USING (auth.uid() IS NOT NULL);

-- 4. Authenticated users can delete chunks
CREATE POLICY "Users can delete chunks"
  ON sheet_chunks FOR DELETE
  USING (auth.uid() IS NOT NULL);
