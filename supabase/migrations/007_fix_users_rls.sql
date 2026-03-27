-- Migration 007: Add missing RLS policy for users table
-- The users table had RLS enabled but no SELECT policy,
-- causing all user queries via anon key to return empty.

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own row" ON users
  FOR SELECT USING (id = auth.uid());
