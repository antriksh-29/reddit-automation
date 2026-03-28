-- Migration 004: Row Level Security policies
-- Ref: TECH-SPEC.md §4 (Migration 004), §8 (RLS chain)
--
-- RLS CHAIN:
--   users            → auth.uid() = id
--   businesses       → user_id = auth.uid()
--   competitors      → business_id → businesses.user_id = auth.uid()
--   monitored_subs   → business_id → businesses.user_id = auth.uid()
--   alerts           → business_id → businesses.user_id = auth.uid()
--   thread_analyses  → business_id → businesses.user_id = auth.uid()
--   chat_messages    → thread_analysis_id → thread_analyses → businesses
--   comment_drafts   → business_id → businesses.user_id = auth.uid()
--   credit_balances  → user_id = auth.uid() (READ only; writes via service role)
--   credit_txns      → user_id = auth.uid() (READ only; writes via service role)
--   event_logs       → user_id = auth.uid() OR user_id IS NULL

-- Enable RLS on all user-facing tables
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE monitored_subreddits ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE thread_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE thread_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE comment_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_logs ENABLE ROW LEVEL SECURITY;

-- subreddit_health_cache is PUBLIC READ (shared cache, no user data)
ALTER TABLE subreddit_health_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read health cache" ON subreddit_health_cache
  FOR SELECT USING (true);

-- businesses: direct user_id match
CREATE POLICY "Users can CRUD own business" ON businesses
  FOR ALL USING (user_id = auth.uid());

-- competitors: through businesses
CREATE POLICY "Users can CRUD own competitors" ON competitors
  FOR ALL USING (business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()));

-- monitored_subreddits: through businesses
CREATE POLICY "Users can CRUD own subreddits" ON monitored_subreddits
  FOR ALL USING (business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()));

-- alerts: through businesses
CREATE POLICY "Users can read/update own alerts" ON alerts
  FOR ALL USING (business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()));

-- thread_analyses: through businesses
CREATE POLICY "Users can CRUD own analyses" ON thread_analyses
  FOR ALL USING (business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()));

-- thread_chat_messages: through thread_analyses → businesses
CREATE POLICY "Users can CRUD own chat messages" ON thread_chat_messages
  FOR ALL USING (thread_analysis_id IN (
    SELECT id FROM thread_analyses WHERE business_id IN (
      SELECT id FROM businesses WHERE user_id = auth.uid()
    )
  ));

-- comment_drafts: through businesses
CREATE POLICY "Users can CRUD own drafts" ON comment_drafts
  FOR ALL USING (business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()));

-- credit_balances: users can only READ own balance (writes via service role)
CREATE POLICY "Users can read own credit balance" ON credit_balances
  FOR SELECT USING (user_id = auth.uid());

-- credit_transactions: users can only READ own transactions (writes via service role)
CREATE POLICY "Users can read own credit transactions" ON credit_transactions
  FOR SELECT USING (user_id = auth.uid());

-- event_logs: users see own events only
CREATE POLICY "Users can insert and read own events" ON event_logs
  FOR ALL USING (user_id = auth.uid() OR user_id IS NULL);
