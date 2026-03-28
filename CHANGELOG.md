# Changelog

All notable changes to this project will be documented in this file.

## [1.0.0.0] - 2026-03-28

### Added
- **Onboarding:** 2-step wizard with AI-powered business analysis (Claude Sonnet) and subreddit/keyword discovery
- **Scanner Worker:** MiniLM-L6-v2 semantic pre-filter + Claude Haiku relevance scoring, 30-min scan cycles
- **Dashboard:** Alert feed with New/Seen split, multi-select filters (priority, category, subreddit, date), sort options
- **Thread Analysis:** Chat interface with sidebar history, AI summaries (pain points, insights, buying signals, competitive landscape), suggested follow-up questions
- **Comment Drafting:** GPT-5.4 powered drafts with 2 tones (Story & Experience / Framework & Tactical), per-draft regenerate, edit-in-place, AI draft review
- **Settings:** Sidebar tabbed layout (Business Profile / Notifications / Usage & Billing)
- **Credits System:** Token-based (1 credit ≈ 1000 tokens), atomic SQL deduction, pre-action confirmation dialogs with cost estimates
- **Email Alerts:** Batched per scan cycle via Amazon SES, configurable priority thresholds
- **Pricing:** Free (3-day trial, 3 subs, 25 credits) / Growth ($39/mo, 10 subs, 250 credits) / Custom
- **Auth:** Google OAuth via Supabase Auth with middleware-protected routes
- **Security:** IDOR protection on all endpoints, SSRF protection, per-business dedup, sanitized error messages
- **Trial Expiry:** Banner for expired free users, scanner skips expired trials
- **Monthly Credit Reset:** Worker cron for Growth plan users (30-day cycle)
- **LLM Failover:** Claude ↔ OpenAI with same prompts, 3-failure threshold
- **5 Post Categories:** Pain Point, Solution Request, Competitor Dissatisfaction, Experience Sharing, Industry Discussion
- **Priority Scoring:** 40% relevance + 30% recency + 15% velocity + 15% intent
