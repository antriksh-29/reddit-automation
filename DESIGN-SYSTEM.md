# Design System — Reddit Lead Intelligence

## Product Context
- **What this is:** A SaaS platform for finding and engaging with relevant Reddit conversations in real-time
- **Who it's for:** GTM teams, indie hackers, marketing agencies using Reddit as a lead-gen channel
- **Space/industry:** Reddit marketing tools, social listening, lead intelligence
- **Project type:** Dark-mode web app (dashboard + chat interface)

## Inspirations
- **Cardboard** (usecardboard.com) — dark, cinematic, product-first, zero decoration
- **Y Combinator** (ycombinator.com) — editorial warmth, orange accent, confident simplicity
- **Wispr Flow** (wisprflow.ai) — clean typography, warm tones, measured color
- **Anthropic** (anthropic.com) — editorial feel, warm palette, premium whitespace
- **Conductor** (conductor.build) — dark app UI, minimal chrome, monospace influence

## UX Principles
Drawn from Figma, Notion, and Airbnb's design philosophies:
- **Progressive disclosure** (Figma) — filters/details appear on hover, not always visible. Reduce cognitive load by showing only what's needed.
- **Blank paper simplicity** (Notion) — minimal chrome, content is king. Easy to learn, hard to master.
- **Unified & Conversational** (Airbnb) — consistent components everywhere, motion that communicates state changes.
- **User control** (Figma) — every auto-generated field is editable, every AI suggestion is removable.
- **Trust signals** — show reasoning behind AI outputs (relevance reasoning, category explanations), not just results.

## Aesthetic Direction
- **Direction:** Industrial Warm
- **Decoration level:** Minimal — typography and color do all the work, no blobs, gradients, or decorative elements
- **Mood:** Professional intelligence tool with warmth. Feels like a Bloomberg terminal designed by someone who appreciates Anthropic's website. Data-dense but never cramped. Confident, not flashy.

## Typography

| Role | Font | Weight | Rationale |
|------|------|--------|-----------|
| Display/Hero | Satoshi | 700 (Bold) | Geometric, modern, warm. Great on dark backgrounds. Used by YC-backed products. Not overused. |
| Headings | Satoshi | 600 (Semi) | Consistent family with display. Clean hierarchy. |
| Body | DM Sans | 400 (Regular) | Excellent readability at small sizes on dark backgrounds. Warm geometry pairs with Satoshi. Google Fonts, free. |
| Body emphasis | DM Sans | 500 (Medium) | Labels, metadata, secondary headings within body. |
| Data/Tables | Geist | 400-600 | Designed by Vercel for data-dense interfaces. Tabular-nums for aligned numbers. |
| Code/Mono | JetBrains Mono | 400 | Purpose-built for code. Used for Reddit usernames (u/name), URLs, technical metadata. |

**Type Scale (base 16px):**

| Token | Size | Font | Usage |
|-------|------|------|-------|
| `--text-hero` | 36px / 2.25rem | Satoshi Bold | Landing hero, onboarding headings |
| `--text-h1` | 28px / 1.75rem | Satoshi Bold | Page titles (Dashboard, Settings) |
| `--text-h2` | 22px / 1.375rem | Satoshi Semi | Section headings (Priority Alerts, Analysis) |
| `--text-h3` | 18px / 1.125rem | Satoshi Semi | Sub-section headings (Pain Points, Key Insights) |
| `--text-body` | 15px / 0.9375rem | DM Sans Regular | Body text, alert descriptions, analysis content |
| `--text-small` | 13px / 0.8125rem | DM Sans Regular | Metadata, timestamps, secondary labels |
| `--text-caption` | 12px / 0.75rem | DM Sans Medium | Tags, badges, filter labels |
| `--text-data` | 14px / 0.875rem | Geist | Table cells, numeric data, scores |
| `--text-mono` | 13px / 0.8125rem | JetBrains Mono | u/usernames, URLs, code |

**Letter spacing:**
- Hero/H1: -0.03em (tight)
- H2/H3: -0.01em (slightly tight)
- Body and below: 0 (default)
- Uppercase labels: +0.06em (wide)

**Loading:**
- Satoshi: `https://api.fontshare.com/v2/css?f[]=satoshi@400,500,700,900&display=swap`
- DM Sans, Geist, JetBrains Mono: Google Fonts

## Color

### Core Palette

| Token | Hex | Usage |
|-------|-----|-------|
| `--bg` | `#0A0A0A` | Page background — true dark |
| `--surface` | `#141414` | Cards, panels, sidebar background |
| `--surface-raised` | `#1C1C1C` | Elevated elements — dropdowns, modals, hover states |
| `--border` | `#2A2A2A` | Subtle borders, dividers |
| `--border-hover` | `#3A3A3A` | Border on hover/focus state |
| `--text-primary` | `#F5F5F3` | Primary text — warm off-white, not pure white |
| `--text-secondary` | `#A3A3A3` | Secondary labels, metadata, timestamps |
| `--text-muted` | `#666666` | Placeholders, disabled text, section labels |

### Accent

| Token | Hex | Usage |
|-------|-----|-------|
| `--accent` | `#E8651A` | Primary orange — CTAs, active states, links, brand |
| `--accent-hover` | `#D4590F` | Orange on hover (slightly darker) |
| `--accent-subtle` | `rgba(232,101,26,0.12)` | Orange tint for selected states, active sidebar items |

### Semantic

| Token | Hex | Usage |
|-------|-----|-------|
| `--success` | `#34D399` | Success states, "Strong" health tags |
| `--warning` | `#FBBF24` | Warning states, "Medium" health tags |
| `--error` | `#F87171` | Error states, "Weak" health tags, high priority indicator |
| `--info` | `#60A5FA` | Informational states |

### Priority Indicators

| Level | Color | Token |
|-------|-------|-------|
| High | `#F87171` (red) | `--priority-high` |
| Medium | `#FBBF24` (amber) | `--priority-medium` |
| Low | `#A3A3A3` (gray) | `--priority-low` |

### Post Category Colors

Each category has its own distinct color to differentiate from CTAs and each other:

| Category | Text Color | Background | Token prefix |
|----------|-----------|-----------|-------------|
| Pain Point | `#F87171` | `rgba(248,113,113,0.12)` | `--cat-pain` |
| Solution Request | `#60A5FA` | `rgba(96,165,250,0.12)` | `--cat-solution` |
| Competitor Dissatisfaction | `#FBBF24` | `rgba(251,191,36,0.12)` | `--cat-competitor` |
| Experience Sharing | `#A78BFA` | `rgba(167,139,250,0.12)` | `--cat-experience` |
| Industry Discussion | `#2DD4BF` | `rgba(45,212,191,0.12)` | `--cat-industry` |

Pattern: tinted background (12% opacity) + colored text. Same visual pattern as health tags.

## Spacing
- **Base unit:** 4px
- **Density:** Comfortable — enough room to breathe but data-efficient
- **Scale:**

| Token | Value | Usage |
|-------|-------|-------|
| `--space-2xs` | 2px | Tight separators, dot indicators |
| `--space-xs` | 4px | Inline gaps, icon padding |
| `--space-sm` | 8px | Tag padding, tight stack gaps |
| `--space-md` | 16px | Card padding (internal), standard gap |
| `--space-lg` | 24px | Section padding, card outer spacing |
| `--space-xl` | 32px | Page section margins |
| `--space-2xl` | 48px | Major section separation |
| `--space-3xl` | 64px | Page-level vertical rhythm |

## Layout
- **Approach:** Grid-disciplined — consistent columns, predictable alignment
- **Sidebar:** 240px fixed width, left side. Present on Dashboard, Thread Analysis, Settings.
- **Main content area:** Fluid, max-width 1200px, centered.
- **Grid:** 12-column for main content area.
- **Responsive breakpoints:** 640px (mobile) / 768px (tablet) / 1024px (desktop) / 1280px (wide)
- **Border radius:**

| Token | Value | Usage |
|-------|-------|-------|
| `--radius-sm` | 4px | Buttons, inputs, tags, small chips |
| `--radius-md` | 8px | Cards, panels, alert cards |
| `--radius-lg` | 12px | Modals, large containers, dashboard frame |
| `--radius-full` | 9999px | Suggested question pills, avatar circles |

## Motion
- **Approach:** Minimal-functional — only transitions that aid comprehension. No scroll animations, no entrance choreography, no bouncing.
- **Easing:**
  - Enter: `ease-out` (element appearing)
  - Exit: `ease-in` (element leaving)
  - Move: `ease-in-out` (element repositioning)
- **Duration:**
  - Micro: 75ms — hover states, button press
  - Short: 150ms — dropdown open, tooltip appear, border color change
  - Medium: 250ms — page transitions, modal open/close, sidebar expand

## Component Patterns

### Buttons
- **Primary (Draft Response):** `--accent` background, white text. Hover: `--accent-hover`. Used for the main action on any view.
- **Secondary (Analyze Thread):** `--surface-raised` background, `--text-primary` text, `--border` border. Hover: `--border-hover`.
- **Ghost (View on Reddit):** Transparent background, `--text-secondary` text. Hover: `--text-primary`.
- **Small variant:** Same styles, reduced padding (6px 14px) and font size (13px).

### Tags/Chips
- **Health tags:** Colored dot + text on tinted background. Colors: success/warning/error.
- **Category tags:** Tinted background + colored text. 5 distinct colors (see Post Category Colors).
- **Neutral tags:** `--surface-raised` background, `--text-secondary` text.

### Cards
- `--surface` background, `--border` border, `--radius-md` corners.
- Hover: `--border-hover` border transition (150ms).
- Alert cards: left border accent color matches priority level (3px solid).

### Inputs
- `--surface` background, `--border` border, `--radius-sm` corners.
- Focus: `--accent` border color.
- Placeholder: `--text-muted`.

### Sidebar Navigation
- Active item: `--accent-subtle` background, `--text-primary` text.
- Hover: `--surface-raised` background.
- Section labels: uppercase, 11px, `--text-muted`, +0.06em letter-spacing.

### Alert Cards (Dashboard)
- Priority dot (8px circle) + priority label + subreddit + timestamp
- Post title (15px, medium weight)
- Category tag (distinct color) + engagement stats + CTA buttons
- CTAs: Draft Response (primary/orange), Analyze Thread (secondary/gray)
- All priority levels (high/medium/low) show the same CTA format

### Thread Analysis Chat
- Left sidebar: history list (ChatGPT-style), grouped by date
- Main area: post summary card → AI analysis sections → suggested questions → chat input
- Suggested questions: pill-shaped (`--radius-full`), `--border` border, hover → `--accent` border + text
- Chat input: `--radius-md`, full-width with Send button

## Anti-Patterns (never use)
- Purple/violet gradients as accent
- 3-column feature grid with icons in colored circles
- Centered everything with uniform spacing
- Gradient buttons
- Decorative blobs or background patterns
- Pure white (#FFFFFF) text — always use warm off-white (#F5F5F3)
- Blue as a primary action color — blue is reserved for info/Solution Request category only
- Opacity reduction on low-priority content — all alert cards have equal visual weight

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-25 | Dark mode (#0A0A0A) as default and only mode | Matches Conductor/Cardboard inspiration. Professional tool feel. No light mode for MVP. |
| 2026-03-25 | Warm Burnt Orange #E8651A as accent | Sophisticated enough for B2B SaaS, clearly Reddit-adjacent. Matches editorial warmth of Anthropic/YC. |
| 2026-03-25 | Satoshi + DM Sans + Geist + JetBrains Mono | Four-font system covering display, body, data, code. Each chosen for dark-mode readability and warm geometry. |
| 2026-03-25 | 5 distinct category colors | Each post category (Pain Point, Solution Request, etc.) gets its own color to distinguish from orange CTAs and gray UI elements. |
| 2026-03-25 | Draft Response = primary CTA, Analyze Thread = secondary | Draft Response is the highest-value action for users — drives engagement. Analyze Thread supports it. |
| 2026-03-25 | Minimal-functional motion only | No decorative animation. Professional tool where data density and speed matter more than delight animations. |
