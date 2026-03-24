# Product Specification: Reddit Lead Intelligence Platform

**Version:** 1.0 (MVP)
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
│  Landing Page ←→ Dashboard ←→ Onboarding ←→ Thread Analysis  │
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
│     │    PostgreSQL    │                                      │
│     │  (Neon/Supabase) │                                      │
│     └─────────────────┘                                      │
└──────────────────────────────────────────────────────────────┘
                       │
            ┌──────────┴──────────┐
            ▼                     ▼
┌────────────────────┐  ┌────────────────────┐
│  CRON WORKER:      │
│  Reddit Scanner    │
│  (every 15 min)    │
│                    │
│  → Reddit API      │
│  → Claude API      │
│  → DB writes       │
│  → Email Service   │
└────────────────────┘
         │
         ▼
┌────────────────┐     ┌──────────────────┐
│  Reddit API    │     │  Email Service   │
│  (OAuth2)      │     │  (Resend)        │
│  100 req/min   │     │                  │
└────────────────┘     └──────────────────┘
         │
         ▼
┌────────────────┐
│  Claude API    │
│  (Haiku +      │
│   Sonnet)      │
└────────────────┘
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
description     TEXT        (AI-generated or manually entered)
icp_description TEXT        (ideal customer profile description)
brand_voice     TEXT        (tone, prohibited phrases, example language)
keywords        JSONB       (array of monitoring keywords)
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

### monitored_subreddits
```
id              UUID        PRIMARY KEY
business_id     UUID        FK → businesses.id
subreddit_name  VARCHAR     NOT NULL (e.g., 'saas', 'startups')
relevance_keywords JSONB    (keywords specific to this subreddit)
health_tag      ENUM        ('strong', 'medium', 'weak')
health_details  JSONB       (per-parameter breakdown with explanations)
source          ENUM        ('auto_suggested', 'manual') DEFAULT 'manual'
is_active       BOOLEAN     DEFAULT true
last_scanned_at TIMESTAMP
last_seen_post_id VARCHAR   (for deduplication across scans)
created_at      TIMESTAMP   DEFAULT NOW()
updated_at      TIMESTAMP   DEFAULT NOW()

UNIQUE(business_id, subreddit_name)
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
relevance_score FLOAT       (0.0 - 1.0)
priority_score  FLOAT       (composite: relevance + recency + velocity + intent + competitor)
priority_factors JSONB      (breakdown of each factor's contribution)
category        ENUM        ('general', 'competitor_mention', 'high_intent') DEFAULT 'general'
email_status    ENUM        ('pending', 'sent', 'failed', 'skipped') DEFAULT 'pending'
email_sent_at   TIMESTAMP
is_read         BOOLEAN     DEFAULT false
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
sentiment       ENUM        ('positive', 'negative', 'neutral', 'mixed')
key_insights    JSONB       (array of key insights)
comment_count   INTEGER
analysis_status ENUM        ('pending', 'complete', 'partial', 'failed') DEFAULT 'pending'
created_at      TIMESTAMP   DEFAULT NOW()
```

### comment_drafts
```
id              UUID        PRIMARY KEY
alert_id        UUID        FK → alerts.id
business_id     UUID        FK → businesses.id
draft_text      TEXT        NOT NULL
tone            VARCHAR     (e.g., 'helpful', 'conversational', 'technical')
rule_check      JSONB       (subreddit rules checked, any flags)
approval_state  ENUM        ('pending', 'approved', 'rejected') DEFAULT 'pending'
created_at      TIMESTAMP   DEFAULT NOW()
```

---

## 5. Feature Specifications

### 5.1 Onboarding Wizard

**Trigger:** First login or when user has no business profile.

**Flow:**
```
Step 1: Website URL
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

Step 2: Business Profile (AI-populated, all editable)
  ┌─────────────────────────────────────┐
  │  Business Name: [Example Inc     ]  │
  │  Description:   [AI-generated... ]  │
  │  Target Audience: [AI-generated..]  │
  │  Keywords:      [keyword1] [+add ]  │
  │                                     │
  │  [Save & Continue →]                │
  └─────────────────────────────────────┘
         │
         ▼

Step 3: Competitors (AI-suggested + manual)
  ┌─────────────────────────────────────┐
  │  We found these competitors:        │
  │  ☑ Competitor A (auto-suggested)    │
  │  ☑ Competitor B (auto-suggested)    │
  │  ☐ Competitor C (auto-suggested)    │
  │  [+ Add competitor manually]        │
  │                                     │
  │  [Save & Continue →]                │
  └─────────────────────────────────────┘
         │
         ▼

Step 4: Subreddit Selection (AI-suggested with health tags)
  ┌─────────────────────────────────────┐
  │  Recommended subreddits:            │
  │                                     │
  │  r/saas          [Strong ●]         │
  │    Activity: Strong — 45 posts/day  │
  │    ICP Match: Strong — high overlap │
  │    Moderation: Medium — allows      │
  │      helpful mentions, bans links   │
  │                                     │
  │  r/startups      [Medium ●]         │
  │    Activity: Strong — 30 posts/day  │
  │    ICP Match: Medium — some overlap │
  │    Moderation: Strong — strict      │
  │      self-promo rules               │
  │                                     │
  │  [+ Add subreddit manually]         │
  │  ┌─────────────────────────────┐    │
  │  │ r/customsubreddit           │    │
  │  └─────────────────────────────┘    │
  │  → Health check runs automatically  │
  │                                     │
  │  [Start Monitoring →]               │
  └─────────────────────────────────────┘
```

**Edge cases:**
- Website unreachable → show error, offer manual entry
- Website has minimal content → generate partial profile, flag gaps for manual input
- No subreddits match → show "No matches found, please enter subreddits manually"
- User enters non-existent subreddit → Reddit API returns 404 → show "Subreddit not found"

**Health Assessment Parameters:**

| Parameter | Data Source | Strong | Medium | Weak |
|-----------|-----------|--------|--------|------|
| Activity Level | Reddit API: posts/day, comments/post | >20 posts/day, >5 comments/post avg | 5-20 posts/day, 2-5 comments/post | <5 posts/day or <2 comments/post |
| Engagement Quality | Reddit API: upvote ratios, discussion depth | >70% posts get 3+ comments | 40-70% get 3+ comments | <40% get 3+ comments |
| Moderation Strictness | Reddit API: /about/rules.json | <5 rules, no automod mention | 5-10 rules, moderate policies | >10 rules, strict automod, frequent removals |
| Commercial Tolerance | Rules analysis via LLM | No anti-promo rules, product mentions welcome | Allows helpful mentions, bans direct promotion | Explicit anti-commercial rules, bans product links |
| ICP Relevance | LLM scoring against ICP description | >80% topic overlap with ICP | 50-80% overlap | <50% overlap |
| Conversation Recency | Reddit API: relevant posts in 7d vs 30d | Increasing trend, >5 relevant/week | Stable, 2-5 relevant/week | Declining or <2 relevant/week |

### 5.2 Dashboard

**Layout:**
```
┌──────────────────────────────────────────────────────────────┐
│  [Logo]  Dashboard | Threads | Drafts | Settings    [User ▼] │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌─── PRIORITY ALERTS ──────────────────────────────────────┐│
│  │                                                           ││
│  │  Filter: [All] [Competitor Mentions] [High Intent]        ││
│  │                                                           ││
│  │  ┌─────────────────────────────────────────────────┐     ││
│  │  │ 🔴 HIGH PRIORITY · r/saas · 3 min ago           │     ││
│  │  │ "Looking for alternatives to [Competitor]"       │     ││
│  │  │ Score: High relevance · Competitor mention       │     ││
│  │  │ 12 upvotes · 8 comments · Rising fast            │     ││
│  │  │ [Analyze Thread] [Draft Response] [View on Reddit]│    ││
│  │  └─────────────────────────────────────────────────┘     ││
│  │                                                           ││
│  │  ┌─────────────────────────────────────────────────┐     ││
│  │  │ 🟡 MEDIUM · r/startups · 12 min ago              │     ││
│  │  │ "Best tools for early-stage customer discovery"  │     ││
│  │  │ Score: Good relevance · High intent               │     ││
│  │  │ 5 upvotes · 3 comments                           │     ││
│  │  │ [Analyze Thread] [Draft Response] [View on Reddit]│    ││
│  │  └─────────────────────────────────────────────────┘     ││
│  │                                                           ││
│  │  [Load more alerts...]                                    ││
│  └───────────────────────────────────────────────────────────┘│
│                                                               │
│  ┌─── MONITORED SUBREDDITS ─────────────────────────────────┐│
│  │  r/saas [Strong ●] · Last scan: 2 min ago · 12 alerts    ││
│  │  r/startups [Medium ●] · Last scan: 2 min ago · 5 alerts ││
│  │  r/indiehackers [Strong ●] · Last scan: 2 min ago · 8    ││
│  │  [+ Add subreddit]                                        ││
│  └───────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────┘
```

**Empty states:**
- No alerts yet: "Monitoring is active. We're scanning your subreddits every 15 minutes. You'll see relevant posts here as we find them."
- No subreddits: Show onboarding wizard CTA
- Scan paused (API error): "Alert scanning is temporarily paused. We're retrying automatically."

### 5.3 Thread Analysis View

**Trigger:** User clicks "Analyze Thread" on an alert, OR manually enters a Reddit URL.

**Output:**
```
┌──────────────────────────────────────────────────────────────┐
│  Thread Analysis                                              │
│  r/saas · Posted 2 hours ago by u/founder123                 │
│  "Looking for alternatives to [Competitor] - too expensive"  │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  📝 SUMMARY                                                   │
│  The author is frustrated with [Competitor]'s pricing         │
│  after a recent 40% price increase. They're looking for      │
│  alternatives that offer [specific features]. Multiple        │
│  commenters are suggesting various tools...                   │
│                                                               │
│  😣 PAIN POINTS                                               │
│  • Price increase making current tool unaffordable            │
│  • Lack of real-time alerting in current tool                 │
│  • Too much noise in alerts — want better filtering           │
│                                                               │
│  💡 KEY INSIGHTS                                               │
│  • 3 commenters mention needing "instant alerts"              │
│  • Sentiment: 70% negative toward [Competitor]                │
│  • 2 users specifically ask about thread analysis features    │
│                                                               │
│  📊 SENTIMENT: Mixed (leaning negative toward incumbents)     │
│                                                               │
│  🏷 COMMENTS ANALYZED: 23 of 23 (complete)                    │
│                                                               │
│  [Draft a Response] [Re-analyze] [View on Reddit]            │
└──────────────────────────────────────────────────────────────┘
```

**Manual URL input:** Any page in the app should have a way to paste a Reddit thread URL for ad-hoc analysis (even threads not in monitored subreddits).

### 5.4 Comment Drafting View

**Trigger:** User clicks "Draft Response" on an alert or thread analysis.

**Output:**
```
┌──────────────────────────────────────────────────────────────┐
│  Draft Responses for: "Looking for alternatives to..."       │
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
│  │ ✅ Rule check: PASS                                    │  │
│  │ [Copy] [Edit] [Approve]                                │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                               │
│  ┌─ Draft 2: Technical & Detailed ───────────────────────┐  │
│  │ "Former [Competitor] user here. The main things to     │  │
│  │ look at when evaluating alternatives are: 1) alert     │  │
│  │ speed (how fast they notify you), 2) false positive    │  │
│  │ rate, 3) whether they can analyze threads..."          │  │
│  │                                                        │  │
│  │ ✅ Rule check: PASS                                    │  │
│  │ [Copy] [Edit] [Approve]                                │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                               │
│  [Regenerate Drafts] [Write My Own]                          │
└──────────────────────────────────────────────────────────────┘
```

**Important:** No auto-posting. User copies the text and posts manually on Reddit. The "Approve" button is for internal tracking (marking that the user used this draft).

### 5.5 Settings Page

```
┌──────────────────────────────────────────────────────────────┐
│  Settings                                                     │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  BUSINESS PROFILE                                            │
│  Business Name: [_____________]                              │
│  Website: [_____________]                                    │
│  Description: [_____________]                                │
│  Target Audience: [_____________]                             │
│  Brand Voice: [_____________]                                │
│  Keywords: [keyword1] [keyword2] [+ add]                     │
│                                                               │
│  COMPETITORS                                                  │
│  • Competitor A [✕]                                          │
│  • Competitor B [✕]                                          │
│  [+ Add competitor]                                          │
│                                                               │
│  NOTIFICATIONS                                                │
│  Email alerts: [On ▼]                                        │
│  Alert threshold: [High priority only ▼]                     │
│                                                               │
│  ACCOUNT                                                      │
│  Plan: Free tier                                             │
│  [Upgrade to Pro →]                                          │
│  [Delete Account]                                            │
└──────────────────────────────────────────────────────────────┘
```

---

## 6. API Integrations

### 6.1 Reddit API

**Authentication:** OAuth2 (script app type for server-to-server)
- Register at https://www.reddit.com/prefs/apps
- Free tier: 100 requests/minute with OAuth
- Endpoints used:
  - `GET /r/{subreddit}/new.json` — fetch new posts (scanner)
  - `GET /r/{subreddit}/about/rules.json` — fetch subreddit rules
  - `GET /r/{subreddit}/about.json` — subreddit metadata (for health assessment)
  - `GET /comments/{article_id}.json` — fetch thread comments (for analysis)

**Rate limit management:**
- Track requests per minute globally
- 1 request per subreddit per 15-min scan cycle
- Budget: 1500 subreddits max at 15-min cycles
- On 429 response: exponential backoff (1s, 2s, 4s, 8s, max 60s)

### 6.2 Claude API (Anthropic)

**Models used:**
- **Claude Haiku** — relevance scoring, subreddit health assessment (fast, cheap)
- **Claude Sonnet** — thread analysis, comment drafting, onboarding website analysis (higher quality)

**Usage per scan cycle (per user):**
- Relevance scoring: ~10-50 Haiku calls (one per new post found)
- Thread analysis: ~1-5 Sonnet calls (on-demand)
- Comment drafting: ~1-3 Sonnet calls (on-demand)
- Onboarding: ~3-5 Sonnet calls (one-time)

### 6.3 Email Service (Resend recommended)

- Alert emails: triggered per high-priority alert
- Rate limit: sensible per-user cap (e.g., max 20 alert emails/day)

---

## 7. Background Workers (Cron Jobs)

### 7.1 Reddit Scanner (every 15 minutes)

```
FOR each active monitored_subreddit:
  1. Fetch new posts from Reddit API (since last_seen_post_id)
  2. FOR each new post:
     a. Check dedup (already in alerts table?)
     b. Score relevance via LLM (Haiku)
     c. Calculate priority score:
        - relevance (from LLM)
        - recency (minutes since posted)
        - engagement_velocity (upvotes + comments relative to age)
        - intent_signals (regex/LLM check for buying signals)
        - competitor_mention (check against competitor list)
     d. IF priority >= threshold:
        - Insert into alerts table
        - Queue email notification (if enabled)
  3. Update last_scanned_at and last_seen_post_id
```

**Error handling:**
- Reddit API timeout → skip subreddit, retry next cycle
- Reddit API 429 → backoff, reduce scan frequency temporarily
- Reddit API 403 (subreddit private/banned) → mark subreddit inactive, notify user
- LLM timeout → skip scoring, still store post as "unscored" alert
- LLM malformed response → fallback to keyword matching

---

## 8. Security Considerations

| Threat | Mitigation |
|--------|-----------|
| User A accesses User B's data | All DB queries scoped by `business_id`. Enforce at ORM/query layer. |
| XSS from Reddit content in dashboard | Sanitize all Reddit-sourced HTML/markdown before rendering. Use DOMPurify or equivalent. |
| LLM prompt injection via Reddit posts | Reddit content passed as user content in LLM calls, never as system prompt. |
| Reddit OAuth credential exposure | Store in environment variables. Never client-side. |
| Abuse: user creates 100 subreddits | Enforce per-user limit (e.g., max 20 subreddits on free tier). |
| Email spam via alert system | Rate limit emails per user (max 20/day on free tier). |
| Rate limit exhaustion by single user | Per-user subreddit caps ensure fair distribution of API budget. |

---

## 9. Error States & User-Facing Messages

| Error | User sees | Behavior |
|-------|-----------|----------|
| Reddit API down | "Alert scanning is temporarily paused. Retrying automatically." | Banner at top of dashboard |
| LLM API failure | Thread shows raw content + "Analysis pending — retrying..." | Auto-retry, no user action needed |
| Email delivery failed | "Email delivery failed" badge on alert | Visible in dashboard, manual retry option |
| Subreddit goes private | "r/example is no longer accessible. [Remove] [Keep monitoring]" | Pause scanning, notify user |
| Website unreachable (onboarding) | "We couldn't reach your website. Please enter your business details manually." | Fallback to manual form |
| No relevant posts found | "No relevant posts in the last 24 hours. We're still monitoring." | Normal state — not an error |
| Post deleted since alert | "This post may have been deleted or removed." | Show cached content with warning |

---

## 10. Metrics & Observability

**Day 1 metrics (structured JSON logs):**
- Scan cycle: subreddits scanned, posts found, posts scored, alerts generated, errors
- LLM latency: per-call duration for scoring and analysis
- Alert delivery: emails sent, bounced, failed
- User activity: logins, thread analyses triggered, drafts generated
- API budget: Reddit requests used / available

**Health indicators:**
- Scan cycle completing within 15-min window
- LLM error rate < 5%
- Email delivery rate > 95%
- Alert relevance feedback (future: user marks alert as relevant/irrelevant)

---

## 11. Landing Page Requirements

**Hero section:**
- Headline emphasizing speed-to-relevance: "Be first to every Reddit conversation that matters"
- Sub-headline: real-time alerts + AI thread analysis
- CTA: "Start monitoring free" or "Get started"

**Feature sections:**
1. Smart Alerts — priority-scored, not just keyword matches
2. Thread Intelligence — AI summaries replacing the ChatGPT copy-paste workflow
3. Competitor Tracking — know when competitors are being discussed
4. Comment Drafting — subreddit-aware responses that don't get you banned

**GummySearch alternative section (lower on page):**
- "Switching from GummySearch?" header
- Feature comparison showing what this tool offers vs. what GummySearch had
- Targets organic SEO traffic for "GummySearch alternative"

**Social proof section:** (once available)
- Testimonials, user count, subreddits monitored

---

## 12. Open Decisions for Engineering

These decisions should be made during `/plan-eng-review` before implementation begins:

1. **Database:** Neon vs. Supabase Postgres vs. Railway Postgres
2. **Auth:** Clerk vs. Supabase Auth vs. NextAuth
3. **Cron/Worker:** Inngest vs. Railway cron vs. custom
4. **Email:** Resend vs. Postmark vs. SendGrid
5. **Hosting:** Railway (everything) vs. Vercel (frontend) + Railway (workers)
6. **LLM prompt templates:** Exact prompts for relevance scoring, health assessment, thread analysis, comment drafting
7. **Data retention policy:** How long to keep alerts and analyses
8. **Pricing tiers:** What features are free vs. paid, what are the limits
