-- Migration: add research_mode column to messages table
-- Run this in Supabase SQL Editor for existing deployments

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS research_mode TEXT;
