# Reddit Lead Intelligence Platform

## Project Overview
A dark-mode SaaS platform that monitors Reddit for relevant posts, provides AI-powered thread analysis, and helps users draft contextual responses. Built for GTM teams, indie hackers, and marketing agencies. Core differentiator: speed-to-relevance alerting + thread intelligence (not comment drafting).

## Key Documents
- **PRODUCT-SPEC.md** — Complete product specification: features, user flows, data models, API integrations, edge cases
- **TECH-SPEC.md** — Complete technical blueprint: stack, architecture, project structure, database schema, worker design, deployment, build order
- **DESIGN-SYSTEM.md** — Visual design system: colors, typography, spacing, components, anti-patterns
- **DESIGN.md** — Product strategy: problem statement, demand evidence, target users, premises, feature definitions
- **PROGRESS.md** — Development progress tracker: what's done, what's remaining, phase-by-phase status. **Read this first when resuming work.**

## Technology Stack
- **Frontend:** Next.js 15 (App Router) on Vercel
- **Backend:** Next.js API routes (same Vercel deployment)
- **Worker:** Long-running Node.js process on Railway (always-on)
- **Database:** Supabase (PostgreSQL + Auth + RLS + pgvector)
- **Auth:** Supabase Auth (native RLS, no Clerk)
- **ML:** all-MiniLM-L6-v2 via @huggingface/transformers (loaded in Railway worker)
- **LLM:** Claude Haiku (scoring) + Claude Sonnet (analysis) + GPT-4o (drafting)
- **Email:** Amazon SES
- **Styling:** Inline styles using DESIGN-SYSTEM.md CSS custom properties (Tailwind 4 @theme vars don't resolve with utility classes)
- **Testing:** Vitest + Playwright
- **Package manager:** pnpm

## Design System
Always read DESIGN-SYSTEM.md before making any visual or UI decisions.
- **Background:** #0A0A0A (true dark)
- **Accent:** #E8651A (warm burnt orange)
- **Text:** #F5F5F3 (warm off-white — never pure white)
- **Fonts:** Satoshi (display), DM Sans (body), Geist (data), JetBrains Mono (code)
- **No light mode** — dark mode only for MVP
- Do not deviate from DESIGN-SYSTEM.md without explicit user approval.
- In QA mode, flag any code that doesn't match DESIGN-SYSTEM.md.

## Architecture
```
Vercel (frontend + API) ──── Supabase (PostgreSQL + Auth + RLS + pgvector)
                                      │
Railway (worker) ─────────────────────┘
  ├── ML model (MiniLM-L6-v2, loaded once at startup)
  ├── Scanner loop (setInterval, every 15 min)
  ├── GET /health (liveness check)
  └── POST /scan-now (webhook from Vercel, shared secret)
```

## Project Structure
```
src/app/          → Next.js pages (dashboard, threads, settings, onboarding)
src/app/api/      → API routes (alerts, threads, drafts, onboarding, subreddits, events)
src/components/   → React components (ui/, alerts/, threads/, drafts/, layout/)
src/lib/          → Shared libraries (supabase/, llm/, reddit/, email/, scoring/, credits/, events/)
src/types/        → TypeScript type definitions
worker/           → Railway worker (scanner, prefilter, embeddings, health)
prompts/          → LLM prompt templates (version-controlled markdown files)
supabase/         → SQL migrations (5 migration files)
tests/            → unit/, integration/, e2e/
```

## Database
11 tables in Supabase with RLS enabled on all user-facing tables:
- `users`, `businesses`, `competitors`, `subreddit_health_cache`, `monitored_subreddits`
- `alerts`, `thread_analyses`, `thread_chat_messages`, `comment_drafts`
- `credit_balances`, `credit_transactions`, `event_logs`

RLS chain: all queries scoped via `business_id → businesses.user_id → auth.uid()`.
Worker uses service_role key (bypasses RLS). Never expose service_role to client.

## Pricing & Credits
- **Free:** 3-day trial, 3 subreddits, 25 credits (lifetime), $0.40 max cost
- **Growth:** $39/mo, 10 subreddits, 250 credits/month, 78% margin
- **Custom:** Agencies, multi-business, negotiated credits + pricing
- 1 credit ≈ 1,000 LLM tokens. Fractional (2 decimal places).
- Credits are fungible — spend on analysis, chat, or drafts in any mix
- Scanner checks plan eligibility: skip expired free trials in scan loop
- Credit deductions are server-side only (atomic DB updates)
- Credit balance always visible in top nav

## Scanner Worker
- Scans by **unique subreddit** (Reddit API fetch shared across users)
- Scores **per-user** (each user has different keywords, ICP, embedding vectors)
- **Plan check:** Only scan for Growth/Custom users + Free users with active trial
- **Pass 1:** Local semantic embeddings + keyword + regex (free, ~5ms/post)
- **Pass 2:** Claude Haiku LLM scoring (only posts passing Pass 1 threshold ≥ 0.4)
- **Priority:** 40% relevance + 30% recency + 15% velocity + 15% intent
- **Parallelization:** p-limit concurrency=10 for Haiku calls
- **Circuit breaker:** Abort at 13 min, use Pass 1 scores for remaining posts
- **Mutex:** Skip cycle if previous scan still running

## LLM Usage
| Function | Primary | Fallback |
|----------|---------|----------|
| Relevance scoring | Claude Haiku | GPT-4o-mini |
| Thread analysis | Claude Sonnet | GPT-4o |
| Thread chat | Claude Sonnet | GPT-4o |
| Comment drafting | GPT-4o | Claude Sonnet |
| Onboarding agents | Claude Sonnet | GPT-4o |

Failover: 3 consecutive failures OR >10s timeout → switch for 5 min → retry primary.
Prompts stored in `prompts/` directory as markdown templates. Load at startup, inject variables at call time.

## Post Categories (5)
| Category | Color | Intent Level |
|----------|-------|-------------|
| Pain Point | #F87171 (rose) | Early signal |
| Solution Request | #60A5FA (blue) | Highest intent |
| Competitor Dissatisfaction | #FBBF24 (amber) | High intent |
| Experience Sharing | #A78BFA (purple) | Competitive intel |
| Industry Discussion | #2DD4BF (teal) | Lowest intent |

## Testing
- **Vitest** for unit + integration tests
- **Playwright** for 5 E2E flows: onboarding, dashboard, thread analysis, drafts, settings
- Tests written alongside every feature — not deferred
- LLM eval suite: 20 sample posts for scoring accuracy + category classification

## Key Conventions
- All Reddit content sanitized via DOMPurify before rendering (XSS prevention)
- Reddit content passed as `user` role in LLM calls, never `system` (prompt injection prevention)
- API keys in environment variables only, never client-side
- Cursor-based pagination (not OFFSET) for all list endpoints
- Structured JSON logging to `event_logs` table in Supabase — no unstructured text logs
- 30-day event_log retention + monthly CSV export

## Build Order
1. Foundation (Next.js + Supabase + Auth + app shell + credits lib)
2. Onboarding (URL analysis → Agent 1 → Agent 2 → profile → trial activation + credit grant)
3. Scanner Worker (Railway + ML + Pass 1 + Pass 2 + plan eligibility check + alerts + email)
4. Dashboard (alert feed + filters + sort + New/Seen + credit badge + trial banner)
5. Thread Analysis (analysis + chat + history sidebar + credit gate/deduction)
6. Comment Drafting (GPT-4o drafts + regenerate + edit + credit gate/deduction)
7. Settings + Billing (business profile + notifications + Stripe + credit reset)
8. Polish + Testing (error states + credit edge cases + E2E + unit tests + LLM eval)

## Important Notes
- **No auto-posting to Reddit** — user copies draft text and posts manually
- **Max 10 subreddits (Growth/Custom), 3 subreddits (Free)** — concentrated monitoring for quality
- **Subreddit health refresh is manual** — run via Supabase + Claude Code every 1-2 months
- **No landing page in MVP** — deferred until core platform is validated
- **SES starts in sandbox** — submit production access request on day 1, use Resend as fallback
- **Railway must be always-on** — prevent scale-to-zero to keep ML model loaded
