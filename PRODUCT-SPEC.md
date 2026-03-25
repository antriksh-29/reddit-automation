# Product Specification: Reddit Lead Intelligence Platform

**Version:** 1.2 (MVP)
**Date:** 2026-03-24
**Status:** Ready for Engineering Review
**Purpose:** Complete product specification for engineering handover. Covers all features, user flows, data models, API integrations, and edge cases.

---

## 1. Product Overview

A SaaS platform that helps GTM teams, indie hackers, and marketing agencies find and engage with relevant Reddit conversations in real-time. The platform monitors subreddits for relevant posts, provides AI-powered thread analysis, and helps users draft contextual responses — all designed to help them be first to relevant conversations.

**Core differentiator:** Speed-to-relevance alerting + thread intelligence. Every competitor leads with comment drafting. We lead with "we tell you about the conversation before anyone else does."

**Market context:** GummySearch (135K+ users) shut down Nov 2025. Displaced users are actively seeking alternatives. Timing is critical.

---

## 2. User Personas

### Persona A: Indie Hacker / Early-Stage Founder
- Building a product, using Reddit to find initial customers
- Monitors 3-5 subreddits relevant to their niche
- Wants to find posts where people describe the exact problem their product solves
- Time-constrained — needs alerts, not a tool that requires daily checking
- Price sensitive — $29-49/mo range

### Persona B: GTM Team Member
- Works at a startup/scale-up, Reddit is one of several marketing channels
- Monitors 5-10 subreddits for lead gen and brand awareness
- Needs to report insights to their team — thread analysis is high value
- Competitor monitoring is critical — want to know when competitors are mentioned
- Budget: $49-99/mo per seat

### Persona C: Reddit Marketing Agency Operator
- Manages Reddit presence for multiple clients (future multi-business support)
- Currently limited to one business per account in V1
- Spends most time finding relevant posts and analyzing threads
- Currently copy-pastes threads into ChatGPT for analysis
- Would pay premium for time savings — $99+/mo

---

## 3. Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                        USER BROWSER                           │
│  Dashboard ←→ Onboarding ←→ Thread Analysis ←→ Settings      │
└──────────────────────┬───────────────────────────────────────┘
                       │ HTTPS
                       ▼
┌──────────────────────────────────────────────────────────────┐
│               NEXT.JS APPLICATION (Railway/Vercel)            │
│                                                               │
│  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐ │
│  │  Auth    │  │  API     │  │  Pages/  │  │  Webhooks    │ │
│  │ (Clerk)  │  │  Routes  │  │  UI      │  │  (email etc) │ │
│  └────┬─────┘  └────┬─────┘  └──────────┘  └──────────────┘ │
│       │              │                                        │
│       └──────┬───────┘                                        │
│              │                                                │
│              ▼                                                │
│     ┌─────────────────┐                                      │
│     │   Supabase       │                                      │
│     │   (PostgreSQL)   │                                      │
│     └─────────────────┘                                      │
└──────────────────────────────────────────────────────────────┘
                       │
                       ▼
┌────────────────────────────────────────────────────────────┐
│  CRON WORKER: Reddit Scanner (every 15 min)                │
│                                                             │
│  Pass 1: Semantic + Keyword pre-filter (local model, free) │
│  Pass 2: LLM relevance scoring (Haiku — filtered posts)    │
│                                                             │
│  → Reddit API   → Claude API (relevance, analysis)         │
│  → OpenAI API (comment drafting)                            │
│  → DB writes    → Email Service (Amazon SES)               │
└────────────────────────────────────────────────────────────┘
         │
         ▼
┌────────────────┐  ┌──────────────────┐  ┌────────────────┐
│  Reddit API    │  │  Email Service   │  │  LLM APIs      │
│  (OAuth2)      │  │  (Amazon SES)    │  │  Claude + GPT  │
│  100 req/min   │  │                  │  │                │
└────────────────┘  └──────────────────┘  └────────────────┘
```

---

## 4. Database Schema

### users
```
id              UUID        PRIMARY KEY
email           VARCHAR     NOT NULL UNIQUE
name            VARCHAR
plan_tier       ENUM        ('free', 'pro', 'enterprise') DEFAULT 'free'
auth_provider_id VARCHAR    NOT NULL (Clerk user ID)
created_at      TIMESTAMP   DEFAULT NOW()
updated_at      TIMESTAMP   DEFAULT NOW()
```

### businesses
```
id              UUID        PRIMARY KEY
user_id         UUID        FK → users.id (UNIQUE for MVP — 1:1)
website_url     VARCHAR
name            VARCHAR     NOT NULL
description     TEXT        (AI-generated or manually entered, editable)
icp_description TEXT        (ideal customer profile description)
brand_voice     TEXT        (tone, prohibited phrases, example language)
keywords        JSONB       ({primary: [...], discovery: [...]} — tagged keyword arrays, add/delete manually)
created_at      TIMESTAMP   DEFAULT NOW()
updated_at      TIMESTAMP   DEFAULT NOW()
```

### competitors
```
id              UUID        PRIMARY KEY
business_id     UUID        FK → businesses.id
name            VARCHAR     NOT NULL
url             VARCHAR
source          ENUM        ('auto_suggested', 'manual') DEFAULT 'manual'
created_at      TIMESTAMP   DEFAULT NOW()
```

### subreddit_health_cache
```
id              UUID        PRIMARY KEY
subreddit_name  VARCHAR     NOT NULL UNIQUE
subscribers     INTEGER
posts_per_day   FLOAT
avg_comments    FLOAT
upvote_ratio    FLOAT
rules_count     INTEGER
rules_json      JSONB       (full rules from Reddit API)
activity_tag    ENUM        ('strong', 'medium', 'weak')
engagement_tag  ENUM        ('strong', 'medium', 'weak')
moderation_tag  ENUM        ('strong', 'medium', 'weak')
icp_relevance_tag ENUM      ('strong', 'medium', 'weak') — per-business, stored in monitored_subreddits
recency_tag     ENUM        ('strong', 'medium', 'weak')
overall_tag     ENUM        ('strong', 'medium', 'weak')
health_details  JSONB       (per-parameter breakdown with explanations)
category        VARCHAR     (e.g., 'engineering', 'sales', 'marketing', 'product', etc.)
last_refreshed  TIMESTAMP   DEFAULT NOW()
created_at      TIMESTAMP   DEFAULT NOW()

NOTE: Pre-seeded with ~500 popular subreddits across functions.
      Refreshed manually via Supabase + Claude Code every 1-2 months.
      New subreddits added on first user addition — cached from then on.
```

### monitored_subreddits
```
id              UUID        PRIMARY KEY
business_id     UUID        FK → businesses.id
subreddit_name  VARCHAR     NOT NULL (must exist in subreddit_health_cache)
relevance_keywords JSONB    (keywords specific to this subreddit)
icp_relevance_tag ENUM      ('strong', 'medium', 'weak')
source          ENUM        ('auto_suggested', 'manual') DEFAULT 'manual'
is_active       BOOLEAN     DEFAULT true
status          ENUM        ('active', 'private', 'banned', 'not_found') DEFAULT 'active'
last_scanned_at TIMESTAMP
last_seen_post_id VARCHAR   (for deduplication across scans)
created_at      TIMESTAMP   DEFAULT NOW()
updated_at      TIMESTAMP   DEFAULT NOW()

UNIQUE(business_id, subreddit_name)
CONSTRAINT max_subreddits_per_business CHECK via application layer (max 10)
```

### alerts
```
id              UUID        PRIMARY KEY
business_id     UUID        FK → businesses.id
subreddit_id    UUID        FK → monitored_subreddits.id
reddit_post_id  VARCHAR     NOT NULL UNIQUE
post_title      TEXT        NOT NULL
post_body       TEXT
post_author     VARCHAR
post_url        VARCHAR     NOT NULL
post_created_at TIMESTAMP   NOT NULL
upvotes         INTEGER     DEFAULT 0
num_comments    INTEGER     DEFAULT 0
priority_score  FLOAT       (composite: weighted formula below)
priority_level  ENUM        ('high', 'medium', 'low') — derived from priority_score
priority_factors JSONB      (breakdown: {relevance, recency, velocity, intent})
category        ENUM        ('pain_point', 'solution_request', 'competitor_dissatisfaction', 'experience_sharing', 'industry_discussion')
email_status    ENUM        ('pending', 'sent', 'failed', 'skipped') DEFAULT 'pending'
email_sent_at   TIMESTAMP
is_seen         BOOLEAN     DEFAULT false (true when user views alert on dashboard)
seen_at         TIMESTAMP
created_at      TIMESTAMP   DEFAULT NOW()
```

### thread_analyses
```
id              UUID        PRIMARY KEY
business_id     UUID        FK → businesses.id
alert_id        UUID        FK → alerts.id (nullable — can be triggered by manual URL)
reddit_url      VARCHAR     NOT NULL
thread_title    TEXT
summary         TEXT        NOT NULL
pain_points     JSONB       (array of extracted pain points)
buying_signals  JSONB       (array of comments with purchase intent markers)
competitive_landscape JSONB (competitors mentioned, sentiment per competitor, user wishes)
sentiment       ENUM        ('positive', 'negative', 'neutral', 'mixed')
key_insights    JSONB       (array of key insights)
comment_count   INTEGER
analysis_status ENUM        ('pending', 'complete', 'partial', 'failed') DEFAULT 'pending'
created_at      TIMESTAMP   DEFAULT NOW()
```

### thread_chat_messages
```
id              UUID        PRIMARY KEY
thread_analysis_id UUID     FK → thread_analyses.id
role            ENUM        ('user', 'assistant')
content         TEXT        NOT NULL
created_at      TIMESTAMP   DEFAULT NOW()
```

### comment_drafts
```
id              UUID        PRIMARY KEY
alert_id        UUID        FK → alerts.id
business_id     UUID        FK → businesses.id
parent_comment_id VARCHAR   (nullable — if replying to a specific comment, not the post)
draft_text      TEXT        NOT NULL
tone            VARCHAR     (e.g., 'helpful', 'conversational', 'technical')
rule_check      JSONB       (subreddit rules checked, any flags — internal only, not shown to user)
approval_state  ENUM        ('pending', 'approved', 'rejected') DEFAULT 'pending'
created_at      TIMESTAMP   DEFAULT NOW()
```

### event_logs
```
id              UUID        PRIMARY KEY
user_id         UUID        FK → users.id (nullable for system events)
business_id     UUID        FK → businesses.id (nullable)
event_type      VARCHAR     NOT NULL (see Event Taxonomy below)
event_data      JSONB       (structured payload per event type)
source          ENUM        ('frontend', 'backend', 'cron', 'system')
session_id      VARCHAR     (frontend session tracking)
ip_address      VARCHAR     (hashed for analytics, not stored raw)
user_agent      TEXT
created_at      TIMESTAMP   DEFAULT NOW()

INDEX ON (event_type, created_at)
INDEX ON (user_id, created_at)
INDEX ON (business_id, created_at)
```

---

## 5. Feature Specifications

### 5.1 Onboarding Wizard (2 Steps)

**Trigger:** First login or when user has no business profile.

#### 5.1.0 Onboarding Agent Pipeline

The onboarding uses a **two-agent pipeline** — each agent has a distinct responsibility:

```
┌─────────────────────────────────────────────────────────┐
│  AGENT 1: Business Intelligence Agent                    │
│  Input:  Website URL (or manual entry)                   │
│  Task:   Fetch and analyze the website to understand     │
│          what the company does, who it serves, and who   │
│          it competes with                                │
│  Output: Business description, ICP description,          │
│          competitor list (names + URLs)                   │
│  Model:  Claude Sonnet                                   │
└──────────────────────┬──────────────────────────────────┘
                       │ passes business context
                       ▼
┌─────────────────────────────────────────────────────────┐
│  AGENT 2: Discovery Agent                                │
│  Input:  Business description, ICP description,          │
│          competitor list from Agent 1                     │
│  Task:   Find the most relevant subreddits and keywords  │
│          considering the business context and ICP         │
│  Output: 7 subreddit recommendations (with rationale),   │
│          10 keyword recommendations (with rationale)      │
│  Model:  Claude Sonnet                                   │
└─────────────────────────────────────────────────────────┘
```

**Agent 1 — Business Intelligence Agent:**

Receives the website URL, fetches the homepage content, and extracts:
- **Business name** — from title tag, hero section, or logo text
- **Business description** — what the company does, in 2-3 sentences. Written in third person, factual, not marketing language.
- **ICP description** — who the ideal customer is. Role, company size, industry, what problem they face. As specific as possible.
- **Competitor list** — 3-5 competitors identified from the website content (pricing pages, comparison sections, "alternative to" pages, or inferred from product category).

If website is unreachable or has minimal content → returns partial results and flags gaps for manual input.

**Agent 2 — Discovery Agent:**

Receives the full business context from Agent 1 and recommends subreddits + keywords.

**Subreddit recommendation parameters (max 7):**

The agent evaluates subreddits on these criteria and recommends a specific mix:

| Criteria | What the agent evaluates |
|----------|------------------------|
| Topic-ICP overlap | Do the people who post here match the ICP? (audience match > topic match) |
| Problem presence | Do conversations in this subreddit discuss the problems the product solves? |
| Solution-seeking behavior | Do people here actively ask for tool recommendations, or just share news? |
| Competitor footprint | Are any identified competitors already discussed here? |
| Commercial tolerance | Is this a subreddit where product mentions are welcome or banned? |
| Size & activity | Is there enough volume to generate alerts, but not so much it's pure noise? |

**Required mix (7 subreddits):**
- **3 niche subreddits** — small, highly targeted communities where the ICP concentrates. High signal-to-noise. (e.g., r/coldcalling for a sales tool)
- **2 mid-size subreddits** — broader but still relevant. Good volume + decent relevance. (e.g., r/sales)
- **2 large subreddits** — high-traffic communities with known recommendation culture. (e.g., r/startups, r/SaaS)

Each subreddit recommendation includes a one-line rationale explaining WHY it was chosen, so the user can make an informed keep/remove decision.

**Keyword recommendation parameters (10 total):**

Keywords are recommended in the ICP's language, NOT the founder's marketing language. The agent must bridge the gap between how the founder describes the product and how the ICP describes the problem.

| Category | Count | What it captures | Examples (for a Reddit monitoring tool) |
|----------|-------|-----------------|----------------------------------------|
| **PRIMARY KEYWORDS** | **5** | High-signal terms most likely to surface Solution Request and Competitor Dissatisfaction posts | |
| Customer problem language | 2 | How the ICP describes the problem in their own words — raw, unpolished | "find relevant Reddit posts", "monitor Reddit for leads" |
| Solution category terms | 2 | The product category as the ICP searches for it | "Reddit marketing tool", "social listening tool" |
| Pain point vocabulary | 1 | Emotional/frustrated language ICPs use about the problem | "manually checking Reddit", "missing relevant posts" |
| **DISCOVERY KEYWORDS** | **5** | Broader terms that catch Pain Point and Industry Discussion posts | |
| Use case descriptors | 2 | Specific tasks/workflows the product helps with | "track competitor mentions Reddit", "Reddit lead generation" |
| Industry-specific jargon | 1 | Domain terms only someone in the ICP's world would use | "community-led growth", "social selling" |
| Question patterns | 1 | "How to" / "best way to" formulations the ICP uses | "how to find leads on Reddit" |
| Negative/contrast terms | 1 | What the ICP is moving AWAY from — captures transition moments | "stop manually scrolling Reddit", "automate Reddit monitoring" |

Each keyword includes a one-line rationale and is tagged as PRIMARY or DISCOVERY so the user understands its purpose.

**Note:** Competitor names are NOT included in keywords — they are already captured in the competitors section and are matched separately during scanning.

**Flow:**
```
Step 1: Website Analysis
  ┌─────────────────────────────────────┐
  │  Enter your website URL             │
  │  ┌─────────────────────────────┐    │
  │  │ https://example.com         │    │
  │  └─────────────────────────────┘    │
  │  [Analyze →]                        │
  │                                     │
  │  or [Skip — I'll enter manually]    │
  └─────────────────────────────────────┘
         │
         ▼ (Agent 1 → Agent 2 pipeline runs)

Step 2: Business Profile + Monitoring Setup (single page, all editable)
  ┌─────────────────────────────────────────────────────────┐
  │  BUSINESS PROFILE (from Agent 1)                        │
  │  Business Name: [Example Inc        ] (editable)        │
  │  Description:   [AI-generated...    ] (editable)        │
  │  Target Audience: [AI-generated..   ] (editable)        │
  │  Brand Voice:   [Professional, helpful...] (editable)   │
  │                                                         │
  │  ─────────────────────────────────────────────────────  │
  │                                                         │
  │  KEYWORDS (from Agent 2)                                │
  │  Primary:                                               │
  │  [find relevant Reddit posts ✕] [Reddit marketing      │
  │   tool ✕] [social listening tool ✕] [monitor Reddit     │
  │   for leads ✕] [missing relevant posts ✕]               │
  │  Discovery:                                             │
  │  [track competitor mentions ✕] [community-led           │
  │   growth ✕] [how to find leads on Reddit ✕]             │
  │  [automate Reddit monitoring ✕] [Reddit lead gen ✕]     │
  │  [+ add keyword]                                        │
  │                                                         │
  │  COMPETITORS (from Agent 1)                             │
  │  [Competitor A ✕] (auto) [Competitor B ✕] (auto)       │
  │  [+ Add competitor]                                     │
  │                                                         │
  │  SUBREDDITS TO MONITOR (from Agent 2, max 10)           │
  │  Niche:                                                 │
  │  ☑ coldcalling      [Strong ●] — "your ICP asks for    │
  │                       sales tools here daily"            │
  │  ☑ microsaas        [Medium ●] — "indie builders        │
  │                       discussing growth tools"           │
  │  ☑ ecommerce        [Strong ●] — "active tool           │
  │                       recommendation threads"            │
  │  Mid-size:                                              │
  │  ☑ sales            [Strong ●] — "high volume,          │
  │                       frequent solution requests"        │
  │  ☑ marketing        [Medium ●] — "GTM teams sharing     │
  │                       tool stacks"                       │
  │  Large:                                                 │
  │  ☑ startups         [Medium ●] — "founders actively     │
  │                       seek recommendations"              │
  │  ☑ SaaS             [Strong ●] — "direct product        │
  │                       category, high competitor chatter" │
  │                                                         │
  │  [+ Add subreddit]                                      │
  │  ┌─────────────────────────────┐                        │
  │  │ customsubreddit             │  ← r/ added auto       │
  │  └─────────────────────────────┘                        │
  │  → Existence check + health assessment runs on add      │
  │                                                         │
  │  [Start Monitoring →]                                   │
  └─────────────────────────────────────────────────────────┘
```

**Subreddit input UX:** User types only the subreddit name (e.g., "saas", "startups"). The `r/` prefix is added automatically by the UI. Displayed as `r/saas` throughout the platform.

**Health details on hover (not expanded by default):**
```
  ┌─ r/saas Health Assessment ────────────────┐
  │  Overall: Strong ●                         │
  │                                            │
  │  PRIMARY FACTORS                           │
  │  Activity Level:        Strong — 45/day    │
  │  ICP Relevance:         Strong — 85% match │
  │                                            │
  │  SECONDARY FACTORS                         │
  │  Engagement Quality:    Strong — 72% deep  │
  │  Moderation Strictness: Medium — 8 rules   │
  │  Conversation Recency:  Strong — trending↑ │
  └────────────────────────────────────────────┘
```

**Subreddit validation on add:**
1. Hit Reddit API `/r/{subreddit}/about.json`
2. If 404 → show inline error: "This subreddit does not exist. Check the spelling."
3. If 403 (private) → show: "This subreddit is private and cannot be monitored."
4. If 200 → check `subreddit_health_cache`. If not cached, run health assessment and cache it.

**Edge cases:**
- Website unreachable → show error, offer manual entry
- Website has minimal content → generate partial profile, flag gaps for manual input
- No subreddits match → show "No matches found, please add subreddits manually"
- User tries to add >10 subreddits → show "Maximum 10 subreddits allowed. Remove one to add another."

### 5.1.1 First-Time Post Fetch

**Immediately after onboarding completes:**
1. Trigger an initial scan for the user's configured subreddits + keywords
2. Filter: posts from the **last 24 hours** only
3. Run the two-pass relevance pipeline (semantic pre-filter → Haiku scoring)
4. Populate dashboard with results — user sees relevant posts immediately, not a blank dashboard

**Cron alignment:** If the first scan completes at 5:17 PM, schedule the user's first cron scan at 5:45 PM (next 15-min boundary, rounded up). From there, scan every 15 minutes on schedule.

### 5.1.2 Subreddit Health Cache

**Pre-seeded database of ~500 popular subreddits** across categories:
- Engineering: r/programming, r/webdev, r/devops, r/MachineLearning, etc.
- Sales: r/sales, r/B2BSaaS, r/coldcalling, etc.
- Marketing: r/marketing, r/socialmedia, r/SEO, r/content_marketing, etc.
- Product: r/ProductManagement, r/UXDesign, r/startups, etc.
- Industry-specific: r/fintech, r/healthIT, r/legaltech, etc.

**Refresh cadence:** Manual refresh via Supabase + Claude Code every 1-2 months. No automated cron job for this — handled by the founder directly.

**New subreddit flow:** When a user adds a subreddit not in the cache:
1. Validate existence (Reddit API)
2. Run full health assessment
3. Insert into `subreddit_health_cache` — all future users benefit from this assessment

This minimizes Reddit API calls — most subreddits will already be cached.

**Health Assessment Parameters:**

| Parameter | Type | What it measures | Data Source | Strong | Medium | Weak |
|-----------|------|-----------------|-----------|--------|--------|------|
| Activity Level | PRIMARY | How active the subreddit is — volume of new posts and comments per day. Higher activity = more opportunities to find relevant threads. | Reddit API: posts/day, comments/post | >20 posts/day, >5 comments/post avg | 5-20 posts/day, 2-5 comments/post | <5 posts/day or <2 comments/post |
| ICP Relevance | PRIMARY | How well the subreddit's audience and topics match the user's ideal customer profile. A high ICP match means the people posting here are likely the user's target customers. | LLM scoring against ICP description | >80% topic overlap with ICP | 50-80% overlap | <50% overlap |
| Engagement Quality | SECONDARY | How deep the discussions are — do posts generate real conversations or just drive-by upvotes? Deep engagement means more insights from thread analysis. | Reddit API: upvote ratios, discussion depth | >70% posts get 3+ comments | 40-70% get 3+ comments | <40% get 3+ comments |
| Moderation Strictness | SECONDARY | How heavily moderated the subreddit is — number of rules, automod presence, and how aggressively content is removed. Strict moderation means higher bar for comment drafts. | Reddit API: /about/rules.json | <5 rules, no automod mention | 5-10 rules, moderate policies | >10 rules, strict automod, frequent removals |
| Conversation Recency | SECONDARY | Whether ICP-relevant conversations are happening recently and trending up or down. A declining subreddit may not be worth monitoring even if historically relevant. | Reddit API: relevant posts in 7d vs 30d | Increasing trend, >5 relevant/week | Stable, 2-5 relevant/week | Declining or <2 relevant/week |

**Overall Ranking Formula:**
- Score each parameter: Strong=3, Medium=2, Weak=1
- Primary parameters weighted 2x, Secondary weighted 1x
- Max possible score = (2 × 3 × 2) + (3 × 3 × 1) = 12 + 9 = 21
- **Strong overall:** 17-21 | **Medium overall:** 11-16 | **Weak overall:** <11

### 5.2 Dashboard

**Layout:**
```
┌──────────────────────────────────────────────────────────────┐
│  [Logo]  Dashboard | Thread Analysis | Settings     [User ▼] │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  [Filter by ▼]                    [Sort by ▼]           │ │
│  │                                                          │ │
│  │  Filter by (hover to expand):                            │ │
│  │  ┌──────────────────┐  ┌──────────────────┐             │ │
│  │  │ View             │  │ Priority         │             │ │
│  │  │  ○ New           │  │  ○ All           │             │ │
│  │  │  ○ Seen          │  │  ○ High          │             │ │
│  │  │  ○ All           │  │  ○ Medium        │             │ │
│  │  └──────────────────┘  │  ○ Low           │             │ │
│  │  ┌──────────────────┐  └──────────────────┘             │ │
│  │  │ Subreddit        │  ┌──────────────────┐             │ │
│  │  │  ☐ r/saas        │  │ Date Range       │             │ │
│  │  │  ☐ r/startups    │  │  ○ Today         │             │ │
│  │  │  ☐ r/indiehackers│  │  ○ Yesterday     │             │ │
│  │  └──────────────────┘  │  ○ This Week     │             │ │
│  │  ┌──────────────────┐  │  ○ This Month    │             │ │
│  │  │ Category         │  │  ○ Custom Range  │             │ │
│  │  │  ○ All           │  └──────────────────┘             │ │
│  │  │  ○ Pain Points   │                                    │ │
│  │  │  ○ Solution Req  │  Sort by (hover to expand):       │ │
│  │  │  ○ Competitor    │  ┌──────────────────┐             │ │
│  │  │  ○ Experience    │  │  ○ Priority      │             │ │
│  │  │  ○ Industry      │  │  ○ Newest        │             │ │
│  │  └──────────────────┘  │  ○ Most Comments │             │ │
│  │                         └──────────────────┘             │ │
│  │  (selected filters remain highlighted)                    │ │
│  └──────────────────────────────────────────────────────────┘│
│                                                               │
│  ┌─── NEW ALERTS (3) ─────────────────────────────────────┐ │
│  │                                                           ││
│  │  ┌─────────────────────────────────────────────────┐     ││
│  │  │ 🔴 HIGH · r/saas · 3 min ago                     │     ││
│  │  │ "Looking for alternatives to [Competitor]"       │     ││
│  │  │ Competitor Dissatisfaction · 12 upvotes · 8 comments│    ││
│  │  │ [Analyze Thread] [Draft Response] [View on Reddit]│    ││
│  │  └─────────────────────────────────────────────────┘     ││
│  │                                                           ││
│  │  ┌─────────────────────────────────────────────────┐     ││
│  │  │ 🟡 MEDIUM · r/startups · 12 min ago              │     ││
│  │  │ "Best tools for early-stage customer discovery"  │     ││
│  │  │ Solution Request · 5 upvotes · 3 comments          │     ││
│  │  │ [Analyze Thread] [Draft Response] [View on Reddit]│    ││
│  │  └─────────────────────────────────────────────────┘     ││
│  │                                                           ││
│  │  [Load more...]                                           ││
│  └───────────────────────────────────────────────────────────┘│
│                                                               │
│  ┌─── SEEN ALERTS (12) ───────────────────────────────────┐ │
│  │  (Same card format, muted styling)                       ││
│  │  [Load more...]                                          ││
│  └───────────────────────────────────────────────────────────┘│
│                                                               │
│  ┌─── MONITORED SUBREDDITS ─────────────────────────────────┐│
│  │  r/saas [Strong ●] · Last scan: 2 min ago · 12 alerts    ││
│  │  r/startups [Medium ●] · Last scan: 2 min ago · 5 alerts ││
│  │  r/indiehackers [Strong ●] · Last scan: 2 min ago · 8    ││
│  │  r/example [🔒 Private] · Paused                         ││
│  │  [+ Add subreddit]  (3/10 slots used)                     ││
│  └───────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────┘
```

**Filter & Sort UX:** "Filter by" and "Sort by" are two separate buttons. Hovering over each reveals a dropdown with options. Selected options remain visually highlighted (e.g., pill/chip style). Multiple filters can be active simultaneously. Clicking a selected filter deselects it.

**Alert cards:** Show priority level, subreddit, time ago, title, category tag, upvotes, comments. No relevance score shown to user — priority encompasses everything.

**Alert seen tracking:** An alert transitions from "New" to "Seen" when it is visible on the user's dashboard viewport (use intersection observer on the frontend). Update `is_seen=true` and `seen_at=NOW()` via API call.

**Empty states:**
- No alerts yet: "Monitoring is active. We're scanning your subreddits every 15 minutes. You'll see relevant posts here as we find them."
- No subreddits: Show onboarding wizard CTA
- Scan paused (API error): "Alert scanning is temporarily paused. We're retrying automatically."

**Subreddit goes private:** Shown in the monitored subreddits section with a 🔒 icon and "Paused" status. Scanning pauses automatically. If the subreddit becomes public again, scanning resumes. User can remove it anytime.

**Navigation:** Top nav has 3 items: Dashboard, Thread Analysis, Settings. No separate "Drafts" page — drafts are accessed contextually from alerts/thread analysis.

### 5.3 Thread Analysis View (Chat Interface with Sidebar History)

**Trigger:** User clicks "Analyze Thread" on an alert, OR enters a Reddit URL **on this page only** (manual URL input is restricted to the Thread Analysis page).

**Layout:** Chat-style interface. Left sidebar shows history of all past analyses (like ChatGPT sidebar). Main area shows the current analysis + chat.

**Thread display:** Show the post title, author, subreddit, time, upvotes/comments summary, and a brief snippet (same card format as dashboard). Link to full thread on Reddit — do NOT display the full thread/comments on our platform.

```
┌──────────────────────────────────────────────────────────────┐
│  Thread Analysis                                              │
├────────────┬─────────────────────────────────────────────────┤
│            │                                                  │
│  HISTORY   │  ┌─ POST SUMMARY ─────────────────────────────┐│
│  (sidebar) │  │  r/saas · 2 hours ago · u/founder123       ││
│            │  │  "Looking for alternatives to [Competitor]"  ││
│  Today     │  │  12 upvotes · 8 comments                    ││
│  ○ Looking │  │  [View full thread on Reddit →]              ││
│    for alt │  └──────────────────────────────────────────────┘│
│  ○ Best    │                                                  │
│    tools   │  ┌─ AI ANALYSIS ──────────────────────────────┐│
│            │  │  📝 SUMMARY                                  ││
│  Yesterday │  │  The author is frustrated with [Competitor]  ││
│  ○ Reddit  │  │  after a recent 40% price increase...       ││
│    market  │  │                                              ││
│  ○ How to  │  │  😣 PAIN POINTS                              ││
│    grow    │  │  • Price increase unaffordable               ││
│            │  │  • Lack of real-time alerting                ││
│  This Week │  │  • Too much noise in alerts                  ││
│  ○ ...     │  │                                              ││
│            │  │  💡 KEY INSIGHTS                              ││
│  ──────────│  │  • 3 commenters need "instant alerts"        ││
│            │  │  • 2 users ask about thread analysis         ││
│  [+ New    │  │                                              ││
│  Analysis] │  │  🎯 BUYING INTENT SIGNALS                    ││
│            │  │  • u/user4: "budget ~$50/mo"                 ││
│  Paste URL:│  │  • u/user1: active solution seeker           ││
│  [________]│  │                                              ││
│  [Analyze] │  │  🏢 COMPETITIVE LANDSCAPE                    ││
│            │  │  • [Competitor A]: 3x, negative sentiment    ││
│            │  │  • [Competitor B]: 1x, neutral               ││
│            │  │                                              ││
│            │  │  📊 SENTIMENT: Mixed (negative toward        ││
│            │  │     incumbents)                               ││
│            │  │  🏷 COMMENTS ANALYZED: 23 of 23              ││
│            │  └──────────────────────────────────────────────┘│
│            │                                                  │
│            │  ┌─ SUGGESTED QUESTIONS ────────────────────────┐│
│            │  │  [What opportunities exist for us here?]     ││
│            │  │  [Which commenters are potential customers?]  ││
│            │  │  [What features are users asking for?]       ││
│            │  │  [How should we position against competitors?]││
│            │  └──────────────────────────────────────────────┘│
│            │                                                  │
│            │  ┌──────────────────────────────────────────────┐│
│            │  │  💬 Ask a follow-up question...               ││
│            │  │  ┌──────────────────────────────────────┐    ││
│            │  │  │                                      │    ││
│            │  │  └──────────────────────────────────────┘    ││
│            │  │  [Send]                                       ││
│            │  └──────────────────────────────────────────────┘│
│            │                                                  │
│            │  [Draft a Response] [View on Reddit]             │
└────────────┴─────────────────────────────────────────────────┘
```

**Suggested questions:** 4 pre-built questions shown as clickable chips below the analysis. User can click one instead of typing. These adapt based on thread content (e.g., if competitors are mentioned, suggest a competitive positioning question).

Default suggestions:
1. "What opportunities exist for us in this thread?"
2. "Which commenters are potential customers?"
3. "What specific features are users asking for?"
4. "How should we position against the competitors mentioned?"

**Sidebar history:** All past thread analyses are saved and accessible via the left sidebar, grouped by date (Today, Yesterday, This Week, Earlier). Clicking a past analysis loads it with its full chat history. Works exactly like ChatGPT's sidebar.

**Manual URL input:** Located in the left sidebar below the history. User pastes a Reddit URL and clicks Analyze. This is the **only** place in the app where manual URL input is available.

**Chat functionality:** After the initial analysis, users can ask follow-up questions. Thread content + analysis + previous messages included as context for each new message. Chat messages stored in `thread_chat_messages` table.

### 5.4 Comment Drafting View

**Trigger:** User clicks "Draft Response" on an alert or thread analysis. Can draft a response to the **original post** or to a **specific comment** (user selects which comment to reply to from the thread view).

**LLM provider:** OpenAI (ChatGPT) APIs for comment drafting. Claude APIs for everything else.

**Output:**
```
┌──────────────────────────────────────────────────────────────┐
│  Draft Responses for: "Looking for alternatives to..."       │
│  Replying to: [Original Post ▼] (dropdown: post or comment) │
│                                                               │
│  ⚠ Subreddit Rules (r/saas):                                │
│  • No direct product links in comments                       │
│  • Must provide value, not just self-promote                 │
│  • Flair required for tool recommendations                   │
│                                                               │
│  ┌─ Draft 1: Helpful & Conversational ───────────────────┐  │
│  │ "Hey! I totally understand the frustration with        │  │
│  │ pricing. What specific features are must-haves for     │  │
│  │ you? I've been building something that focuses on      │  │
│  │ real-time alerts specifically because..."              │  │
│  │                                                        │  │
│  │ [Copy] [Edit] [Regenerate] [Approve]                   │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                               │
│  ┌─ Draft 2: Technical & Detailed ───────────────────────┐  │
│  │ "Former [Competitor] user here. The main things to     │  │
│  │ look at when evaluating alternatives are: 1) alert     │  │
│  │ speed (how fast they notify you), 2) false positive    │  │
│  │ rate, 3) whether they can analyze threads..."          │  │
│  │                                                        │  │
│  │ [Copy] [Edit] [Regenerate] [Approve]                   │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

**Key behaviors:**
- **Per-draft [Regenerate]** — regenerates only that specific draft, not the whole page
- **[Edit] includes write-your-own** — clicking Edit opens the draft text as editable. User can modify or replace entirely. No separate "Write My Own" CTA needed.
- **No "Rule check: PASS" display** — subreddit rules are shown at the top for context. Rule checking happens internally but the pass/fail badge is not shown (redundant noise).
- **Comment-level targeting** — user can select whether they're replying to the original post or a specific comment in the thread

**Important:** No auto-posting. User copies the text and posts manually on Reddit. The "Approve" button is for internal tracking (marking that the user used this draft).

### 5.5 Settings Page (Sidebar Tabs)

```
┌──────────────────────────────────────────────────────────────┐
│  Settings                                                     │
├────────────┬─────────────────────────────────────────────────┤
│            │                                                  │
│  SECTIONS  │  ┌─── BUSINESS PROFILE ──────────────────────┐ │
│  (sidebar) │  │                                            │ │
│            │  │  Current Business: [Example Inc ▼]         │ │
│  ● Business│  │  (MVP: 1 business. Multi-business soon.)   │ │
│    Profile │  │                                            │ │
│            │  │  Business Name: [_____________]            │ │
│  ○ Notifi- │  │  Website: [_____________]                  │ │
│    cations │  │  Description: [_____________] (editable)   │ │
│            │  │  Target Audience: [_____________]           │ │
│  ○ Usage & │  │  Brand Voice: [_____________]              │ │
│    Billing │  │                                            │ │
│            │  │  ICP Description: [_____________]          │ │
│            │  │  Keywords: [kw1 ✕] [kw2 ✕] [+ add]       │ │
│            │  │  Competitors: [Comp A ✕] [+ add]          │ │
│            │  │  Subreddits:                               │ │
│            │  │    [saas ✕ Strong●] [startups ✕ Med●]     │ │
│            │  │    [+ add] (5/10 used)                    │ │
│            │  │    (hover tag for health details)          │ │
│            │  │                                            │ │
│            │  │  [Save Changes]                            │ │
│            │  └────────────────────────────────────────────┘ │
│            │                                                  │
├────────────┼─────────────────────────────────────────────────┤
│            │  ┌─── NOTIFICATIONS ─────────────────────────┐ │
│  (when     │  │                                            │ │
│  selected) │  │  Email alerts: [On ▼]                      │ │
│            │  │  Alert threshold: [High priority only ▼]   │ │
│            │  │    Options: All / High + Medium / High only │ │
│            │  │                                            │ │
│            │  │  [Save Changes]                            │ │
│            │  └────────────────────────────────────────────┘ │
│            │                                                  │
├────────────┼─────────────────────────────────────────────────┤
│            │  ┌─── USAGE & BILLING ───────────────────────┐ │
│  (when     │  │                                            │ │
│  selected) │  │  Coming soon.                              │ │
│            │  │                                            │ │
│            │  └────────────────────────────────────────────┘ │
└────────────┴─────────────────────────────────────────────────┘
```

**Layout:** Left sidebar navigation with 3 sections. Active section highlighted. Content area on the right shows the selected section.

**Subreddit input:** User types only the name (e.g., "saas"). The `r/` prefix is shown automatically. Health details shown only on hover.

**Add/Delete for dynamic fields:** ICP, Keywords, Competitors, and Subreddits all support manual add and delete. Description and Brand Voice are free-text editable.

**Usage & Billing:** Placeholder for now — will be defined later once pricing is finalized.

---

## 6. API Integrations

### 6.1 Reddit API

**Authentication:** OAuth2 (script app type for server-to-server)
- Register at https://www.reddit.com/prefs/apps
- Free tier: 100 requests/minute with OAuth
- Endpoints used:
  - `GET /r/{subreddit}/new.json` — fetch new posts (scanner)
  - `GET /r/{subreddit}/about/rules.json` — fetch subreddit rules
  - `GET /r/{subreddit}/about.json` — subreddit metadata (for health assessment + existence validation)
  - `GET /comments/{article_id}.json` — fetch thread comments (for thread analysis)

**Rate limit management:**
- Track requests per minute globally
- Scanner: 1 request per subreddit per 15-min scan cycle
- Thread analysis: 1 request per thread analyzed (on-demand, user-triggered)
- Budget: ~1500 subreddits max at 15-min cycles (scanner only). Thread analysis requests are additional but user-driven and infrequent.
- On 429 response: exponential backoff (1s, 2s, 4s, 8s, max 60s)

### 6.2 Claude API (Anthropic) — Relevance, Analysis, Intelligence

**Models used:**
- **Claude Haiku** — relevance scoring (Pass 2), subreddit health assessment, ICP matching
- **Claude Sonnet** — thread analysis, thread chat follow-ups, onboarding website analysis

**Usage per scan cycle (per user):**
- Pre-filter (Pass 1): zero LLM calls — local semantic model + keyword/regex
- Relevance scoring (Pass 2): ~5-25 Haiku calls (only posts passing semantic filter)
- Thread analysis: ~1-5 Sonnet calls (on-demand, user-triggered)
- Thread chat: ~1-10 Sonnet calls (on-demand, per user question)
- Onboarding: ~5-8 Sonnet calls (one-time, two-agent pipeline: Agent 1 business analysis + Agent 2 subreddit/keyword discovery)

### 6.3 OpenAI API (ChatGPT) — Comment Drafting

**Model used:** GPT-4o or GPT-4o-mini for comment drafting
- Comment drafts: 2-3 calls per draft request (one per tone variant)
- System prompt includes: subreddit rules, brand voice, thread context, parent comment context

### 6.4 Email Service (Amazon SES)

**Why SES over Resend:** Resend free tier caps at 100 emails/day (3,000/month). For an alerting product that needs to email users the moment a high-priority post is found, this is too restrictive even at MVP. Amazon SES costs $0.10/1000 emails with no meaningful daily cap.

- **No rate limit on user inbox** — alerts are time-sensitive, similar to Slack notifications. Every high-priority alert triggers an immediate email. Users control volume via alert threshold setting (All / High + Medium / High only).

### 6.5 LLM Failover Strategy

**Primary → Fallback mapping:**
| Function | Primary | Fallback |
|----------|---------|----------|
| Relevance scoring | Claude Haiku | GPT-4o-mini |
| Thread analysis | Claude Sonnet | GPT-4o |
| Thread chat | Claude Sonnet | GPT-4o |
| Comment drafting | GPT-4o | Claude Sonnet |
| Onboarding analysis | Claude Sonnet | GPT-4o |

**Failover trigger:** 3 consecutive failures OR >10s timeout on primary → switch to fallback for that function for 5 minutes, then retry primary. Same system prompts used for both providers to ensure consistent output quality.

---

## 7. Background Workers (Cron Jobs)

### 7.1 Reddit Scanner (every 15 minutes)

```
FOR each active monitored_subreddit (where status = 'active'):

  PASS 1 — SEMANTIC + KEYWORD PRE-FILTER (zero LLM API cost):

  Uses a local sentence-transformer model (all-MiniLM-L6-v2, ~80MB, open source)
  for semantic similarity scoring combined with keyword matching and regex.

  How it works:
  a. On user onboarding, generate embedding vectors for:
     - User's business description
     - User's ICP description
     - Each keyword
     - Competitor names + context phrases
     Store these as a "user relevance profile" vector.

  b. For each incoming post (title + body):
     - Generate embedding vector using same model (~5ms per post)
     - Cosine similarity against user relevance profile
     - Keyword exact/fuzzy match (stemming, synonyms)
     - Intent signal regex (drawn from all 5 category keyword signals):
       Pain: "frustrated with", "waste of time", "so tedious", "struggling with"
       Solution: "looking for", "recommend", "best tool for", "any suggestions",
                 "help me find", "need a", "budget $"
       Competitor: "alternative to", "switching from", "replacing", "tired of"
       Experience: "honest review", "just switched to", "been using", "my take"
       Industry: "how do you", "best practices", "what's your process"
     - Competitor name match: check against competitor list

  c. Scoring (0.0 - 1.0):
     - semantic_score: cosine similarity (0.0 - 1.0)
     - keyword_boost: +0.2 if keyword match, +0.3 if competitor match
     - intent_boost: +0.15 if intent regex matches
     - pass1_score = min(1.0, semantic_score + keyword_boost + intent_boost)

  d. IF pass1_score >= 0.4 → pass to Pass 2
     ELSE → discard (not relevant)

  Threshold rationale (0.4):
  - Below 0.4 with no keyword/intent boost = weak semantic match, almost never relevant
  - A keyword match (0.2) or intent signal (0.15) can lift a borderline semantic
    score (0.2-0.25) above threshold — so boosted posts still pass
  - Pure semantic matches need 0.4+ cosine similarity, which means clearly
    related topics (not just tangential overlap)
  - Going higher (0.5+) risks filtering complaint threads that describe the
    exact pain point but don't use "looking for" language — high-value posts
  - Monitor via `prefilter.scored` events: if >70% of posts pass, threshold
    may be too loose; if <20% pass, may be too aggressive

  Model: all-MiniLM-L6-v2 (https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2)
  - 80MB, runs on CPU, ~5ms per embedding
  - Captures semantic meaning: "searching for a solution" matches "tool recommendation"
  - Open source (Apache 2.0), no API costs

  PASS 2 — LLM RELEVANCE SCORING (Haiku, only filtered posts):
  1. FOR each post that passed Pass 1:
     a. Send to Claude Haiku with context:
        - Post title + body
        - User's business description
        - User's ICP description
        - User's keywords
        - User's competitor list
     b. LLM returns:
        - relevance_score (0.0 - 1.0)
        - category (one of the 5 post categories — see §7.1.1 below)
     c. Calculate priority_score (weighted formula):
        - relevance (40%): from LLM score
        - recency (30%):
            < 15 min  → 1.0
            < 1 hour  → 0.8
            < 3 hours → 0.6
            < 6 hours → 0.4
            < 12 hours → 0.2
            > 12 hours → 0.1
        - engagement_velocity (15%): (upvotes + comments) / minutes_since_posted
        - intent_signals (15%): 1.0 if strong intent phrases, 0.5 if weak, 0.0 if none
     d. Derive priority_level:
        - HIGH: priority_score > 0.7
        - MEDIUM: priority_score 0.4 - 0.7
        - LOW: priority_score 0.2 - 0.4
        - BELOW THRESHOLD: priority_score < 0.2 → do NOT create alert
     e. IF priority >= 0.2:
        - Insert into alerts table with all scores and factors
        - IF HIGH priority → queue immediate email (if user has email alerts on)
        - IF MEDIUM → in-app only (unless user setting = "all alerts")

  3. Update last_scanned_at and last_seen_post_id
```

**Priority examples:**

| Scenario | Relevance (40%) | Recency (30%) | Velocity (15%) | Intent (15%) | Total | Level |
|----------|----------------|---------------|----------------|--------------|-------|-------|
| "Looking for alternative to [Competitor], budget $50/mo" posted 5 min ago, 3 upvotes | 0.95 | 1.0 | 0.8 | 1.0 | **0.95** | HIGH |
| "Best tools for customer discovery?" posted 45 min ago, 5 comments | 0.75 | 0.8 | 0.6 | 0.5 | **0.72** | HIGH |
| "General discussion about marketing strategies" posted 3 hrs ago, 2 comments | 0.40 | 0.6 | 0.2 | 0.0 | **0.36** | LOW |
| "Check out my new cat photo" in r/saas, posted 1 hr ago | 0.05 | 0.8 | 0.1 | 0.0 | **0.28** | LOW |

### 7.1.1 Post Category Definitions

The LLM classifies each post into exactly one of these 5 categories. These definitions and keyword signals are included in the Haiku system prompt to ensure consistent classification.

**1. Pain Points** (`pain_point`)
The poster is expressing a problem, frustration, or challenge — but is NOT yet asking for a specific tool or solution. They're venting, describing friction, or looking for empathy and validation. They know something hurts, but haven't framed it as "I need software X."

Keyword signals: "frustrated with", "hate doing", "waste of time", "so tedious", "anyone else deal with", "is it just me or...", "struggling with", "can't figure out", "drives me crazy"

Example: *"Spent 3 hours today manually scrolling through r/saas looking for relevant threads. This is such a waste of time."*

**2. Solution Requests** (`solution_request`)
The poster is explicitly asking for a tool, product, service, or approach to solve a stated problem. They've moved past frustration and are now in "shopping mode." This is the highest direct-intent category.

Keyword signals: "recommend", "looking for", "best tool for", "any suggestions", "what do you use for", "anyone know a good...", "need a tool that", "help me find", "budget $"

Example: *"Looking for a Reddit monitoring tool that can alert me when someone mentions my competitors. Budget around $50/mo. Any suggestions?"*

**3. Competitor Dissatisfaction** (`competitor_dissatisfaction`)
The poster is specifically naming a competitor product and expressing dissatisfaction OR explicitly seeking alternatives. The conversation is anchored around an existing product, not an open-ended need.

Keyword signals: "[competitor] alternative", "switching from [competitor]", "[competitor] vs", "[competitor] sucks", "replacing [competitor]", "tired of [competitor]", "leaving [competitor]", "[competitor] pricing is insane"

Example: *"GummySearch shut down and I'm looking for alternatives. What are you all using now for Reddit lead monitoring?"*

**4. Experience Sharing** (`experience_sharing`)
The poster is sharing their personal experience with a product — positive, negative, or neutral. They're NOT asking for help; they're TELLING the community what they found. Includes retrospective reviews, comparison posts, and stack-sharing posts.

Keyword signals: "here's my experience", "honest review", "been using X for", "just switched to", "my stack is", "PSA about", "X vs Y — my take", "after 6 months with", "quick review of"

Example: *"Been using Pulse for 3 months now for Reddit monitoring. Here's my honest take — the alerts are decent but the thread analysis is basically non-existent."*

**5. Industry / Workflow Discussion** (`industry_discussion`)
The poster is discussing a general process, workflow, strategy, or industry topic related to the user's domain — but isn't expressing a specific pain point or asking for a tool. They're in "learning mode" or "discussion mode." These posts indicate the person is in the user's ICP but at the earliest possible stage.

Keyword signals: "how do you", "what's your process for", "best practices for", "curious how", "what does your team do about", "workflow for", "how are people handling", "what's the state of"

Example: *"How do you all handle Reddit as a marketing channel? Curious what your process looks like for finding relevant threads."*

---

**Error handling:**
- Reddit API timeout → skip subreddit, retry next cycle
- Reddit API 429 → backoff, reduce scan frequency temporarily
- Reddit API 403 (subreddit private/banned) → mark subreddit status='private' or 'banned', show 🔒 on dashboard
- LLM timeout → use Pass 1 score only, flag post as "unscored"
- LLM malformed response → fallback to Pass 1 scoring, log error for investigation
- LLM API down → switch to failover model (see §6.5)

### 7.2 Subreddit Health Refresh

**Manual process:** Run every 1-2 months via Supabase dashboard + Claude Code. Not an automated cron job.

Steps:
1. Query `subreddit_health_cache` for entries with `last_refreshed` > 60 days
2. For each: fetch `/r/{subreddit}/about.json` to check if still exists/public
3. If gone/private → update status, flag any users monitoring it
4. If active → re-run health assessment parameters
5. Update all fields and `last_refreshed` timestamp

---

## 8. Security Considerations

| Threat | Mitigation |
|--------|-----------|
| User A accesses User B's data | All DB queries scoped by `business_id`. Enforce at ORM/query layer. |
| XSS from Reddit content in dashboard | Sanitize all Reddit-sourced HTML/markdown before rendering. Use DOMPurify or equivalent. |
| LLM prompt injection via Reddit posts | Reddit content passed as user content in LLM calls, never as system prompt. |
| Reddit OAuth credential exposure | Store in environment variables. Never client-side. |
| Abuse: user creates too many subreddits | Enforce per-user limit: max 10 subreddits. Application-layer check. |
| Rate limit exhaustion by single user | Per-user subreddit caps ensure fair distribution of API budget. |
| LLM API key exposure | Server-side only. Never sent to client. Separate keys for Claude and OpenAI. |

---

## 9. Error States & User-Facing Messages

| Error | User sees | Behavior |
|-------|-----------|----------|
| Reddit API down | "Alert scanning is temporarily paused. Retrying automatically." | Banner at top of dashboard |
| LLM API failure (primary) | Nothing — transparent failover to backup model | Auto-switch, log event |
| LLM API failure (both primary + fallback) | Thread shows raw content + "Analysis temporarily unavailable. Retrying..." | Auto-retry, no user action needed |
| Email delivery failed | **Nothing on frontend** — handled silently | Retry 3x server-side, log to event_logs. Do not surface to user. |
| Subreddit goes private | 🔒 icon next to subreddit name + "Paused" status in monitored subreddits section | Scanning pauses. Auto-resumes if public again. User can remove. |
| Subreddit banned/deleted | Same 🔒 icon + "Unavailable" status | User notified via in-app indicator only |
| Website unreachable (onboarding) | "We couldn't reach your website. Please enter your business details manually." | Fallback to manual form |
| No relevant posts found | "No relevant posts in the last 24 hours. We're still monitoring." | Normal state — not an error |
| Post deleted since alert | "This post may have been deleted or removed." | Show cached content with warning |
| Subreddit doesn't exist (manual add) | "This subreddit does not exist. Check the spelling." | Inline error on add attempt |
| Max subreddits reached | "Maximum 10 subreddits allowed. Remove one to add another." | Prevent add, show count |

---

## 10. Metrics, Observability & Logging

### 10.1 Event Taxonomy (stored in event_logs table in Supabase)

**Frontend Events (source: 'frontend'):**
| Event Type | Payload | Trigger |
|-----------|---------|---------|
| `user.login` | `{method, timestamp}` | User logs in |
| `user.signup` | `{method, referrer}` | New account created |
| `onboarding.started` | `{step: 1}` | Onboarding wizard opened |
| `onboarding.website_analyzed` | `{url, success, duration_ms}` | Website analysis complete |
| `onboarding.completed` | `{subreddits_count, keywords_count, competitors_count}` | Onboarding finished |
| `dashboard.viewed` | `{alerts_count, filter_state}` | Dashboard page loaded |
| `alert.seen` | `{alert_id, priority_level, time_since_created}` | Alert scrolled into viewport |
| `alert.clicked` | `{alert_id, action: 'analyze'|'draft'|'reddit'}` | User clicks alert action |
| `thread.analysis_requested` | `{alert_id, source: 'alert'|'manual_url'}` | Thread analysis triggered |
| `thread.chat_message_sent` | `{thread_analysis_id, message_length}` | User asks follow-up in chat |
| `thread.history_accessed` | `{thread_analysis_id}` | User clicks past analysis in sidebar |
| `draft.requested` | `{alert_id, reply_target: 'post'|'comment'}` | Draft generation triggered |
| `draft.copied` | `{draft_id, tone}` | User copies a draft |
| `draft.edited` | `{draft_id, edit_length}` | User edits a draft |
| `draft.regenerated` | `{draft_id, tone}` | User regenerates a specific draft |
| `draft.approved` | `{draft_id, tone}` | User approves a draft |
| `settings.updated` | `{section, fields_changed}` | Settings saved |
| `subreddit.added` | `{subreddit_name, source: 'manual'|'suggested'}` | Subreddit added |
| `subreddit.removed` | `{subreddit_name}` | Subreddit removed |
| `filter.changed` | `{filter_type, value}` | Dashboard filter changed |
| `sort.changed` | `{sort_type}` | Dashboard sort changed |
| `page.viewed` | `{page, duration_ms}` | Page navigation |
| `suggested_question.clicked` | `{thread_analysis_id, question_text}` | User clicks a suggested question |

**Backend Events (source: 'backend'):**
| Event Type | Payload | Trigger |
|-----------|---------|---------|
| `scan.cycle_started` | `{subreddits_count, cycle_id}` | Cron job starts |
| `scan.cycle_completed` | `{duration_ms, posts_fetched, posts_filtered_pass1, posts_scored_pass2, alerts_created, errors}` | Cron job finishes |
| `scan.subreddit_scanned` | `{subreddit, posts_found, posts_relevant, duration_ms}` | Single subreddit scanned |
| `scan.subreddit_error` | `{subreddit, error_type, error_message}` | Subreddit scan failed |
| `prefilter.scored` | `{post_id, semantic_score, keyword_match, intent_match, pass1_score, passed}` | Pass 1 pre-filter result |
| `relevance.scored` | `{post_id, score, model, duration_ms, pass1_score}` | LLM relevance score computed |
| `relevance.fallback_used` | `{post_id, primary_model, fallback_model, reason}` | Primary LLM failed, fallback used |
| `priority.calculated` | `{alert_id, factors: {relevance, recency, velocity, intent}, total, level}` | Priority score computed |
| `thread.analyzed` | `{thread_id, comments_count, model, duration_ms, tokens_used}` | Thread analysis completed |
| `thread.chat_response` | `{thread_analysis_id, model, duration_ms, tokens_used}` | Chat follow-up answered |
| `draft.generated` | `{alert_id, tone, model, duration_ms, tokens_used}` | Comment draft generated |
| `email.sent` | `{alert_id, user_id, priority_level}` | Alert email sent |
| `email.failed` | `{alert_id, user_id, error, retry_count}` | Alert email failed |
| `email.retry` | `{alert_id, attempt_number}` | Email retry attempted |
| `health.assessed` | `{subreddit, overall_tag, source: 'cache_hit'|'fresh'}` | Subreddit health assessed |
| `llm.error` | `{provider, model, error_type, duration_ms}` | LLM API call failed |
| `llm.failover` | `{function, from_provider, to_provider}` | Failover triggered |
| `reddit_api.error` | `{endpoint, status_code, subreddit}` | Reddit API error |
| `reddit_api.rate_limited` | `{requests_used, limit}` | Rate limit approached/hit |

**System Events (source: 'system'):**
| Event Type | Payload | Trigger |
|-----------|---------|---------|
| `subreddit.went_private` | `{subreddit, affected_users_count}` | Subreddit became inaccessible |
| `subreddit.came_back` | `{subreddit, was_private_days}` | Private subreddit became public |

### 10.2 Health Indicators (dashboard for internal monitoring)

All queryable directly from Supabase:

| Metric | Query approach | Alert threshold |
|--------|---------------|-----------------|
| Scan cycle duration | `AVG(duration_ms) WHERE event_type = 'scan.cycle_completed'` | >14 min (approaching 15-min window) |
| LLM error rate | `COUNT(llm.error) / COUNT(relevance.scored) per hour` | >5% |
| Email delivery rate | `COUNT(email.sent) / (COUNT(email.sent) + COUNT(email.failed))` | <95% |
| Reddit API error rate | `COUNT(reddit_api.error) per hour` | >10/hour |
| Failover frequency | `COUNT(llm.failover) per hour` | >5/hour (indicates primary instability) |
| Pass 1 filter rate | `COUNT(passed=true) / COUNT(*) WHERE event_type = 'prefilter.scored'` | >70% pass = too loose, <20% pass = too aggressive |
| Alert relevance | Future: user feedback on alert quality | — |
| Avg time to first alert | `AVG(first_alert.created_at - user.onboarding.completed)` | >30 min |

### 10.3 Logging Standards

**All logs are structured JSON** written to Supabase via the `event_logs` table. No unstructured text logs.

**Required fields for every log entry:**
- `event_type` — from the taxonomy above
- `source` — 'frontend' | 'backend' | 'cron' | 'system'
- `created_at` — UTC timestamp
- `event_data` — structured JSONB payload

**Frontend logging:** Use a lightweight event tracking utility that batches events and sends to a `/api/events` endpoint. Batch size: 10 events or 30 seconds, whichever comes first. Include `session_id` for session-level analysis.

**Backend logging:** Log synchronously within request/job handlers. Include `request_id` for request-level tracing across multiple log entries.

**Retention:** 90 days in Supabase. Aggregate monthly summaries for trend tracking beyond 90 days.

---

## 11. Open Decisions for Engineering

These decisions should be made during `/plan-eng-review` before implementation begins:

1. **Auth:** Clerk vs. Supabase Auth vs. NextAuth
2. **Cron/Worker:** Inngest vs. Railway cron vs. custom
3. **Hosting:** Railway (everything) vs. Vercel (frontend) + Railway (workers)
4. **LLM prompt templates:** Exact prompts for relevance scoring (Pass 2 Haiku prompt), health assessment, thread analysis, thread chat, comment drafting
5. **Data retention policy:** How long to keep alerts, analyses, and event_logs
6. **Pricing tiers:** What features are free vs. paid, what are the limits
7. **Thread comment pagination:** Fetch all comments at once vs. paginate for large threads (>100 comments)
8. **Frontend event batching implementation:** SDK choice or custom utility for event tracking
9. **Sentence-transformer deployment:** Run locally on worker server vs. as a microservice vs. pre-compute embeddings at ingestion time
