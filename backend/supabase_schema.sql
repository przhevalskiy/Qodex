-- ===========================================
-- Qodex Supabase Schema
-- Run this in Supabase SQL Editor
-- ===========================================

-- 0. Document formatted chunks cache
--    Persists AI-formatted preview content so document opens are instant
--    after server restarts. Documents are shared (no RLS needed).
CREATE TABLE IF NOT EXISTS document_formatted_chunks (
  id            UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id   TEXT    NOT NULL,
  chunk_id      TEXT    NOT NULL,
  formatted_content TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE (document_id, chunk_id)
);

CREATE INDEX IF NOT EXISTS idx_dfc_document_id ON document_formatted_chunks(document_id);

-- 1. Profiles table (auto-populated from auth.users)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  display_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, display_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1))
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- 2. Discussions table
CREATE TABLE IF NOT EXISTS discussions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'New Chat',
  is_active BOOLEAN NOT NULL DEFAULT false,
  is_public BOOLEAN NOT NULL DEFAULT false,  -- when true, any authenticated user can read via share link
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_discussions_user_id ON discussions(user_id);
CREATE INDEX idx_discussions_updated_at ON discussions(updated_at DESC);

ALTER TABLE discussions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own discussions"
  ON discussions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own discussions"
  ON discussions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own discussions"
  ON discussions FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own discussions"
  ON discussions FOR DELETE
  USING (auth.uid() = user_id);

-- 3. Messages table
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discussion_id UUID NOT NULL REFERENCES discussions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  provider TEXT,
  tokens_used INTEGER,
  response_time_ms INTEGER,
  sources JSONB,
  citations JSONB,
  suggested_questions JSONB,
  intent TEXT,
  research_mode TEXT,
  user_display_name TEXT,
  user_email TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_messages_discussion_id ON messages(discussion_id);
CREATE INDEX idx_messages_discussion_created ON messages(discussion_id, created_at);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read messages in own discussions"
  ON messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM discussions
      WHERE discussions.id = messages.discussion_id
        AND discussions.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert messages in own discussions"
  ON messages FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM discussions
      WHERE discussions.id = messages.discussion_id
        AND discussions.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update messages in own discussions"
  ON messages FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM discussions
      WHERE discussions.id = messages.discussion_id
        AND discussions.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete messages in own discussions"
  ON messages FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM discussions
      WHERE discussions.id = messages.discussion_id
        AND discussions.user_id = auth.uid()
    )
  );

-- ===========================================
-- Share feature: cross-user read access
-- Run this block if upgrading an existing DB
-- (safe to run on a fresh schema too)
-- ===========================================

-- Add is_public to existing discussions table (no-op if column already exists)
ALTER TABLE discussions ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_discussions_is_public ON discussions(is_public) WHERE is_public = true;

-- Any authenticated user can SELECT a discussion that the owner has made public.
-- Invariant: owner-scoped policies above are unchanged; this only adds read for public rows.
CREATE POLICY "Authenticated users can read public discussions"
  ON discussions FOR SELECT
  USING (is_public = true AND auth.uid() IS NOT NULL);

-- Any authenticated user can SELECT messages whose parent discussion is public.
-- Invariant: join back to discussions ensures is_public check cannot be bypassed.
CREATE POLICY "Authenticated users can read messages in public discussions"
  ON messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM discussions
      WHERE discussions.id = messages.discussion_id
        AND discussions.is_public = true
        AND auth.uid() IS NOT NULL
    )
  );
