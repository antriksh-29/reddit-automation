# Product Specification: Reddit Lead Intelligence Platform

**Version:** 1.1 (MVP)
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
- Monitors 5-15 subreddits for lead gen and brand awareness
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
│  Pass 1: Keyword/Regex pre-filter (zero LLM cost)          │
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
keywords        JSONB       (array of monitoring keywords — add/delete manually)
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
commercial_tolerance ENUM   ('strong', 'medium', 'weak')
activity_tag    ENUM        ('strong', 'medium', 'weak')
engagement_tag  ENUM        ('strong', 'medium', 'weak')
moderation_tag  ENUM        ('strong', 'medium', 'weak')
overall_tag     ENUM        ('strong', 'medium', 'weak')
health_details  JSONB       (per-parameter breakdown with explanations)
category        VARCHAR     (e.g., 'engineering', 'sales', 'marketing', 'product', etc.)
last_refreshed  TIMESTAMP   DEFAULT NOW()
created_at      TIMESTAMP   DEFAULT NOW()

NOTE: Pre-seeded with ~500 popular subreddits across functions.
      Refreshed every 1-2 months via background job.
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
CONSTRAINT max_subreddits_per_business CHECK via application layer (max 15)
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
relevance_score FLOAT       (0.0 - 1.0, from LLM)
relevance_reasoning TEXT    (one-line LLM explanation for score)
priority_score  FLOAT       (composite: weighted formula below)
priority_level  ENUM        ('high', 'medium', 'low') — derived from priority_score
priority_factors JSONB      (breakdown of each factor's contribution)
category        ENUM        ('general', 'competitor_mention', 'high_intent') DEFAULT 'general'
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
         ▼ (LLM analyzes homepage)

Step 2: Business Profile + Monitoring Setup (single page, all editable)
  ┌─────────────────────────────────────────────────────────┐
  │  BUSINESS PROFILE                                       │
  │  Business Name: [Example Inc        ] (editable)        │
  │  Description:   [AI-generated...    ] (editable)        │
  │  Target Audience: [AI-generated..   ] (editable)        │
  │  Brand Voice:   [Professional, helpful...] (editable)   │
  │                                                         │
  │  ─────────────────────────────────────────────────────  │
  │                                                         │
  │  KEYWORDS                                               │
  │  [keyword1 ✕] [keyword2 ✕] [keyword3 ✕] [+ add]       │
  │                                                         │
  │  COMPETITORS                                            │
  │  [Competitor A ✕] (auto) [Competitor B ✕] (auto)       │
  │  [+ Add competitor]                                     │
  │                                                         │
  │  SUBREDDITS TO MONITOR (max 15)                         │
  │  AI-suggested subreddits:                               │
  │  ☑ r/saas          [Strong ●] (hover for details)      │
  │  ☑ r/startups      [Medium ●] (hover for details)      │
  │  ☐ r/smallbusiness [Weak ●]   (hover for details)      │
  │                                                         │
  │  [+ Add subreddit manually]                             │
  │  ┌─────────────────────────────┐                        │
  │  │ r/customsubreddit           │                        │
  │  └─────────────────────────────┘                        │
  │  → Existence check + health assessment runs on add      │
  │                                                         │
  │  [Start Monitoring →]                                   │
  └─────────────────────────────────────────────────────────┘
```

**Health details on hover (not expanded by default):**
```
  ┌─ r/saas Health Assessment ────────────────┐
  │  Overall: Strong ●                         │
  │                                            │
  │  PRIMARY FACTORS                           │
  │  Activity Level:        Strong — 45/day    │
  │  ICP Relevance:         Strong — 85% match │
  │  Commercial Tolerance:  Medium — helpful    │
  │                         mentions OK         │
  │                                            │
  │  SECONDARY FACTORS                         │
  │  Engagement Quality:    Strong — 72% deep  │
  │  Moderation Strictness: Medium — 8 rules   │
  │  Conversation Recency:  Strong — trending↑ │
  └────────────────────────────────────────────┘
```

**Subreddit validation on add:**
1. Hit Reddit API `/r/{subreddit}/about.json`
2. If 404 → show inline error: "r/example does not exist. Check the spelling."
3. If 403 (private) → show: "r/example is a private subreddit and cannot be monitored."
4. If 200 → check `subreddit_health_cache`. If not cached, run health assessment and cache it.

**Edge cases:**
- Website unreachable → show error, offer manual entry
- Website has minimal content → generate partial profile, flag gaps for manual input
- No subreddits match → show "No matches found, please add subreddits manually"
- User tries to add >15 subreddits → show "Maximum 15 subreddits allowed. Remove one to add another."

### 5.1.1 First-Time Post Fetch

**Immediately after onboarding completes:**
1. Trigger an initial scan for the user's configured subreddits + keywords
2. Filter: posts from the **last 24 hours** only
3. Run the two-pass relevance pipeline (keyword pre-filter → Haiku scoring)
4. Populate dashboard with results — user sees relevant posts immediately, not a blank dashboard

**Cron alignment:** If the first scan completes at 5:17 PM, schedule the user's first cron scan at 5:45 PM (next 15-min boundary, rounded up). From there, scan every 15 minutes on schedule.

### 5.1.2 Subreddit Health Cache

**Pre-seeded database of ~500 popular subreddits** across categories:
- Engineering: r/programming, r/webdev, r/devops, r/MachineLearning, etc.
- Sales: r/sales, r/B2BSaaS, r/coldcalling, etc.
- Marketing: r/marketing, r/socialmedia, r/SEO, r/content_marketing, etc.
- Product: r/ProductManagement, r/UXDesign, r/startups, etc.
- Industry-specific: r/fintech, r/healthIT, r/legaltech, etc.

**Refresh cadence:** Background job runs every 60 days to re-assess all cached subreddits.

**New subreddit flow:** When a user adds a subreddit not in the cache:
1. Validate existence (Reddit API)
2. Run full health assessment
3. Insert into `subreddit_health_cache` — all future users benefit from this assessment

This minimizes Reddit API calls — most subreddits will already be cached.

**Health Assessment Parameters:**

| Parameter | Type | Data Source | Strong | Medium | Weak |
|-----------|------|-----------|--------|--------|------|
| Activity Level | PRIMARY | Reddit API: posts/day, comments/post | >20 posts/day, >5 comments/post avg | 5-20 posts/day, 2-5 comments/post | <5 posts/day or <2 comments/post |
| ICP Relevance | PRIMARY | LLM scoring against ICP description | >80% topic overlap with ICP | 50-80% overlap | <50% overlap |
| Commercial Tolerance | PRIMARY | Rules analysis via LLM | No anti-promo rules, product mentions welcome | Allows helpful mentions, bans direct promotion | Explicit anti-commercial rules, bans product links |
| Engagement Quality | SECONDARY | Reddit API: upvote ratios, discussion depth | >70% posts get 3+ comments | 40-70% get 3+ comments | <40% get 3+ comments |
| Moderation Strictness | SECONDARY | Reddit API: /about/rules.json | <5 rules, no automod mention | 5-10 rules, moderate policies | >10 rules, strict automod, frequent removals |
| Conversation Recency | SECONDARY | Reddit API: relevant posts in 7d vs 30d | Increasing trend, >5 relevant/week | Stable, 2-5 relevant/week | Declining or <2 relevant/week |

**Overall Ranking Formula:**
- Score each parameter: Strong=3, Medium=2, Weak=1
- Primary parameters weighted 2x, Secondary weighted 1x
- Max possible score = (3 × 3 × 2) + (3 × 3 × 1) = 18 + 9 = 27
- **Strong overall:** 22-27 | **Medium overall:** 15-21 | **Weak overall:** <15

### 5.2 Dashboard

**Layout:**
```
┌──────────────────────────────────────────────────────────────┐
│  [Logo]  Dashboard | Threads | Drafts | Settings    [User ▼] │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌─── FILTERS & SORT ─────────────────────────────────────┐ │
│  │  View: [New ▼] [Seen ▼]                                 │ │
│  │  Subreddit: [All ▼]  Priority: [All ▼]                  │ │
│  │  Category: [All ▼] [Competitor] [High Intent] [General] │ │
│  │  Date: [Today ▼] [Yesterday] [This Week] [This Month]   │ │
│  │        [Custom Range: _____ to _____]                    │ │
│  │  Sort by: [Priority ▼] [Newest] [Most Comments]         │ │
│  └──────────────────────────────────────────────────────────┘│
│                                                               │
│  ┌─── NEW ALERTS (3) ─────────────────────────────────────┐ │
│  │                                                           ││
│  │  ┌─────────────────────────────────────────────────┐     ││
│  │  │ 🔴 HIGH · r/saas · 3 min ago                     │     ││
│  │  │ "Looking for alternatives to [Competitor]"       │     ││
│  │  │ Relevance: 0.92 · Competitor mention             │     ││
│  │  │ 12 upvotes · 8 comments · Rising fast            │     ││
│  │  │ [Analyze Thread] [Draft Response] [View on Reddit]│    ││
│  │  └─────────────────────────────────────────────────┘     ││
│  │                                                           ││
│  │  ┌─────────────────────────────────────────────────┐     ││
│  │  │ 🟡 MEDIUM · r/startups · 12 min ago              │     ││
│  │  │ "Best tools for early-stage customer discovery"  │     ││
│  │  │ Relevance: 0.74 · High intent                    │     ││
│  │  │ 5 upvotes · 3 comments                           │     ││
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
│  │  [+ Add subreddit]  (3/15 slots used)                     ││
│  └───────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────┘
```

**Alert seen tracking:** An alert transitions from "New" to "Seen" when it is visible on the user's dashboard viewport (use intersection observer on the frontend). Update `is_seen=true` and `seen_at=NOW()` via API call.

**Empty states:**
- No alerts yet: "Monitoring is active. We're scanning your subreddits every 15 minutes. You'll see relevant posts here as we find them."
- No subreddits: Show onboarding wizard CTA
- Scan paused (API error): "Alert scanning is temporarily paused. We're retrying automatically."

**Subreddit goes private:** Shown in the monitored subreddits section with a 🔒 icon and "Paused" status. Scanning pauses automatically. If the subreddit becomes public again, scanning resumes. User can remove it anytime.

### 5.3 Thread Analysis View (Chat Interface)

**Trigger:** User clicks "Analyze Thread" on an alert, OR manually enters a Reddit URL.

**Full thread display:** The platform fetches and displays the complete thread (post + all comments) so users can read everything without leaving the platform. Uses Reddit comments API (`GET /comments/{article_id}.json`). Comments displayed in threaded/nested format matching Reddit's layout.

**Initial analysis displayed as first chat message:**
```
┌──────────────────────────────────────────────────────────────┐
│  Thread Analysis — Chat                                       │
│  r/saas · Posted 2 hours ago by u/founder123                 │
│  "Looking for alternatives to [Competitor] - too expensive"  │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌─ FULL THREAD ──────────────────────────────────────────┐ │
│  │  [Original post content displayed here]                  │ │
│  │                                                          │ │
│  │  └─ u/user1: "I switched to X and it's much better"     │ │
│  │     └─ u/user2: "How's their pricing?"                   │ │
│  │  └─ u/user3: "The real issue is the lack of..."          │ │
│  │  └─ u/user4: "Looking for the same thing..."             │ │
│  │  [Show all 23 comments]                                  │ │
│  └──────────────────────────────────────────────────────────┘│
│                                                               │
│  ┌─ AI ANALYSIS ──────────────────────────────────────────┐ │
│  │  📝 SUMMARY                                              │ │
│  │  The author is frustrated with [Competitor]'s pricing    │ │
│  │  after a recent 40% price increase...                    │ │
│  │                                                          │ │
│  │  😣 PAIN POINTS                                          │ │
│  │  • Price increase making current tool unaffordable       │ │
│  │  • Lack of real-time alerting in current tool            │ │
│  │  • Too much noise in alerts — want better filtering      │ │
│  │                                                          │ │
│  │  💡 KEY INSIGHTS                                          │ │
│  │  • 3 commenters mention needing "instant alerts"         │ │
│  │  • 2 users specifically ask about thread analysis        │ │
│  │                                                          │ │
│  │  🎯 BUYING INTENT SIGNALS                                │ │
│  │  • u/user4: "Looking for the same thing, budget ~$50/mo" │ │
│  │  • u/user1: "I switched to X" — active solution seeker  │ │
│  │                                                          │ │
│  │  🏢 COMPETITIVE LANDSCAPE                                │ │
│  │  • [Competitor A]: mentioned 3x, sentiment negative      │ │
│  │    (price complaints, feature gaps)                      │ │
│  │  • [Competitor B]: mentioned 1x, sentiment neutral       │ │
│  │  • Users wish: better pricing, real-time features        │ │
│  │                                                          │ │
│  │  📊 SENTIMENT: Mixed (leaning negative toward incumbents)│ │
│  │  🏷 COMMENTS ANALYZED: 23 of 23 (complete)               │ │
│  └──────────────────────────────────────────────────────────┘│
│                                                               │
│  ┌──────────────────────────────────────────────────────────┐│
│  │  💬 Ask a follow-up question about this thread...         ││
│  │  ┌──────────────────────────────────────────────────┐    ││
│  │  │ What are the top 3 opportunities for us here?    │    ││
│  │  └──────────────────────────────────────────────────┘    ││
│  │  [Send]                                                   ││
│  └──────────────────────────────────────────────────────────┘│
│                                                               │
│  [Draft a Response] [View on Reddit]                         │
└──────────────────────────────────────────────────────────────┘
```

**Chat functionality:** After the initial analysis, users can ask follow-up questions about the thread in a chat interface (LLM-first text interface). The thread content + analysis serve as context. Examples:
- "What specific features are users asking for?"
- "Which commenter seems most likely to be a potential customer?"
- "Summarize what u/user3 is saying across their comments"
- "What's the competitive angle I should focus on?"

Chat messages stored in `thread_chat_messages` table. Thread content + previous messages included as context for each new message.

**Manual URL input:** Any page in the app should have a way to paste a Reddit thread URL for ad-hoc analysis (even threads not in monitored subreddits).

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

**Key changes from v1.0:**
- **Per-draft [Regenerate]** — regenerates only that specific draft, not the whole page
- **[Edit] includes write-your-own** — clicking Edit opens the draft text as editable. User can modify or replace entirely. No separate "Write My Own" CTA needed.
- **No "Rule check: PASS" display** — subreddit rules are shown at the top for context. Rule checking happens internally but the pass/fail badge is not shown (redundant noise).
- **Comment-level targeting** — user can select whether they're replying to the original post or a specific comment in the thread

**Important:** No auto-posting. User copies the text and posts manually on Reddit. The "Approve" button is for internal tracking (marking that the user used this draft).

### 5.5 Settings Page (Tabbed)

```
┌──────────────────────────────────────────────────────────────┐
│  Settings                                                     │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  [Business Profile] [Notifications] [Usage & Billing]        │
│  ─────────────────────────────────────────────────────────── │
│                                                               │
│  ┌─── BUSINESS PROFILE TAB ──────────────────────────────┐  │
│  │                                                        │  │
│  │  Current Business: [Example Inc ▼]                     │  │
│  │  (MVP: 1 business only. Multi-business coming soon.)   │  │
│  │                                                        │  │
│  │  Business Name: [_____________]                        │  │
│  │  Website: [_____________]                              │  │
│  │  Description: [_____________] (editable)               │  │
│  │  Target Audience: [_____________]                       │  │
│  │  Brand Voice: [_____________]                          │  │
│  │                                                        │  │
│  │  ICP Description: [_____________] (add/delete)         │  │
│  │  Keywords: [keyword1 ✕] [keyword2 ✕] [+ add]          │  │
│  │  Competitors: [Comp A ✕] [Comp B ✕] [+ add]           │  │
│  │  Subreddits: [r/saas ✕ Strong●] [r/startups ✕ Med●]   │  │
│  │              [+ add] (5/15 used)                       │  │
│  │              (hover subreddit tag for health details)   │  │
│  │                                                        │  │
│  │  [Save Changes]                                        │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                               │
│  ┌─── NOTIFICATIONS TAB ─────────────────────────────────┐  │
│  │                                                        │  │
│  │  Email alerts: [On ▼]                                  │  │
│  │  Alert threshold: [High priority only ▼]               │  │
│  │    Options: All alerts / High + Medium / High only     │  │
│  │                                                        │  │
│  │  [Save Changes]                                        │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                               │
│  ┌─── USAGE & BILLING TAB ───────────────────────────────┐  │
│  │                                                        │  │
│  │  Plan: Free tier                                       │  │
│  │  Subreddits: 5/15 used                                 │  │
│  │  Alerts this month: 147                                │  │
│  │  Thread analyses this month: 23                        │  │
│  │  Drafts generated this month: 12                       │  │
│  │                                                        │  │
│  │  [Upgrade to Pro →]                                    │  │
│  │  [Delete Account]                                      │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

**Settings structure:** Tabbed navigation with 3 tabs. Business Profile tab accommodates future multi-business support via a business selector dropdown at the top (shows only one business in MVP but the UI pattern is ready for expansion).

**Subreddit health on hover:** Health assessment details shown only when user hovers over a subreddit name/tag — not expanded by default.

**Add/Delete for dynamic fields:** ICP, Keywords, Competitors, and Subreddits all support manual add and delete operations. Description and Brand Voice are free-text editable fields.

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
  - `GET /comments/{article_id}.json` — fetch full thread with comments (for thread analysis + in-platform reading)

**Rate limit management:**
- Track requests per minute globally
- Scanner: 1 request per subreddit per 15-min scan cycle
- Thread viewing: 1 request per thread opened by user (on-demand, not per-cycle)
- Budget: ~1500 subreddits max at 15-min cycles (scanner only). Thread views are additional but user-driven and infrequent.
- On 429 response: exponential backoff (1s, 2s, 4s, 8s, max 60s)

### 6.2 Claude API (Anthropic) — Relevance, Analysis, Intelligence

**Models used:**
- **Claude Haiku** — relevance scoring (Pass 2), subreddit health assessment, ICP matching
- **Claude Sonnet** — thread analysis, thread chat follow-ups, onboarding website analysis

**Usage per scan cycle (per user):**
- Pre-filter (Pass 1): zero LLM calls — keyword/regex only
- Relevance scoring (Pass 2): ~5-25 Haiku calls (only posts passing keyword filter)
- Thread analysis: ~1-5 Sonnet calls (on-demand, user-triggered)
- Thread chat: ~1-10 Sonnet calls (on-demand, per user question)
- Onboarding: ~3-5 Sonnet calls (one-time)

### 6.3 OpenAI API (ChatGPT) — Comment Drafting

**Model used:** GPT-4o or GPT-4o-mini for comment drafting
- Comment drafts: 2-3 calls per draft request (one per tone variant)
- System prompt includes: subreddit rules, brand voice, thread context, parent comment context

### 6.4 Email Service (Amazon SES)

**Why SES over Resend:** Resend free tier caps at 100 emails/day (3,000/month). For an alerting product that needs to email users the moment a high-priority post is found, this is too restrictive even at MVP. Amazon SES costs $0.10/1000 emails with no meaningful daily cap.

- High priority alerts → email sent immediately
- Medium priority alerts → in-app only (email optional based on user preference)
- Low priority alerts → in-app only, no email
- Rate limit: max 50 alert emails/day per user (prevent inbox flooding)

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

  PASS 1 — KEYWORD PRE-FILTER (zero LLM cost):
  1. Fetch new posts from Reddit API (since last_seen_post_id)
  2. FOR each new post:
     a. Check dedup (already in alerts table by reddit_post_id?)
     b. Keyword match: check post title + body against user's keywords
        - Exact match and fuzzy match (stemming, synonyms)
     c. Intent signal regex: check for phrases like:
        "looking for", "recommend", "alternative to", "help me find",
        "anyone use", "best tool for", "need a", "budget $"
     d. Competitor name match: check against competitor list
     e. IF keyword_match OR intent_match OR competitor_match → pass to Pass 2
     f. ELSE → discard (not relevant)

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
        - relevance_reasoning (one-line explanation)
        - category ('general' | 'competitor_mention' | 'high_intent')
     c. Calculate priority_score (weighted formula):
        - relevance (40%): from LLM score
        - recency (25%): 1.0 if <15min, 0.7 if <1hr, 0.4 if <6hr, 0.1 if >6hr
        - engagement_velocity (15%): (upvotes + comments) / minutes_since_posted
        - intent_signals (10%): 1.0 if strong intent phrases, 0.5 if weak, 0.0 if none
        - competitor_mention (10%): 1.0 if mentioned, 0.0 if not
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

| Scenario | Relevance | Recency | Velocity | Intent | Competitor | Total | Level |
|----------|-----------|---------|----------|--------|------------|-------|-------|
| "Looking for alternative to [Competitor], budget $50/mo" posted 5 min ago, 3 upvotes | 0.95 | 1.0 | 0.8 | 1.0 | 1.0 | **0.95** | HIGH |
| "Best tools for customer discovery?" posted 45 min ago, 5 comments | 0.75 | 0.7 | 0.6 | 0.5 | 0.0 | **0.64** | MEDIUM |
| "General discussion about marketing strategies" posted 3 hrs ago, 2 comments | 0.40 | 0.4 | 0.2 | 0.0 | 0.0 | **0.30** | LOW |
| "Check out my new cat photo" in r/saas, posted 1 hr ago | 0.05 | 0.7 | 0.1 | 0.0 | 0.0 | **0.14** | FILTERED |

**Error handling:**
- Reddit API timeout → skip subreddit, retry next cycle
- Reddit API 429 → backoff, reduce scan frequency temporarily
- Reddit API 403 (subreddit private/banned) → mark subreddit status='private' or 'banned', show 🔒 on dashboard
- LLM timeout → use keyword-only scoring from Pass 1, flag post as "unscored"
- LLM malformed response → fallback to keyword matching, log error for investigation
- LLM API down → switch to failover model (see §6.5)

### 7.2 Subreddit Health Refresh (every 60 days)

```
FOR each entry in subreddit_health_cache where last_refreshed > 60 days ago:
  1. Fetch /r/{subreddit}/about.json — check if still exists/public
  2. If gone/private → update status, flag any users monitoring it
  3. If active → re-run health assessment parameters
  4. Update all fields in subreddit_health_cache
  5. Update last_refreshed timestamp
```

---

## 8. Security Considerations

| Threat | Mitigation |
|--------|-----------|
| User A accesses User B's data | All DB queries scoped by `business_id`. Enforce at ORM/query layer. |
| XSS from Reddit content in dashboard | Sanitize all Reddit-sourced HTML/markdown before rendering. Use DOMPurify or equivalent. |
| LLM prompt injection via Reddit posts | Reddit content passed as user content in LLM calls, never as system prompt. |
| Reddit OAuth credential exposure | Store in environment variables. Never client-side. |
| Abuse: user creates too many subreddits | Enforce per-user limit: max 15 subreddits. Application-layer check. |
| Email spam via alert system | Rate limit emails per user (max 50/day). High priority only by default. |
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
| Subreddit doesn't exist (manual add) | "r/example does not exist. Check the spelling." | Inline error on add attempt |
| Max subreddits reached | "Maximum 15 subreddits allowed. Remove one to add another." | Prevent add, show count |

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
| `draft.requested` | `{alert_id, reply_target: 'post'|'comment'}` | Draft generation triggered |
| `draft.copied` | `{draft_id, tone}` | User copies a draft |
| `draft.edited` | `{draft_id, edit_length}` | User edits a draft |
| `draft.regenerated` | `{draft_id, tone}` | User regenerates a specific draft |
| `draft.approved` | `{draft_id, tone}` | User approves a draft |
| `settings.updated` | `{section, fields_changed}` | Settings saved |
| `subreddit.added` | `{subreddit_name, source: 'manual'|'suggested'}` | Subreddit added |
| `subreddit.removed` | `{subreddit_name}` | Subreddit removed |
| `filter.changed` | `{filter_type, value}` | Dashboard filter changed |
| `page.viewed` | `{page, duration_ms}` | Page navigation |

**Backend Events (source: 'backend'):**
| Event Type | Payload | Trigger |
|-----------|---------|---------|
| `scan.cycle_started` | `{subreddits_count, cycle_id}` | Cron job starts |
| `scan.cycle_completed` | `{duration_ms, posts_fetched, posts_filtered_pass1, posts_scored_pass2, alerts_created, errors}` | Cron job finishes |
| `scan.subreddit_scanned` | `{subreddit, posts_found, posts_relevant, duration_ms}` | Single subreddit scanned |
| `scan.subreddit_error` | `{subreddit, error_type, error_message}` | Subreddit scan failed |
| `relevance.scored` | `{post_id, score, reasoning, model, duration_ms, pass1_match_type}` | LLM relevance score computed |
| `relevance.fallback_used` | `{post_id, primary_model, fallback_model, reason}` | Primary LLM failed, fallback used |
| `priority.calculated` | `{alert_id, factors: {relevance, recency, velocity, intent, competitor}, total, level}` | Priority score computed |
| `thread.analyzed` | `{thread_id, comments_count, model, duration_ms, tokens_used}` | Thread analysis completed |
| `thread.chat_response` | `{thread_analysis_id, model, duration_ms, tokens_used}` | Chat follow-up answered |
| `draft.generated` | `{alert_id, tone, model, duration_ms, tokens_used}` | Comment draft generated |
| `email.sent` | `{alert_id, user_id, priority_level}` | Alert email sent |
| `email.failed` | `{alert_id, user_id, error, retry_count}` | Alert email failed |
| `email.retry` | `{alert_id, attempt_number}` | Email retry attempted |
| `health.assessed` | `{subreddit, overall_tag, source: 'cache_hit'|'fresh'}` | Subreddit health assessed |
| `health.cache_refreshed` | `{subreddits_refreshed, duration_ms}` | Batch health refresh |
| `llm.error` | `{provider, model, error_type, duration_ms}` | LLM API call failed |
| `llm.failover` | `{function, from_provider, to_provider}` | Failover triggered |
| `reddit_api.error` | `{endpoint, status_code, subreddit}` | Reddit API error |
| `reddit_api.rate_limited` | `{requests_used, limit}` | Rate limit approached/hit |

**System Events (source: 'system'):**
| Event Type | Payload | Trigger |
|-----------|---------|---------|
| `subreddit.went_private` | `{subreddit, affected_users_count}` | Subreddit became inaccessible |
| `subreddit.came_back` | `{subreddit, was_private_days}` | Private subreddit became public |
| `health_refresh.started` | `{subreddits_count}` | 60-day refresh job starts |
| `health_refresh.completed` | `{refreshed, errors, duration_ms}` | Refresh job finishes |

### 10.2 Health Indicators (dashboard for internal monitoring)

All queryable directly from Supabase:

| Metric | Query approach | Alert threshold |
|--------|---------------|-----------------|
| Scan cycle duration | `AVG(duration_ms) WHERE event_type = 'scan.cycle_completed'` | >14 min (approaching 15-min window) |
| LLM error rate | `COUNT(llm.error) / COUNT(relevance.scored) per hour` | >5% |
| Email delivery rate | `COUNT(email.sent) / (COUNT(email.sent) + COUNT(email.failed))` | <95% |
| Reddit API error rate | `COUNT(reddit_api.error) per hour` | >10/hour |
| Failover frequency | `COUNT(llm.failover) per hour` | >5/hour (indicates primary instability) |
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
4. **LLM prompt templates:** Exact prompts for relevance scoring (Pass 1 regex patterns + Pass 2 Haiku prompt), health assessment, thread analysis, thread chat, comment drafting
5. **Data retention policy:** How long to keep alerts, analyses, and event_logs
6. **Pricing tiers:** What features are free vs. paid, what are the limits
7. **Thread comment pagination:** Fetch all comments at once vs. paginate for large threads (>100 comments)
8. **Frontend event batching implementation:** SDK choice or custom utility for event tracking
