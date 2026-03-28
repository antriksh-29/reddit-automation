-- Migration 007: Add notification preferences to users table
-- Stores email_enabled (boolean) and email_priorities (array of priority levels)
-- Default: email enabled, high + medium priorities

ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_preferences JSONB
  DEFAULT '{"email_enabled": true, "email_priorities": ["high", "medium"]}';
