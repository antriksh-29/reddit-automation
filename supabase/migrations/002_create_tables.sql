-- Migration 002: Create all 11 tables
-- Ref: TECH-SPEC.md §4, PRODUCT-SPEC.md §4

-- Users (synced from Supabase Auth)
CREATE TABLE users (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email            VARCHAR NOT NULL UNIQUE,
  name             VARCHAR,
  plan_tier        VARCHAR DEFAULT 'free' CHECK (plan_tier IN ('free', 'growth', 'custom')),
  trial_started_at TIMESTAMPTZ,
  trial_ends_at    TIMESTAMPTZ,
  auth_provider_id VARCHAR NOT NULL,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Businesses (1:1 with users for MVP)
CREATE TABLE businesses (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  website_url       VARCHAR,
  name              VARCHAR NOT NULL,
  description       TEXT,
  icp_description   TEXT,
  brand_voice       TEXT,
  keywords          JSONB DEFAULT '{"primary": [], "discovery": []}',
  embedding_vectors JSONB,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Competitors
CREATE TABLE competitors (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name          VARCHAR NOT NULL,
  url           VARCHAR,
  source        VARCHAR DEFAULT 'manual' CHECK (source IN ('auto_suggested', 'manual')),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Subreddit Health Cache (shared across all users)
CREATE TABLE subreddit_health_cache (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subreddit_name  VARCHAR NOT NULL UNIQUE,
  subscribers     INTEGER,
  posts_per_day   FLOAT,
  avg_comments    FLOAT,
  upvote_ratio    FLOAT,
  rules_count     INTEGER,
  rules_json      JSONB,
  activity_tag    VARCHAR CHECK (activity_tag IN ('strong', 'medium', 'weak')),
  engagement_tag  VARCHAR CHECK (engagement_tag IN ('strong', 'medium', 'weak')),
  moderation_tag  VARCHAR CHECK (moderation_tag IN ('strong', 'medium', 'weak')),
  overall_tag     VARCHAR CHECK (overall_tag IN ('strong', 'medium', 'weak')),
  health_details  JSONB,
  category        VARCHAR,
  last_refreshed  TIMESTAMPTZ DEFAULT NOW(),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Monitored Subreddits (per-business)
CREATE TABLE monitored_subreddits (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id        UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  subreddit_name     VARCHAR NOT NULL,
  relevance_keywords JSONB,
  icp_relevance_tag  VARCHAR CHECK (icp_relevance_tag IN ('strong', 'medium', 'weak')),
  source             VARCHAR DEFAULT 'manual' CHECK (source IN ('auto_suggested', 'manual')),
  is_active          BOOLEAN DEFAULT true,
  status             VARCHAR DEFAULT 'active' CHECK (status IN ('active', 'private', 'banned', 'not_found')),
  last_scanned_at    TIMESTAMPTZ,
  last_seen_post_id  VARCHAR,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(business_id, subreddit_name)
);

-- Alerts
CREATE TABLE alerts (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id      UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  subreddit_id     UUID NOT NULL REFERENCES monitored_subreddits(id) ON DELETE CASCADE,
  reddit_post_id   VARCHAR NOT NULL UNIQUE,
  post_title       TEXT NOT NULL,
  post_body        TEXT,
  post_author      VARCHAR,
  post_url         VARCHAR NOT NULL,
  post_created_at  TIMESTAMPTZ NOT NULL,
  upvotes          INTEGER DEFAULT 0,
  num_comments     INTEGER DEFAULT 0,
  priority_score   FLOAT,
  priority_level   VARCHAR CHECK (priority_level IN ('high', 'medium', 'low')),
  priority_factors JSONB,
  category         VARCHAR CHECK (category IN ('pain_point', 'solution_request', 'competitor_dissatisfaction', 'experience_sharing', 'industry_discussion')),
  email_status     VARCHAR DEFAULT 'pending' CHECK (email_status IN ('pending', 'sent', 'failed', 'skipped')),
  email_sent_at    TIMESTAMPTZ,
  is_seen          BOOLEAN DEFAULT false,
  seen_at          TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Thread Analyses
CREATE TABLE thread_analyses (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id           UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  alert_id              UUID REFERENCES alerts(id) ON DELETE SET NULL,
  reddit_url            VARCHAR NOT NULL,
  thread_title          TEXT,
  summary               TEXT,
  pain_points           JSONB,
  buying_signals        JSONB,
  competitive_landscape JSONB,
  sentiment             VARCHAR CHECK (sentiment IN ('positive', 'negative', 'neutral', 'mixed')),
  key_insights          JSONB,
  comment_count         INTEGER,
  analysis_status       VARCHAR DEFAULT 'pending' CHECK (analysis_status IN ('pending', 'complete', 'partial', 'failed')),
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- Thread Chat Messages
CREATE TABLE thread_chat_messages (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  thread_analysis_id  UUID NOT NULL REFERENCES thread_analyses(id) ON DELETE CASCADE,
  role                VARCHAR NOT NULL CHECK (role IN ('user', 'assistant')),
  content             TEXT NOT NULL,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Comment Drafts
CREATE TABLE comment_drafts (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  alert_id          UUID NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  business_id       UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  parent_comment_id VARCHAR,
  draft_text        TEXT NOT NULL,
  tone              VARCHAR,
  rule_check        JSONB,
  approval_state    VARCHAR DEFAULT 'pending' CHECK (approval_state IN ('pending', 'approved', 'rejected')),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Credit Balances (1:1 with users)
CREATE TABLE credit_balances (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  balance       FLOAT NOT NULL DEFAULT 0.00,
  lifetime_used FLOAT NOT NULL DEFAULT 0.00,
  last_reset_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Credit Transactions (audit trail)
CREATE TABLE credit_transactions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action_type     VARCHAR NOT NULL CHECK (action_type IN (
    'thread_analysis', 'thread_chat', 'draft_generation', 'draft_regeneration',
    'monthly_reset', 'plan_upgrade', 'trial_grant', 'trial_expiry', 'manual_adjustment'
  )),
  credits_used    FLOAT NOT NULL,
  balance_after   FLOAT NOT NULL,
  tokens_consumed INTEGER,
  model_used      VARCHAR,
  reference_id    UUID,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Event Logs
CREATE TABLE event_logs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  business_id UUID REFERENCES businesses(id) ON DELETE SET NULL,
  event_type  VARCHAR NOT NULL,
  event_data  JSONB,
  source      VARCHAR CHECK (source IN ('frontend', 'backend', 'cron', 'system')),
  session_id  VARCHAR,
  ip_address  VARCHAR,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
