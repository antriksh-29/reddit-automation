-- Migration 003: Indexes for query performance
-- Ref: TECH-SPEC.md §4 (Migration 003)

-- Alert queries (dashboard performance)
CREATE INDEX idx_alerts_business_created ON alerts(business_id, created_at DESC);
CREATE INDEX idx_alerts_business_priority ON alerts(business_id, priority_level, created_at DESC);
CREATE INDEX idx_alerts_business_seen ON alerts(business_id, is_seen, created_at DESC);
CREATE INDEX idx_alerts_business_category ON alerts(business_id, category, created_at DESC);

-- Alert deduplication
CREATE INDEX idx_alerts_reddit_post_id ON alerts(reddit_post_id);

-- Scanner queries
CREATE INDEX idx_monitored_subs_active ON monitored_subreddits(subreddit_name) WHERE is_active = true AND status = 'active';

-- Thread analysis history
CREATE INDEX idx_thread_analyses_business ON thread_analyses(business_id, created_at DESC);

-- Event logs (queryable analytics)
CREATE INDEX idx_event_logs_type_created ON event_logs(event_type, created_at);
CREATE INDEX idx_event_logs_user_created ON event_logs(user_id, created_at);

-- Subreddit cache lookup
CREATE INDEX idx_subreddit_cache_name ON subreddit_health_cache(subreddit_name);

-- Credit queries
CREATE INDEX idx_credit_transactions_user ON credit_transactions(user_id, created_at DESC);
CREATE INDEX idx_credit_transactions_action ON credit_transactions(user_id, action_type);
