-- Migration: add document_formatted_chunks cache table
-- Run this in the Supabase SQL Editor

CREATE TABLE IF NOT EXISTS document_formatted_chunks (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id       TEXT        NOT NULL,
  chunk_id          TEXT        NOT NULL,
  formatted_content TEXT        NOT NULL,
  created_at        TIMESTAMPTZ DEFAULT now(),
  UNIQUE (document_id, chunk_id)
);

CREATE INDEX IF NOT EXISTS idx_dfc_document_id ON document_formatted_chunks(document_id);
