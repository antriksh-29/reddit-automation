# Development Progress — Arete (Reddit Lead Intelligence Platform)

**Last updated:** 2026-03-25
**Branch:** `antriksh-29/reddit-lead-tool`
**Current Phase:** Phase 2 (Onboarding) — COMPLETE. Next: Phase 3 (Scanner Worker)

---

## Phase 1: Foundation — COMPLETE

Everything built, tested, and working end-to-end.

| Component | Files | Status |
|-----------|-------|--------|
| Next.js 15 + TypeScript + Tailwind 4 + pnpm | `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs` | Done |
| Supabase PostgreSQL (11 tables) | `supabase/migrations/001-006` | Done, migrated |
| RLS policies (business_id → auth.uid() chain) | `supabase/migrations/004` | Done |
| Atomic credit deduction function | `supabase/migrations/005` | Done |
| Auth sync trigger (auth.users → public.users) | `supabase/migrations/006` | Done |
| Supabase Auth (Google OAuth only) | `src/middleware.ts`, `src/app/api/auth/callback/` | Done |
| Login page (Google-only, "Arete" branding) | `src/app/(auth)/login/page.tsx` | Done |
| App shell (top nav + credit badge + sign out) | `src/components/layout/app-shell.tsx` | Done |
| Dashboard / Threads / Settings placeholders | `src/app/(app)/*/page.tsx` | Done |
| Credits library | `src/lib/credits/pricing.ts`, `manager.ts`, `types.ts` | Done |
| Environment variables | `.env.local` (local), `.env.local.example` (template) | Done |
| Dark theme (DESIGN-SYSTEM.md tokens) | `src/app/globals.css` | Done |

**Credentials configured in `.env.local`:**
- Supabase URL + anon key + service role key
- Anthropic API key
- Google OAuth client ID + secret (also configured in Supabase dashboard)

**Supabase dashboard settings:**
- Auth → URL Configuration → Site URL: `http://localhost:3000`
- Auth → URL Configuration → Redirect URLs: `http://localhost:3000/api/auth/callback`
- Auth → Providers → Google: enabled with client ID/secret

---

## Phase 2: Onboarding — COMPLETE

### What's Built

| Component | Files | Status |
|-----------|-------|--------|
| Step 1: Website URL analysis (LLM Agent 1) | `src/app/api/onboarding/analyze-url/route.ts` | Done |
| Step 1: Skip → manual entry (name, desc, ICP) | `src/app/onboarding/page.tsx` | Done |
| Step 2: Full profile page (single page wizard) | `src/app/onboarding/page.tsx` | Done |
| Agent 2: Subreddit + keyword discovery | `src/app/api/onboarding/discover/route.ts` | Done |
| Subreddit validation (Reddit API) | `src/app/api/subreddits/validate/route.ts` | Done |
| Onboarding completion (save to DB) | `src/app/api/onboarding/complete/route.ts` | Done |
| LLM client (Anthropic wrapper) | `src/lib/llm/anthropic.ts` | Done |
| LLM prompt templates | `prompts/onboarding-agent1.md`, `prompts/onboarding-agent2.md` | Done |
| HTML-to-text extraction (Cheerio) | `src/app/api/onboarding/analyze-url/route.ts` | Done |
| Trial activation (3-day) | `src/app/api/onboarding/complete/route.ts` | Done |
| Credit grant (25 credits) | `src/app/api/onboarding/complete/route.ts` + `src/lib/credits/manager.ts` | Done |
| Credit badge (live balance) | `src/components/layout/app-shell.tsx` + `src/app/api/credits/route.ts` | Done |

### Onboarding UX Details (all implemented)
- Auto-resizing textareas for description and ICP
- Keywords: primary (AI + user) and discovery (AI only), limit 15 total
- User-added keywords always go to "primary" category
- Competitors: AI-suggested + manual, limit 10
- Subreddits: AI-suggested + manual, limit 3 (free plan), limit 10 (growth)
- Subreddit input: user types name only, `r/` prefix added automatically
- Reddit API validation on manual add with specific error messages:
  - Non-existent → "does not exist"
  - Private → "private subreddit, cannot be monitored"
  - Banned → "banned by Reddit"
  - Quarantined → "quarantined, cannot be monitored"
- Limit reached → red warning box, add button hidden
- All errors shown inline (per section), not at top of page
- Spinner loaders on all CTA buttons (no "..." text)
- No "Rediscover" button
- No subreddit type labels (niche/mid/large) shown to user
- Subreddits show only name + reason + delete button (no checkmarks)
- Credit badge shows live balance (red when ≤5 credits), refreshes on navigation
- Trial timestamps set on completion (3 days from onboarding)

---

## Phase 3: Scanner Worker — NOT STARTED

Per TECH-SPEC.md §6, §7:
- Railway worker (always-on Node.js process)
- ML model loading (all-MiniLM-L6-v2 for semantic embeddings)
- Pass 1: Semantic + keyword/regex pre-filter (local, free)
- Pass 2: Claude Haiku LLM relevance scoring
- Priority scoring (40% relevance, 30% recency, 15% velocity, 15% intent)
- 5 post categories (pain_point, solution_request, competitor_dissatisfaction, experience_sharing, industry_discussion)
- Alert creation + email notifications (Amazon SES)
- First-time post fetch (last 24hrs after onboarding)
- Plan eligibility check (skip expired free trials)
- Health endpoint + scan-now webhook

**Needs before starting:**
- Reddit API credentials (OAuth2 app registration)
- AWS SES credentials
- Railway account + deployment setup

---

## Phase 4: Dashboard — NOT STARTED

Per PRODUCT-SPEC.md §5.2:
- Alert feed with New/Seen split
- Filter by: view, subreddit, priority, category, date range
- Sort by: priority, newest, most comments
- Filter/Sort as separate hover-to-expand dropdowns
- Alert cards: priority level, subreddit, time ago, title, category, upvotes, comments
- No relevance score shown to user
- Alert seen tracking (intersection observer)
- Monitored subreddits section (with 🔒 for private)
- Empty states

---

## Phase 5: Thread Analysis — NOT STARTED

Per PRODUCT-SPEC.md §5.3:
- Chat interface with sidebar history (ChatGPT-style)
- Initial AI analysis: summary, pain points, key insights, buying signals, competitive landscape
- 4 suggested follow-up questions (clickable chips)
- Manual URL input (only on this page)
- Post summary card (not full thread — link to Reddit)
- Thread chat messages stored in DB

---

## Phase 6: Comment Drafting — NOT STARTED

Per PRODUCT-SPEC.md §5.4:
- 2-3 drafts per request with different tones
- Per-draft regenerate button
- Edit includes write-your-own (no separate CTA)
- Reply to post OR specific comment
- Subreddit rules shown at top
- No rule check badge shown
- OpenAI GPT-4o for drafting, Claude for everything else

---

## Phase 7: Settings + Billing — NOT STARTED

Per PRODUCT-SPEC.md §5.5:
- Sidebar tab layout (Business Profile / Notifications / Usage & Billing)
- Business Profile: all fields editable, same add/delete UX as onboarding
- Notifications: email alerts toggle, threshold setting
- Usage & Billing: placeholder for now (defined later)

---

## Phase 8: Polish + Testing — NOT STARTED

- Error states across all pages
- Credit edge cases (insufficient balance, expired trial, concurrent deduction)
- E2E tests (Playwright): onboarding, dashboard, thread analysis, drafts, settings
- Unit tests (Vitest): credits lib, scoring, pre-filter
- LLM eval suite: 20 sample posts for scoring accuracy + category classification

---

## Key Architecture Decisions Made

1. **Auth:** Supabase Auth (Google OAuth only, no email/password)
2. **Database:** Supabase PostgreSQL with RLS
3. **Frontend:** Next.js 15 App Router, inline styles (not Tailwind utility classes — CSS vars don't resolve with Tailwind 4 @theme)
4. **LLM:** Claude Sonnet for analysis/intelligence, Claude Haiku for scoring, GPT-4o for drafting
5. **Email:** Amazon SES (no rate limit on user inbox)
6. **Scanner:** Railway always-on worker with MiniLM-L6-v2 local model
7. **Credits:** Token-based (1 credit ≈ 1000 tokens), atomic deduction via SQL function
8. **Pricing:** Free (3-day trial, 3 subs, 25 credits) / Growth ($39/mo, 10 subs, 250 credits) / Custom (negotiated)

---

## Key Files Reference

| Purpose | Path |
|---------|------|
| Product spec | `PRODUCT-SPEC.md` |
| Technical spec | `TECH-SPEC.md` |
| Design system | `DESIGN-SYSTEM.md` |
| Product strategy | `DESIGN.md` |
| Project conventions | `CLAUDE.md` |
| This file | `PROGRESS.md` |
| Supabase migrations | `supabase/migrations/001-006` |
| LLM prompts | `prompts/onboarding-agent1.md`, `prompts/onboarding-agent2.md` |
| Credits library | `src/lib/credits/` |
| Supabase clients | `src/lib/supabase/` |
| LLM client | `src/lib/llm/anthropic.ts` |
| Onboarding (full wizard) | `src/app/onboarding/page.tsx` |
| App shell (nav) | `src/components/layout/app-shell.tsx` |
| Auth middleware | `src/middleware.ts` |

---

## How to Run Locally

```bash
pnpm install
pnpm dev
# Opens at http://localhost:3000
```

Requires `.env.local` with Supabase + Anthropic credentials (already configured).
