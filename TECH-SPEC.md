# Technical Specification: Reddit Lead Intelligence Platform

**Version:** 1.0
**Date:** 2026-03-25
**Status:** Approved — Ready for Implementation
**Purpose:** Complete technical blueprint for engineering execution. All architecture decisions resolved. Covers stack, infrastructure, project structure, database, APIs, worker design, security, testing, performance, deployment, and build order.

---

## 1. Technology Stack

| Layer | Technology | Version | Why |
|-------|-----------|---------|-----|
| **Framework** | Next.js (App Router) | 15.x | Server components, API routes, best-in-class Vercel DX |
| **Language** | TypeScript | 5.x | Type safety across frontend + worker + shared libs |
| **Database** | Supabase (PostgreSQL) | — | Managed Postgres + Auth + RLS + pgvector + Realtime |
| **Auth** | Supabase Auth | — | Native RLS integration, one vendor, 50K free MAUs |
| **Frontend hosting** | Vercel | — | Instant deploys, preview URLs per PR, edge functions |
| **Worker hosting** | Railway | — | Long-running Node.js process, always-on, auto-restart |
| **ML model** | all-MiniLM-L6-v2 via @huggingface/transformers | — | Local semantic embeddings, 80MB, ~5ms/embedding, Apache 2.0 |
| **Vector search** | pgvector (Supabase extension) | — | VECTOR(384) columns with HNSW index for similarity search |
| **LLM (scoring)** | Claude Haiku (Anthropic) | — | Fast, cheap. Relevance scoring, health assessment, ICP matching |
| **LLM (analysis)** | Claude Sonnet (Anthropic) | — | High quality. Thread analysis, chat follow-ups, onboarding agents |
| **LLM (drafting)** | GPT-4o / GPT-4o-mini (OpenAI) | — | Comment drafting. Separate provider for diversity + failover |
| **Email** | Amazon SES | — | $0.10/1000 emails, no daily cap. Critical for alerting product |
| **Styling** | Tailwind CSS | 4.x | Utility-first, matches DESIGN-SYSTEM.md tokens |
| **UI components** | shadcn/ui | — | Unstyled primitives, fully customizable to our dark theme |
| **Testing** | Vitest + Playwright | — | Unit/integration + E2E. Tests from day 1 |
| **Package manager** | pnpm | — | Fast, strict, disk-efficient |
| **Linting** | ESLint + Prettier | — | Standard Next.js config |

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER BROWSER                             │
│  Dark-mode SPA: Dashboard ←→ Thread Analysis ←→ Settings         │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTPS
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    VERCEL (Frontend + API)                        │
│                                                                   │
│  Next.js App Router                                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐   │
│  │/dashboard │ │/threads  │ │/settings │ │/onboarding       │   │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘   │
│                                                                   │
│  API Routes (/api/*)                                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐   │
│  │/alerts   │ │/threads  │ │/drafts   │ │/onboarding       │   │
│  │CRUD +    │ │analyze + │ │generate +│ │agent pipeline +  │   │
│  │filters   │ │chat      │ │regen     │ │setup             │   │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐   │
│  │/auth     │ │/events   │ │/subs     │ │/worker/scan-now  │   │
│  │Supabase  │ │FE logs   │ │add/del/  │ │triggers Railway  │   │
│  │Auth      │ │batched   │ │validate  │ │webhook           │   │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘   │
│                             │                                     │
│                             ▼                                     │
│                   ┌─────────────────────┐                        │
│                   │      Supabase       │◄── RLS enforced ──┐    │
│                   │  PostgreSQL + Auth   │   All queries      │    │
│                   │  + pgvector + RLS    │   scoped by        │    │
│                   └─────────────────────┘   business_id      │    │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
                             │
               ┌─────────────┴─────────────┐
               ▼                           ▼
┌──────────────────────────────┐  ┌─────────────────────────┐
│     RAILWAY (Worker)          │  │   External Services      │
│     Always-on, auto-restart   │  │                          │
│                               │  │  Reddit API (OAuth2)    │
│  ┌─────────────────────────┐ │  │    100 req/min          │
│  │ ML Model (MiniLM-L6-v2) │ │  │  Claude API             │
│  │ Loaded ONCE at startup   │ │  │    Haiku + Sonnet       │
│  │ ~80MB RAM, ~5ms/embed    │ │  │  OpenAI API             │
│  └─────────────────────────┘ │  │    GPT-4o / GPT-4o-mini │
│                               │  │  Amazon SES             │
│  ┌─────────────────────────┐ │  │    Alerting emails      │
│  │ Scanner Loop             │ │  └─────────────────────────┘
│  │ setInterval(15 min)      │ │
│  │                          │ │
│  │ Per cycle:               │ │
│  │ 1. Fetch unique subs     │ │
│  │ 2. Reddit API (shared)   │ │
│  │ 3. Pass 1 per-user       │ │
│  │ 4. Pass 2 per-user       │ │
│  │    (parallel, p-limit=10)│ │
│  │ 5. Create alerts + email │ │
│  └─────────────────────────┘ │
│                               │
│  Health: GET /health          │
│  Trigger: POST /scan-now      │
│    (shared secret auth)       │
└──────────────────────────────┘
```

### Data Flow: Reddit Post → User Alert

```
Reddit API                    Railway Worker                        Supabase                    Vercel/User
─────────                     ──────────────                        ────────                    ───────────
  │                               │                                    │                            │
  │◄──── GET /r/{sub}/new.json ───┤                                    │                            │
  │─── posts[] ──────────────────►│                                    │                            │
  │                               │                                    │                            │
  │                               ├── FOR each post:                   │                            │
  │                               │   ├── Dedup check ────────────────►│                            │
  │                               │   │◄─── exists? ──────────────────┤                            │
  │                               │   │                                │                            │
  │                               │   ├── FOR each user on this sub:   │                            │
  │                               │   │   ├── Pass 1: embed(post)      │                            │
  │                               │   │   │   cosine(post, user.vecs)  │                            │
  │                               │   │   │   + keyword + intent boost │                            │
  │                               │   │   │                            │                            │
  │                               │   │   ├── score >= 0.4?            │                            │
  │                               │   │   │   NO → discard             │                            │
  │                               │   │   │   YES ↓                    │                            │
  │                               │   │   │                            │                            │
  │                               │   │   ├── Pass 2: Haiku LLM ──────┼── (Claude API) ──►         │
  │                               │   │   │◄── relevance + category ───┼── ◄──────────────         │
  │                               │   │   │                            │                            │
  │                               │   │   ├── Calculate priority       │                            │
  │                               │   │   │   (40/30/15/15 weights)    │                            │
  │                               │   │   │                            │                            │
  │                               │   │   ├── priority >= 0.2?         │                            │
  │                               │   │   │   NO → discard             │                            │
  │                               │   │   │   YES ↓                    │                            │
  │                               │   │   │                            │                            │
  │                               │   │   ├── INSERT alert ───────────►│                            │
  │                               │   │   │                            │                            │
  │                               │   │   ├── HIGH priority?           │                            │
  │                               │   │   │   YES → SES email ─────────┼──────────────────────────►│
  │                               │   │   │                            │                            │
  │                               │   └── end user loop                │                            │
  │                               └── end post loop                    │                            │
  │                                                                    │                            │
  │                               │── UPDATE last_scanned_at ─────────►│                            │
```

---

## 3. Project Structure

```
reddit-intel/
├── src/
│   ├── app/                          # Next.js App Router
│   │   ├── (auth)/                   # Auth layout group
│   │   │   ├── login/page.tsx        # Login page (Supabase Auth UI)
│   │   │   └── signup/page.tsx       # Signup page
│   │   ├── (app)/                    # Authenticated app layout group
│   │   │   ├── layout.tsx            # App shell: sidebar + top nav
│   │   │   ├── dashboard/
│   │   │   │   └── page.tsx          # Alert feed + filters + monitored subs
│   │   │   ├── threads/
│   │   │   │   └── page.tsx          # Thread analysis chat + sidebar history
│   │   │   └── settings/
│   │   │       └── page.tsx          # Tabbed settings (sidebar layout)
│   │   ├── onboarding/
│   │   │   └── page.tsx              # 2-step wizard (URL → profile + setup)
│   │   ├── api/
│   │   │   ├── alerts/
│   │   │   │   ├── route.ts          # GET (list + filter) + POST (mark seen)
│   │   │   │   └── [id]/route.ts     # GET single alert
│   │   │   ├── threads/
│   │   │   │   ├── analyze/route.ts  # POST: trigger thread analysis
│   │   │   │   └── chat/route.ts     # POST: send follow-up message
│   │   │   ├── drafts/
│   │   │   │   ├── generate/route.ts # POST: generate 2 drafts
│   │   │   │   └── [id]/
│   │   │   │       └── regenerate/route.ts  # POST: regenerate single draft
│   │   │   ├── onboarding/
│   │   │   │   ├── analyze-url/route.ts     # POST: Agent 1 (business intel)
│   │   │   │   ├── discover/route.ts        # POST: Agent 2 (subreddits + keywords)
│   │   │   │   └── complete/route.ts        # POST: save profile + trigger first scan
│   │   │   ├── subreddits/
│   │   │   │   ├── route.ts          # POST (add) + DELETE (remove)
│   │   │   │   └── validate/route.ts # POST: check existence via Reddit API
│   │   │   ├── settings/
│   │   │   │   └── route.ts          # GET + PUT business profile, notifications
│   │   │   ├── credits/
│   │   │   │   ├── route.ts          # GET: balance + recent transactions
│   │   │   │   └── check/route.ts    # POST: pre-check if user has enough credits
│   │   │   ├── upgrade/
│   │   │   │   └── route.ts          # POST: handle plan upgrade (Stripe checkout)
│   │   │   ├── events/
│   │   │   │   └── route.ts          # POST: batch frontend event logging
│   │   │   └── auth/
│   │   │       └── callback/route.ts # Supabase Auth callback
│   │   └── layout.tsx                # Root layout (fonts, theme)
│   │
│   ├── components/
│   │   ├── ui/                       # Design system primitives
│   │   │   ├── button.tsx            # Primary, secondary, ghost variants
│   │   │   ├── card.tsx              # Surface card with hover border
│   │   │   ├── input.tsx             # Text input with focus accent
│   │   │   ├── tag.tsx               # Health tags, category tags, neutral tags
│   │   │   ├── dropdown.tsx          # Filter/sort hover dropdowns
│   │   │   └── sidebar.tsx           # Sidebar navigation component
│   │   ├── alerts/
│   │   │   ├── alert-card.tsx        # Single alert card (priority dot, title, meta, CTAs)
│   │   │   ├── alert-list.tsx        # New/Seen split list with load more
│   │   │   └── filter-bar.tsx        # Filter by + Sort by dropdowns
│   │   ├── threads/
│   │   │   ├── analysis-view.tsx     # Main analysis display (summary, pain, intent, etc.)
│   │   │   ├── chat-interface.tsx    # Follow-up chat input + messages
│   │   │   ├── suggested-questions.tsx # Clickable question chips
│   │   │   └── history-sidebar.tsx   # Past analyses grouped by date
│   │   ├── drafts/
│   │   │   ├── draft-card.tsx        # Single draft with Copy/Edit/Regenerate/Approve
│   │   │   └── drafts-view.tsx       # 2 drafts + subreddit rules header
│   │   ├── onboarding/
│   │   │   ├── url-step.tsx          # Step 1: website URL input
│   │   │   └── profile-step.tsx      # Step 2: profile + keywords + subs
│   │   ├── settings/
│   │   │   ├── business-profile.tsx  # Business profile form
│   │   │   ├── notifications.tsx     # Notification preferences
│   │   │   └── usage-billing.tsx     # Plan info + credit history + upgrade CTA
│   │   ├── credits/
│   │   │   ├── credit-badge.tsx      # Nav bar credit balance display (always visible)
│   │   │   ├── credit-gate.tsx       # Pre-action credit check modal (estimate + confirm)
│   │   │   └── upgrade-cta.tsx       # Upgrade prompts (trial expired, credits exhausted, etc.)
│   │   └── layout/
│   │       ├── app-shell.tsx         # Sidebar + top nav + main content area
│   │       ├── top-nav.tsx           # Dashboard | Thread Analysis | Settings
│   │       └── monitored-subs.tsx    # Subreddit list with health tags
│   │
│   ├── lib/
│   │   ├── supabase/
│   │   │   ├── client.ts            # Browser Supabase client
│   │   │   ├── server.ts            # Server-side Supabase client (cookies)
│   │   │   ├── admin.ts             # Service-role client (worker use only)
│   │   │   ├── types.ts             # Generated DB types (supabase gen types)
│   │   │   └── rls.sql              # RLS policy definitions (reference)
│   │   ├── llm/
│   │   │   ├── client.ts            # Unified LLM client with failover logic
│   │   │   ├── claude.ts            # Anthropic SDK wrapper
│   │   │   ├── openai.ts            # OpenAI SDK wrapper
│   │   │   ├── failover.ts          # 3-failure / 10s-timeout → switch provider
│   │   │   └── types.ts             # LLM response types
│   │   ├── reddit/
│   │   │   ├── client.ts            # Reddit OAuth2 API client
│   │   │   ├── rate-limiter.ts      # Token bucket (100 req/min global)
│   │   │   └── types.ts             # Reddit API response types
│   │   ├── email/
│   │   │   └── ses.ts               # Amazon SES client + send alert email
│   │   ├── scoring/
│   │   │   ├── priority.ts          # Priority score calculation (40/30/15/15)
│   │   │   └── recency.ts           # Recency tier function
│   │   ├── credits/
│   │   │   ├── manager.ts           # Credit check, deduct, grant, reset
│   │   │   ├── pricing.ts           # Plan limits, credit allocations, subreddit caps
│   │   │   └── types.ts             # Credit-related types
│   │   └── events/
│   │       ├── tracker.ts           # Frontend event batching utility
│   │       └── types.ts             # Event taxonomy types
│   │
│   └── types/
│       ├── alerts.ts                # Alert, priority, category types
│       ├── threads.ts               # Thread analysis, chat message types
│       ├── business.ts              # Business, competitor, keyword types
│       └── subreddits.ts            # Subreddit, health assessment types
│
├── worker/
│   ├── index.ts                     # Entry point: load model → start loop → health server
│   ├── scanner.ts                   # Main scan orchestration (per-subreddit, per-user)
│   ├── prefilter.ts                 # Pass 1: semantic + keyword + regex scoring
│   ├── embeddings.ts                # Embedding generation + cosine similarity via pgvector
│   ├── health.ts                    # GET /health (model loaded? last scan time? errors?)
│   └── scan-now.ts                  # POST /scan-now webhook handler
│
├── prompts/                         # LLM prompt templates (version-controlled markdown)
│   ├── relevance-scoring.md         # Pass 2 Haiku prompt
│   ├── thread-analysis.md           # Sonnet thread analysis prompt
│   ├── thread-chat.md               # Sonnet follow-up chat prompt
│   ├── comment-drafting.md          # GPT-4o comment draft prompt
│   ├── onboarding-agent1.md         # Business Intelligence Agent prompt
│   ├── onboarding-agent2.md         # Discovery Agent prompt
│   └── health-assessment.md         # Subreddit health assessment prompt
│
├── supabase/
│   └── migrations/
│       ├── 001_enable_extensions.sql     # pgvector, uuid-ossp
│       ├── 002_create_tables.sql         # All 11 tables (incl. credit_balances, credit_transactions)
│       ├── 003_create_indexes.sql        # 4 composite indexes + HNSW
│       ├── 004_create_rls_policies.sql   # RLS policies for every table
│       └── 005_seed_subreddits.sql       # Pre-seed ~500 popular subreddits
│
├── tests/
│   ├── unit/
│   │   ├── scoring/
│   │   │   ├── priority.test.ts     # Priority calculation (all weight combos)
│   │   │   └── recency.test.ts      # Recency tiers (all 6 brackets)
│   │   ├── worker/
│   │   │   ├── prefilter.test.ts    # Pass 1 scoring (semantic + boosts)
│   │   │   ├── scanner.test.ts      # Scan orchestration (dedup, skip inactive)
│   │   │   └── embeddings.test.ts   # Embedding generation + similarity
│   │   ├── llm/
│   │   │   ├── failover.test.ts     # 3-failure switch, timeout switch, cooldown
│   │   │   └── client.test.ts       # Unified client routing
│   │   └── reddit/
│   │       ├── client.test.ts       # API calls, response parsing
│   │       └── rate-limiter.test.ts # Token bucket (burst, refill, exhaustion)
│   ├── integration/
│   │   ├── onboarding.test.ts       # Agent pipeline end-to-end (mocked LLM)
│   │   ├── scan-cycle.test.ts       # Full scan cycle with test DB
│   │   └── thread-analysis.test.ts  # Analysis + chat flow (mocked LLM)
│   └── e2e/
│       ├── onboarding.spec.ts       # URL → profile → subreddits → dashboard
│       ├── dashboard.spec.ts        # Filter, sort, mark seen, click actions
│       ├── thread-analysis.spec.ts  # Analyze → suggested Q → follow-up → history
│       └── settings.spec.ts         # Edit profile, add/remove subs, save
│
├── public/                          # Static assets
├── PRODUCT-SPEC.md                  # Product specification (what to build)
├── TECH-SPEC.md                     # This file (how to build it)
├── DESIGN.md                        # Product strategy doc (why to build it)
├── DESIGN-SYSTEM.md                 # Visual design system (how it looks)
├── CLAUDE.md                        # AI agent instructions
├── package.json
├── tsconfig.json
├── next.config.ts
├── tailwind.config.ts
├── vitest.config.ts
├── playwright.config.ts
└── .env.local.example               # Required environment variables
```

---

## 4. Database Schema (Supabase + pgvector)

### Migration 001: Extensions

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";
```

### Migration 002: Tables

```sql
-- Users (synced from Supabase Auth)
CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email           VARCHAR NOT NULL UNIQUE,
  name            VARCHAR,
  plan_tier       VARCHAR DEFAULT 'free' CHECK (plan_tier IN ('free', 'growth', 'custom')),
  trial_started_at TIMESTAMPTZ,   -- Set on onboarding completion
  trial_ends_at   TIMESTAMPTZ,    -- trial_started_at + 3 days
  auth_provider_id VARCHAR NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
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
  embedding_vectors JSONB,  -- Array of {label: string, vector: float[384]}
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
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id       UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  subreddit_name    VARCHAR NOT NULL,
  relevance_keywords JSONB,
  icp_relevance_tag VARCHAR CHECK (icp_relevance_tag IN ('strong', 'medium', 'weak')),
  source            VARCHAR DEFAULT 'manual' CHECK (source IN ('auto_suggested', 'manual')),
  is_active         BOOLEAN DEFAULT true,
  status            VARCHAR DEFAULT 'active' CHECK (status IN ('active', 'private', 'banned', 'not_found')),
  last_scanned_at   TIMESTAMPTZ,
  last_seen_post_id VARCHAR,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(business_id, subreddit_name)
);

-- Alerts
CREATE TABLE alerts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id     UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  subreddit_id    UUID NOT NULL REFERENCES monitored_subreddits(id) ON DELETE CASCADE,
  reddit_post_id  VARCHAR NOT NULL UNIQUE,
  post_title      TEXT NOT NULL,
  post_body       TEXT,
  post_author     VARCHAR,
  post_url        VARCHAR NOT NULL,
  post_created_at TIMESTAMPTZ NOT NULL,
  upvotes         INTEGER DEFAULT 0,
  num_comments    INTEGER DEFAULT 0,
  priority_score  FLOAT,
  priority_level  VARCHAR CHECK (priority_level IN ('high', 'medium', 'low')),
  priority_factors JSONB,
  category        VARCHAR CHECK (category IN ('pain_point', 'solution_request', 'competitor_dissatisfaction', 'experience_sharing', 'industry_discussion')),
  email_status    VARCHAR DEFAULT 'pending' CHECK (email_status IN ('pending', 'sent', 'failed', 'skipped')),
  email_sent_at   TIMESTAMPTZ,
  is_seen         BOOLEAN DEFAULT false,
  seen_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Thread Analyses
CREATE TABLE thread_analyses (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id     UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  alert_id        UUID REFERENCES alerts(id) ON DELETE SET NULL,
  reddit_url      VARCHAR NOT NULL,
  thread_title    TEXT,
  summary         TEXT,
  pain_points     JSONB,
  buying_signals  JSONB,
  competitive_landscape JSONB,
  sentiment       VARCHAR CHECK (sentiment IN ('positive', 'negative', 'neutral', 'mixed')),
  key_insights    JSONB,
  comment_count   INTEGER,
  analysis_status VARCHAR DEFAULT 'pending' CHECK (analysis_status IN ('pending', 'complete', 'partial', 'failed')),
  created_at      TIMESTAMPTZ DEFAULT NOW()
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
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  balance         FLOAT NOT NULL DEFAULT 0.00,
  lifetime_used   FLOAT NOT NULL DEFAULT 0.00,
  last_reset_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Credit Transactions (audit trail for all credit changes)
CREATE TABLE credit_transactions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action_type     VARCHAR NOT NULL CHECK (action_type IN (
    'thread_analysis', 'thread_chat', 'draft_generation', 'draft_regeneration',
    'monthly_reset', 'plan_upgrade', 'trial_grant', 'trial_expiry', 'manual_adjustment'
  )),
  credits_used    FLOAT NOT NULL,  -- positive = deducted, negative = added
  balance_after   FLOAT NOT NULL,
  tokens_consumed INTEGER,         -- total LLM tokens (input + output)
  model_used      VARCHAR,
  reference_id    UUID,            -- FK to thread_analyses / comment_drafts / etc.
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
```

### Migration 003: Indexes

```sql
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
```

### Migration 004: RLS Policies

```sql
-- Enable RLS on all user-facing tables
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE monitored_subreddits ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE thread_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE thread_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE comment_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_logs ENABLE ROW LEVEL SECURITY;

-- subreddit_health_cache is PUBLIC READ (shared cache, no user data)
ALTER TABLE subreddit_health_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read health cache" ON subreddit_health_cache
  FOR SELECT USING (true);

-- RLS chain: table → businesses.user_id → auth.uid()
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

-- credit_balances: users see own balance only
ALTER TABLE credit_balances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own credit balance" ON credit_balances
  FOR SELECT USING (user_id = auth.uid());
-- Writes handled by service role (server-side only)

-- credit_transactions: users see own transactions only
ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own credit transactions" ON credit_transactions
  FOR SELECT USING (user_id = auth.uid());
-- Writes handled by service role (server-side only)

-- event_logs: users see own events only
CREATE POLICY "Users can insert and read own events" ON event_logs
  FOR ALL USING (user_id = auth.uid() OR user_id IS NULL);
```

---

## 5. Environment Variables

```bash
# .env.local.example

# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_xxx
SUPABASE_SERVICE_ROLE_KEY=sb_secret_xxx

# Reddit API (OAuth2 script app)
REDDIT_CLIENT_ID=xxx
REDDIT_CLIENT_SECRET=xxx
REDDIT_USER_AGENT=reddit-intel/1.0 (by /u/your-reddit-account)

# Anthropic (Claude)
ANTHROPIC_API_KEY=sk-ant-xxx

# OpenAI
OPENAI_API_KEY=sk-xxx

# Amazon SES
AWS_ACCESS_KEY_ID=xxx
AWS_SECRET_ACCESS_KEY=xxx
AWS_REGION=us-east-1
SES_FROM_EMAIL=alerts@yourdomain.com

# Worker communication
WORKER_WEBHOOK_SECRET=xxx  # Shared secret for Vercel → Railway webhook
WORKER_URL=https://your-worker.railway.app  # Railway worker URL

# App
NEXT_PUBLIC_APP_URL=https://yourdomain.com
```

---

## 6. LLM Client Architecture

### Failover Logic

```
┌───────────────────────────────────────────────────────┐
│                  LLM Client (src/lib/llm/client.ts)    │
│                                                        │
│  call(function, prompt, context)                       │
│    │                                                   │
│    ├── Look up primary provider for function            │
│    │   ┌──────────────────────────────────────────┐   │
│    │   │ relevance_scoring  → Claude Haiku         │   │
│    │   │ thread_analysis    → Claude Sonnet        │   │
│    │   │ thread_chat        → Claude Sonnet        │   │
│    │   │ comment_drafting   → GPT-4o               │   │
│    │   │ onboarding         → Claude Sonnet        │   │
│    │   └──────────────────────────────────────────┘   │
│    │                                                   │
│    ├── Is primary in cooldown? (failed 3x in last 5m)  │
│    │   YES → use fallback directly                     │
│    │   NO  → try primary                               │
│    │                                                   │
│    ├── Call primary provider                            │
│    │   SUCCESS → return result, reset failure counter   │
│    │   TIMEOUT (>10s) → increment failures              │
│    │   ERROR → increment failures                      │
│    │                                                   │
│    ├── failures >= 3?                                  │
│    │   YES → enter cooldown (5 min), try fallback       │
│    │   NO  → retry primary once, then try fallback      │
│    │                                                   │
│    ├── Call fallback provider                           │
│    │   SUCCESS → return result                         │
│    │   FAILURE → return error (both providers down)     │
│    │                                                   │
│    └── Log event: llm.error / llm.failover             │
└───────────────────────────────────────────────────────┘

Fallback mapping:
  Claude Haiku   ↔ GPT-4o-mini
  Claude Sonnet  ↔ GPT-4o
  GPT-4o         ↔ Claude Sonnet
```

### Prompt Template Loading

```typescript
// Prompts loaded from prompts/*.md files at startup
// Template variables replaced at call time:
//   {{business_description}}, {{icp_description}},
//   {{keywords}}, {{competitors}}, {{post_title}},
//   {{post_body}}, {{subreddit_rules}}, {{brand_voice}}
```

---

## 7. Worker Design (Railway)

### Startup Sequence

```
worker/index.ts
  │
  ├── 1. Load sentence-transformer model (@huggingface/transformers)
  │      Model: Xenova/all-MiniLM-L6-v2 (ONNX, ~80MB)
  │      If load fails within 30s → exit(1) → Railway auto-restarts
  │
  ├── 2. Initialize Supabase admin client (service role key)
  │
  ├── 3. Initialize Reddit API client (OAuth2 token)
  │
  ├── 4. Start HTTP server (Express/Fastify minimal)
  │      GET /health → { status, model_loaded, last_scan, uptime }
  │      POST /scan-now → trigger immediate scan (shared secret auth)
  │
  ├── 5. Run initial scan immediately (don't wait 15 min)
  │
  └── 6. Start setInterval(scanAllSubreddits, 15 * 60 * 1000)
```

### Scan Cycle Pseudocode

```
async function scanAllSubreddits():
  // Mutex: skip if previous scan still running
  if (scanInProgress) { log('Skipping — previous scan still running'); return; }
  scanInProgress = true;
  cycleStartTime = Date.now();

  try:
    // 1. Get all unique active subreddits
    uniqueSubs = SELECT DISTINCT subreddit_name
                 FROM monitored_subreddits
                 WHERE is_active = true AND status = 'active';

    for each sub in uniqueSubs:
      // Circuit breaker: abort if approaching 15-min limit
      if (Date.now() - cycleStartTime > 13 * 60 * 1000):
        log('Circuit breaker: aborting remaining subreddits');
        break;

      // 2. Fetch new posts (1 Reddit API call)
      posts = await redditClient.getNewPosts(sub.subreddit_name, {
        after: sub.last_seen_post_id
      });

      // 3. Get all ELIGIBLE users monitoring this subreddit
      //    - Growth/Custom: always eligible
      //    - Free: only if trial is still active (NOW() < trial_ends_at)
      users = SELECT b.*, ms.*, u.plan_tier, u.trial_ends_at
              FROM monitored_subreddits ms
              JOIN businesses b ON ms.business_id = b.id
              JOIN users u ON b.user_id = u.id
              WHERE ms.subreddit_name = sub
                AND ms.is_active = true
                AND (u.plan_tier IN ('growth', 'custom')
                     OR (u.plan_tier = 'free' AND u.trial_ends_at > NOW()));

      for each post in posts:
        // Dedup: skip if already alerted
        if (await alertExists(post.id)) continue;

        // 4. Score against each user (parallelized per-user)
        await Promise.allSettled(users.map(user =>
          scoreAndAlert(post, user)
        ));

      // 5. Update scan timestamp
      UPDATE monitored_subreddits SET last_scanned_at = NOW(),
             last_seen_post_id = latestPostId
             WHERE subreddit_name = sub;

  finally:
    scanInProgress = false;
    logScanCycleComplete(metrics);


async function scoreAndAlert(post, user):
  // Pass 1: Semantic + keyword pre-filter
  pass1Score = prefilter(post, user.embedding_vectors, user.keywords, user.competitors);

  if (pass1Score < 0.4) return; // Discard

  // Pass 2: LLM relevance scoring (parallelized via p-limit)
  const { relevanceScore, category } = await limiter(() =>
    llmClient.call('relevance_scoring', post, user)
  );

  // Calculate priority
  const priority = calculatePriority(relevanceScore, post, user);

  if (priority.score < 0.2) return; // Below threshold

  // Create alert
  await supabase.from('alerts').insert({
    business_id: user.business_id,
    reddit_post_id: post.id,
    priority_score: priority.score,
    priority_level: priority.level,
    priority_factors: priority.factors,
    category,
    // ... other fields
  });

  // Email if HIGH priority and user has email enabled
  if (priority.level === 'high' && user.email_alerts_enabled) {
    await sendAlertEmail(user, post, priority);
  }
```

---

## 8. Security Implementation

### RLS Policy Chain

```
AUTH FLOW:
  Browser → Supabase Auth → JWT with user.id
  Every DB query automatically filtered by auth.uid()

RLS CHAIN:
  users            → auth.uid() = id
  businesses       → user_id = auth.uid()
  competitors      → business_id → businesses.user_id = auth.uid()
  monitored_subs   → business_id → businesses.user_id = auth.uid()
  alerts           → business_id → businesses.user_id = auth.uid()
  thread_analyses  → business_id → businesses.user_id = auth.uid()
  chat_messages    → thread_analysis_id → thread_analyses → businesses
  comment_drafts   → business_id → businesses.user_id = auth.uid()
  credit_balances  → user_id = auth.uid() (READ only; writes via service role)
  credit_txns      → user_id = auth.uid() (READ only; writes via service role)
  event_logs       → user_id = auth.uid() OR user_id IS NULL

WORKER ACCESS:
  Uses service_role key (bypasses RLS)
  Only the Railway worker uses this key
  Never exposed to client-side code
```

### Input Sanitization

- All Reddit content sanitized via DOMPurify before rendering
- Reddit content passed as `user` role in LLM calls, never `system`
- API keys in environment variables only, never client-side
- Worker webhook secured with shared secret in Authorization header

---

## 9. Performance Requirements

| Metric | Target | How |
|--------|--------|-----|
| Scan cycle | < 13 min for 150 unique subreddits | Parallel Haiku (p-limit=10), circuit breaker |
| Dashboard load | < 500ms | Composite indexes, cursor pagination, server components |
| Thread analysis | < 10s | Sonnet with streaming response |
| Alert email | < 30s from post creation | Immediate SES send for HIGH priority |
| Pass 1 embedding | ~5ms per post | MiniLM-L6-v2 loaded in memory |
| Model load | < 30s at startup | Fail fast if model doesn't load |

### Database Indexes (see Migration 003)

4 composite indexes on `alerts` for dashboard query patterns + HNSW index on embeddings.

### Pagination

Cursor-based (not OFFSET) for all list endpoints. Cursor = `created_at` timestamp of last item.

---

## 10. Testing Strategy

### Framework

- **Vitest** — unit + integration tests
- **Playwright** — E2E browser tests
- **LLM eval suite** — prompt regression testing (10-20 sample posts)

### Coverage Targets

| Layer | Target | What |
|-------|--------|------|
| Unit | 90%+ | Scoring, pre-filter, rate limiter, recency tiers, priority calc |
| Integration | Key flows | Scan cycle, onboarding pipeline, thread analysis |
| E2E | 4 flows | Onboarding, dashboard, thread analysis, settings |
| LLM eval | 20 samples | Relevance scoring accuracy, category classification |

### Critical Test Paths

1. **Scanner**: fetch → dedup → Pass 1 → Pass 2 → priority → alert → email
2. **Failover**: primary timeout → fallback activates → 5-min cooldown → retry primary
3. **Onboarding**: URL → Agent 1 → Agent 2 → embeddings → first scan
4. **Dashboard**: filter + sort + pagination + mark-seen
5. **Thread chat**: analysis → suggested Q → follow-up → token limit handling

---

## 11. Deployment

### Vercel (Frontend + API)

- **Deploy:** `git push` to main → auto-deploy
- **Preview:** Every PR gets a preview URL
- **Environment:** Production + Preview environments in Vercel dashboard
- **Build:** `next build` (automatic)

### Railway (Worker)

- **Deploy:** Connected to same Git repo, watches `worker/` directory
- **Start command:** `npx tsx worker/index.ts`
- **Always-on:** Configure Railway to prevent scale-to-zero
- **Health check:** Railway pings `GET /health` to verify liveness
- **Auto-restart:** Railway restarts on crash (exit code != 0)

### Supabase

- **Migrations:** Run via `supabase db push` or Supabase dashboard
- **Seed data:** 500 pre-seeded subreddits via migration 005
- **Extensions:** pgvector enabled in migration 001

### Amazon SES

- **Day 1:** Sandbox mode — submit production access request immediately
- **Fallback:** Use Resend (100/day free) during sandbox period
- **Domain verification:** Set up DKIM + SPF for sender domain

---

## 12. Build Order (Implementation Sequence)

```
PHASE 1: Foundation
═══════════════════════════════════════════════
Ref: TECH-SPEC §1-5, DESIGN-SYSTEM.md, PRODUCT-SPEC §3
├── 1.1 Next.js project setup (pnpm, TypeScript, Tailwind, shadcn/ui)
├── 1.2 Supabase project + run migrations 001-005 (all 11 tables)
├── 1.3 Supabase Auth integration (login, signup, middleware)
├── 1.4 App shell (sidebar, top nav, dark theme from DESIGN-SYSTEM.md)
├── 1.5 Environment variables setup (.env.local)
├── 1.6 Credits library (src/lib/credits/) — manager, pricing constants, types
└── 1.7 Deploy skeleton to Vercel (verify builds)

PHASE 2: Onboarding
═══════════════════════════════════════════════
Ref: PRODUCT-SPEC §5.1, TECH-SPEC §6 (LLM client)
├── 2.1 Onboarding Step 1: URL input page
├── 2.2 Agent 1 API route (website analysis → business context)
├── 2.3 Agent 2 API route (subreddit + keyword recommendations)
├── 2.4 Onboarding Step 2: profile + keywords + competitors + subreddits
├── 2.5 Subreddit validation API (Reddit API existence check)
├── 2.6 Embedding vector generation (pgvector storage)
├── 2.7 Trial activation: set trial_started_at, trial_ends_at, grant 25.00 credits
└── 2.8 First-time scan trigger (webhook to Railway)

PHASE 3: Scanner Worker
═══════════════════════════════════════════════
Ref: PRODUCT-SPEC §7.1, TECH-SPEC §7 (worker design)
├── 3.1 Railway worker setup (Node.js + Express)
├── 3.2 ML model loading (Transformers.js + MiniLM)
├── 3.3 Health endpoint + scan-now webhook
├── 3.4 Reddit API client + rate limiter
├── 3.5 Pass 1: pre-filter (embeddings + keyword + regex)
├── 3.6 Pass 2: LLM scoring (Haiku + failover)
├── 3.7 Priority calculation (40/30/15/15 weights)
├── 3.8 Post category classification (5 categories per PRODUCT-SPEC §7.1.1)
├── 3.9 Plan eligibility check (skip expired free trials in scan loop)
├── 3.10 Alert creation + email sending (SES)
├── 3.11 Scanner loop (setInterval + mutex + circuit breaker)
└── 3.12 Deploy worker to Railway

PHASE 4: Dashboard
═══════════════════════════════════════════════
Ref: PRODUCT-SPEC §5.2, DESIGN-SYSTEM.md (colors, spacing, components)
├── 4.1 Alert list API (CRUD + filters + cursor pagination)
├── 4.2 Alert card component (priority dot, category tag, meta, CTAs)
├── 4.3 New/Seen split + intersection observer for seen tracking
├── 4.4 Filter by + Sort by hover dropdowns
├── 4.5 Monitored subreddits section (health tags, lock icon, slot counter)
├── 4.6 Credit balance badge in top nav (always visible)
├── 4.7 Empty states + trial expired state + upgrade CTAs
└── 4.8 Trial countdown banner for free users

PHASE 5: Thread Analysis + Credits Integration
═══════════════════════════════════════════════
Ref: PRODUCT-SPEC §5.3, §12.2 (credits UX flow)
├── 5.1 Thread analysis API (fetch comments + Sonnet analysis)
├── 5.2 Credit gate: pre-check balance → estimate → confirm → deduct after
├── 5.3 Analysis view component (summary, pain points, intent, competitive)
├── 5.4 Chat interface (follow-up questions + streaming + credit deduction per msg)
├── 5.5 Suggested questions chips
├── 5.6 Sidebar history (past analyses grouped by date)
├── 5.7 Manual URL input in sidebar
├── 5.8 Token limit handling (sliding window for long chats)
└── 5.9 Insufficient credits state + upgrade CTA

PHASE 6: Comment Drafting + Credits Integration
═══════════════════════════════════════════════
Ref: PRODUCT-SPEC §5.4, §12.2 (credits deduction per draft)
├── 6.1 Draft generation API (GPT-4o + subreddit rules + brand voice)
├── 6.2 Credit gate for draft generation + per-draft regeneration
├── 6.3 Draft card component (Copy, Edit, Regenerate, Approve)
├── 6.4 Per-draft regeneration (credit deduction per regen)
├── 6.5 Reply-to selector (post vs specific comment)
└── 6.6 Edit mode (inline text editing — no credit cost)

PHASE 7: Settings + Billing
═══════════════════════════════════════════════
Ref: PRODUCT-SPEC §5.5, §12
├── 7.1 Business Profile tab (edit all fields, add/remove keywords etc.)
├── 7.2 Re-compute embeddings on profile edit
├── 7.3 Notifications tab (email on/off, threshold)
├── 7.4 Usage & Billing tab (plan info, credit balance, transaction history, upgrade)
├── 7.5 Subreddit add/remove with health hover + plan-based limit (3 free / 10 growth)
├── 7.6 Stripe integration (Growth plan checkout + subscription management)
├── 7.7 Stripe webhook: handle subscription.created → upgrade plan + grant credits
└── 7.8 Monthly credit reset (Stripe billing cycle → reset balance to 250.00)

PHASE 8: Polish + Testing
═══════════════════════════════════════════════
Ref: PRODUCT-SPEC §10, TECH-SPEC §10 (testing strategy)
├── 8.1 Event logging (frontend tracker + /api/events)
├── 8.2 Error states for all views (per PRODUCT-SPEC §9)
├── 8.3 LLM failover integration testing
├── 8.4 Credit system edge cases (concurrent deductions, race conditions, 0 balance)
├── 8.5 Trial expiry automation (cron: expire credits, stop scanning)
├── 8.6 E2E test suite (5 Playwright flows: onboarding, dashboard, analysis, drafts, settings)
├── 8.7 Unit test suite (scoring, pre-filter, rate limiter, credit manager)
└── 8.8 LLM eval baseline (20 sample posts)
```

---

## 13. Critical Failure Modes + Mitigations

| Failure | Impact | Mitigation | Test Required |
|---------|--------|-----------|---------------|
| ML model fails to load at startup | Scanner produces no Pass 1 scores | Health check verifies model loaded. `exit(1)` if not loaded in 30s → Railway auto-restarts | Unit: model load timeout |
| Reddit API 429 | Scan cycle delayed | Exponential backoff (1s, 2s, 4s, 8s, max 60s). Skip subreddit, retry next cycle | Unit: backoff logic |
| Reddit API 403 (sub goes private) | User's subreddit stops scanning | Mark status='private', show 🔒 on dashboard. Auto-resume if public again | Integration: status transition |
| Haiku timeout (>10s) | Alert scoring delayed | Use Pass 1 score only, flag as "unscored" | Unit: timeout fallback |
| Both LLMs down | No scoring at all | Use Pass 1 semantic scores only. Log `llm.error` events | Integration: dual failure |
| Scan cycle exceeds 15 min | Cycles overlap | 13-min circuit breaker. In-memory mutex prevents overlap | Unit: circuit breaker |
| SES email fails | User misses HIGH priority alert | Retry 3x with exponential backoff. Log silently. No frontend display | Unit: retry logic |
| Thread comment fetch fails | Analysis shows no data | Return error: "Could not fetch thread. Reddit may be temporarily unavailable." | Integration: error state |
| Chat token limit exceeded | LLM call fails or truncates | Sliding window: keep analysis + last 10 messages, summarize older ones | Unit: truncation logic |
| Railway cold start after restart | Misses one scan window | Always-on config. Model loads in <30s. First scan runs immediately after load | Manual: verify Railway config |
| RLS policy misconfigured | Data leak (User A sees User B's data) | Test all RLS policies in migration. Integration tests verify cross-user isolation | Integration: RLS validation |
| Concurrent credit deductions | Balance goes negative (double-spend) | Atomic DB update: `UPDATE SET balance = balance - X WHERE balance >= X`. If 0 rows affected → insufficient credits | Unit: concurrent deduction |
| Trial expiry during active session | User mid-analysis when trial expires | Credits checked per-action, not per-session. If credits remain, action completes. New actions blocked after expiry | Integration: mid-session expiry |
| Stripe webhook fails | User paid but plan not upgraded | Webhook retry (Stripe retries 3x). Fallback: manual check via Stripe dashboard. Log `plan.upgrade_failed` event | Integration: webhook failure |

---

## 14. Pricing & Credits

### Plan Tiers

| | Free | Growth | Custom |
|---|---|---|---|
| **Price** | $0 | $39/month | Contact us |
| **Trial** | 3-day full access | — | — |
| **Subreddits** | 3 | 10 | 10+ per business |
| **Businesses** | 1 | 1 | Multiple |
| **Scanning** | Pass 1+2, 3 days | Pass 1+2, continuous | Pass 1+2, continuous |
| **Credits** | 25.00 (lifetime) | 250.00/month | Negotiated |
| **Email alerts** | 3 days | Unlimited | Unlimited |

### Credits System

```
1 credit ≈ 1,000 LLM tokens (input + output combined)
Credits are fractional (2 decimal places): 17.54, not 18

CREDIT LIFECYCLE:
  Free user:   signup → onboarding → grant 25.00 credits → use during 3-day trial → expire
  Growth user: subscribe → grant 250.00 credits → use during month → reset on billing anniversary
  Custom user: subscribe → grant N credits → reset monthly → manual top-up if needed

CREDIT DEDUCTION FLOW:
  User clicks "Analyze Thread"
    → API checks credit_balances.balance >= minimum estimate (2.00)
    → If insufficient → return 402 + {error: 'insufficient_credits', balance: X}
    → If sufficient → run LLM call
    → After completion → calculate exact credits: tokens_used / 1000
    → Deduct from credit_balances (atomic UPDATE ... SET balance = balance - X)
    → INSERT into credit_transactions (audit trail)
    → Return result + {credits_used: 3.24, balance_remaining: 15.26}
```

**Credit costs by action:**

| Action | Avg tokens | Avg credits | User sees |
|--------|-----------|------------|-----------|
| Thread analysis (short) | ~2,500 | 2-3 | "2-5 credits" |
| Thread analysis (medium) | ~4,000 | 3-4 | "2-5 credits" |
| Thread analysis (long) | ~6,000 | 5-6 | "5-8 credits" |
| Draft session (2 drafts) | ~3,000 | 2-3 | "2-4 credits" |
| Regenerate single draft | ~1,500 | 1-2 | "1-2 credits" |
| Chat follow-up | ~2,000 | 1-2 | "1-2 credits" |

### Free Plan Trial Lifecycle

```
SIGNUP → ONBOARDING → TRIAL ACTIVE (3 days) → TRIAL EXPIRED

                         ┌── trial_started_at = NOW()
  Onboarding complete ───┤── trial_ends_at = NOW() + 3 days
                         ├── credit_balances.balance = 25.00
                         └── Trigger first scan (last 24 hrs)

  Scanner eligibility check (every 15 min):
    WHERE plan_tier = 'free' AND trial_ends_at > NOW()
    → If trial expired: skip user (no scanning, no new alerts)

  Trial expires:
    → credit_balances.balance = 0.00
    → INSERT credit_transactions(action_type='trial_expiry')
    → Historical data stays (read-only)
    → Dashboard shows upgrade CTA
```

### Cost Economics

Based on 10 subreddits, 3.5 posts/sub/15min, ~35% Pass 1 filter rate:

| Component | Monthly Cost (Growth) |
|-----------|----------------------|
| Pass 1 (local model) | $0.00 |
| Pass 2 (Claude Haiku) | ~$6.56 |
| Credits usage (250 credits avg) | ~$2.00 |
| Amazon SES | ~$0.01 |
| **Total per Growth user** | **~$8.56/mo** |

| Component | Lifetime Cost (Free) |
|-----------|---------------------|
| Scanning (3 days, 3 subs) | $0.20 |
| Credits usage (25 credits) | $0.20 |
| **Total per Free user** | **~$0.40** |

| Plan | Revenue | LLM Cost | Gross Margin |
|------|---------|----------|-------------|
| Free | $0 | $0.40 (lifetime) | N/A (acquisition) |
| Growth | $39/mo | $8.56/mo | **78%** |
| Custom (2 biz) | ~$99/mo | ~$17.12/mo | **83%** |

| Infra | Monthly Cost |
|-------|-------------|
| Vercel (Pro) | $20/mo |
| Railway (Starter) | $5/mo + usage (~$10) |
| Supabase (Free → Pro at scale) | $0-25/mo |
| **Total infra** | **~$35-55/mo** |

Break-even: 2 paying Growth customers at $39/mo.
