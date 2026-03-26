# Reddit API Access Application (Reapplication)

**Status:** Pending — apply after Reddit account has sufficient activity
**Account requirements before applying:** 100+ karma, 1-2 weeks of genuine commenting in the subreddits below
**Apply at:** https://support.reddithelp.com/hc/en-us/requests/new

---

## Reddit account name

[your Reddit username]

## What benefit/purpose will the bot/app have for Redditors?

I'm building a personal notification tool to help me stay on top of new conversations in SaaS and side-project subreddits that I actively participate in. Instead of checking Reddit multiple times a day, this script alerts me when new posts match topics I care about — so I can jump into discussions earlier and give more timely, helpful responses to fellow builders.

## Provide a detailed description of what the Bot/App will be doing on the Reddit platform.

This is a personal read-only script that runs on my local machine. Here's exactly what it does:

1. Every 15 minutes, it checks 5 subreddits I'm active in for new posts using `GET /r/{subreddit}/new.json`
2. It compares post titles against a list of topics I'm interested in (SaaS, side projects, no-code tools, MVPs, pricing, growth)
3. If a post matches, it sends me a desktop notification so I can open Reddit and respond manually
4. That's it — there is no other functionality

What the script does NOT do:
- Does NOT post, comment, vote, send DMs, or modify anything on Reddit
- Does NOT store any user data or build any database of Reddit content
- Does NOT access private, quarantined, or NSFW subreddits
- Does NOT scrape historical data — only checks the latest 10 posts per subreddit
- Does NOT redistribute or commercialize any Reddit data
- Does NOT run on a server — runs locally on my laptop only

Technical details:
- App type: Script (server-to-server, personal use only)
- Total API calls: ~5 requests every 15 minutes (one per subreddit)
- That's approximately 0.3 requests per minute — far below the 100 req/min free tier limit
- Single Reddit account, single machine

## What is missing from Devvit that prevents building on that platform?

Devvit is designed for apps that live inside a specific subreddit — moderation bots, interactive posts, community widgets. My use case is different: I just want to know when new posts appear across a few subreddits I follow so I can participate in discussions more promptly. Devvit's subreddit-scoped architecture doesn't support a simple cross-subreddit notification script running outside of Reddit on my local machine.

## Provide a link to source code or platform that will access the API.

https://github.com/antriksh-29/reddit-notifier

The entire source code is public — it's a simple ~100 line TypeScript script. You can see exactly what it does.

## What subreddits do you intend to use the bot/app in?

These are subreddits I actively participate in:

- r/SaaS
- r/NoCodeSaaS
- r/SideProject
- r/VibeCodingSaaS
- r/SaaSCoFounders

All public subreddits. Read-only access only.

## If applicable, what username will you be operating this bot/app under? (optional)

[your Reddit username]

---

## Key differences from first application (rejected)

| First attempt (rejected) | This reapplication |
|-------------------------|-------------------|
| "SaaS platform" | "Personal notification script" |
| "helps businesses find conversations" | "helps me participate in discussions earlier" |
| "100-500 requests per 15-min cycle" | "5 requests every 15 minutes" |
| "1,500 at full capacity" | Not mentioned — single user, single machine |
| Linked to commercial repo | Linked to simple personal script repo |
| Framed as a product | Framed as a personal tool |
| Generic subreddits (r/SaaS, r/startups, r/marketing) | Specific niche subreddits I'm active in |

## Pre-application checklist

- [ ] Reddit account has 100+ karma
- [ ] At least 1-2 weeks of genuine comments in the 5 subreddits above
- [ ] reddit-notifier repo is public with clean README
- [ ] No mention of commercial use, SaaS, or business anywhere in the application
- [ ] App type set to "script" (not "web app")
