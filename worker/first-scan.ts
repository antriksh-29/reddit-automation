/**
 * First Scan — fast inline scan triggered after onboarding.
 * Uses GPT-5.4-nano for Pass 1 (same as regular scan cycle).
 * Streams progress via SSE to the frontend loading screen.
 *
 * Differences from regular scan cycle:
 *   - 2s Reddit fetch delay (not 7s) — only 3 requests
 *   - Streams progress events for real-time UI
 *   - Target: <30 seconds total
 */

import { createClient } from "@supabase/supabase-js";
import pLimit from "p-limit";
import { prefilterPost, type UserProfile } from "./prefilter.js";
import { scoreRelevance } from "./scoring.js";
import type { RedditPost } from "./reddit.js";
import type { Response } from "express";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// No Anthropic client needed — both passes use nano (OpenAI)
const USER_AGENT = "Arete/1.0 (Reddit Lead Intelligence)";
const FETCH_DELAY_MS = 2000;

interface FirstScanRedditPost {
  id: string;
  name: string;
  title: string;
  selftext: string;
  author: string;
  permalink: string;
  subreddit: string;
  created_utc: number;
  ups: number;
  num_comments: number;
}

function sendSSE(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function runFirstScan(userId: string, res: Response): Promise<void> {
  try {
    // Get business
    const { data: business } = await supabase
      .from("businesses")
      .select("id, description, icp_description, keywords, embedding_vectors")
      .eq("user_id", userId)
      .single();

    if (!business) {
      sendSSE(res, "error", { message: "No business found" });
      res.end();
      return;
    }

    // Get subreddits + competitors
    const { data: subs } = await supabase
      .from("monitored_subreddits")
      .select("id, subreddit_name")
      .eq("business_id", business.id)
      .eq("is_active", true);

    const { data: comps } = await supabase
      .from("competitors")
      .select("name")
      .eq("business_id", business.id);

    const subredditList = subs || [];
    const competitorNames = (comps || []).map((c) => c.name);
    const keywords = business.keywords as { primary: string[]; discovery: string[] } | null;
    const allKeywords = [...(keywords?.primary || []), ...(keywords?.discovery || [])];

    // No embedding step needed — nano uses API calls, not local embeddings.
    sendSSE(res, "progress", { step: "setup", message: "Preparing to scan...", pct: 5 });

    // 1. Fetch posts from Reddit (2s delay between requests)
    sendSSE(res, "progress", { step: "fetching", message: "Fetching posts from Reddit...", pct: 10 });

    const allPosts: (RedditPost & { subreddit_id: string })[] = [];

    for (let i = 0; i < subredditList.length; i++) {
      const sub = subredditList[i];
      sendSSE(res, "progress", {
        step: "fetching",
        message: `Scanning r/${sub.subreddit_name}...`,
        pct: 10 + Math.round((i / subredditList.length) * 20),
      });

      try {
        // First scan uses /hot.json (best engaging recent content) with limit=100
        // Regular scanner uses /new.json (chronological) — different use case
        const url = `https://api.reddit.com/r/${sub.subreddit_name}/hot.json?limit=100&raw_json=1`;
        const fetchRes = await fetch(url, {
          headers: { "User-Agent": USER_AGENT },
          redirect: "manual",
        });

        console.log(`[first-scan] r/${sub.subreddit_name}: HTTP ${fetchRes.status}, type=${fetchRes.headers.get('content-type')}`);

        if (fetchRes.ok) {
          const data = await fetchRes.json();
          const posts = (data?.data?.children || [])
            .filter((c: { kind: string }) => c.kind === "t3")
            .map((c: { data: Record<string, unknown> }) => ({
              id: c.data.id as string,
              name: c.data.name as string,
              title: c.data.title as string,
              selftext: (c.data.selftext as string) || "",
              author: c.data.author as string,
              permalink: c.data.permalink as string,
              subreddit: c.data.subreddit as string,
              created_utc: c.data.created_utc as number,
              ups: c.data.ups as number,
              num_comments: c.data.num_comments as number,
              subreddit_id: sub.id,
            }));
          console.log(`[first-scan] r/${sub.subreddit_name}: ${posts.length} posts parsed`);
          allPosts.push(...posts);
        } else {
          const bodyPreview = await fetchRes.text().catch(() => "").then(t => t.substring(0, 200));
          console.log(`[first-scan] r/${sub.subreddit_name}: BLOCKED — ${bodyPreview}`);
        }
      } catch (err) {
        console.log(`[first-scan] r/${sub.subreddit_name}: FETCH ERROR — ${err}`);
      }

      if (i < subredditList.length - 1) {
        await new Promise((r) => setTimeout(r, FETCH_DELAY_MS));
      }
    }

    sendSSE(res, "progress", {
      step: "filtering",
      message: `Found ${allPosts.length} posts. Running semantic analysis...`,
      pct: 35,
    });

    // 2. Pass 1: GPT-5.4-nano relevance filter
    const userProfile: UserProfile = {
      embedding_vectors: null, // Not used with nano
      keywords: keywords || { primary: [], discovery: [] },
      competitors: competitorNames,
      description: business.description || "",
      icp_description: business.icp_description || "",
    };

    // Run nano prefilter in parallel batches (p-limit=15 for speed)
    const prefilterLimiter = pLimit(15);
    const filterResults = await Promise.all(
      allPosts.map((post) =>
        prefilterLimiter(async () => {
          const result = await prefilterPost(
            { ...post, url: "", is_self: true },
            userProfile
          );
          return { post, passed: result.passed };
        })
      )
    );
    const filtered = filterResults.filter((r) => r.passed).map((r) => r.post);

    // Sort filtered posts by Pass 1 score (highest first) and cap to top 15
    // Remaining posts will be scored in the next regular 30-min scan cycle
    const MAX_FIRST_SCAN_HAIKU = 15;
    const scoredByPass1 = filtered.slice(0, MAX_FIRST_SCAN_HAIKU);
    const deferred = filtered.length - scoredByPass1.length;

    sendSSE(res, "progress", {
      step: "scoring",
      message: `${scoredByPass1.length} top posts found${deferred > 0 ? ` (+${deferred} queued for next scan)` : ""}. AI is scoring them...`,
      pct: 45,
    });

    // 3. Pass 2: Nano scoring (parallel, concurrency=15 for speed)
    const scoringLimiter = pLimit(15);
    let scored = 0;

    const businessContext = {
      description: business.description || "",
      icp_description: business.icp_description || "",
      keywords: keywords || { primary: [], discovery: [] },
      competitors: competitorNames,
    };

    const results = await Promise.allSettled(
      scoredByPass1.map((post) =>
        scoringLimiter(async () => {
          try {
            const { relevanceScore, category } = await scoreRelevance(
              { ...post, url: "", is_self: true } as RedditPost & { url: string; is_self: boolean },
              businessContext
            );

            scored++;
            sendSSE(res, "progress", {
              step: "scoring",
              message: `Scoring posts... (${scored}/${scoredByPass1.length})`,
              pct: 45 + Math.round((scored / scoredByPass1.length) * 40),
            });

            // Priority calculation
            const ageMinutes = Math.max(1, (Date.now() / 1000 - post.created_utc) / 60);
            const recency = ageMinutes < 15 ? 1.0 : ageMinutes < 60 ? 0.8 : ageMinutes < 180 ? 0.6 : ageMinutes < 360 ? 0.4 : ageMinutes < 720 ? 0.2 : 0.1;
            const velocity = Math.min(1.0, (post.ups + post.num_comments) / ageMinutes);
            const postText = `${post.title} ${post.selftext}`.toLowerCase();
            const strongIntent = [/looking for/, /recommend/, /best tool/, /any suggestions/, /alternative to/, /switching from/, /need a\b/, /budget \$/];
            const weakIntent = [/how do you/, /what do you use/, /anyone use/, /frustrated with/];
            const intent = strongIntent.some((p) => p.test(postText)) ? 1.0 : weakIntent.some((p) => p.test(postText)) ? 0.5 : 0.0;

            const priorityScore = Math.round((relevanceScore * 0.4 + recency * 0.3 + velocity * 0.15 + intent * 0.15) * 100) / 100;
            const priorityLevel = priorityScore > 0.6 ? "high" : priorityScore >= 0.3 ? "medium" : "low";

            if (priorityScore < 0.2) return null;

            return {
              business_id: business.id,
              subreddit_id: post.subreddit_id,
              reddit_post_id: post.id,
              post_title: post.title,
              post_body: post.selftext.slice(0, 5000),
              post_author: post.author,
              post_url: `https://reddit.com${post.permalink}`,
              post_created_at: new Date(post.created_utc * 1000).toISOString(),
              upvotes: post.ups,
              num_comments: post.num_comments,
              priority_score: priorityScore,
              priority_level: priorityLevel,
              priority_factors: { relevance: relevanceScore, recency, velocity, intent },
              category,
              email_status: "skipped",
            };
          } catch {
            return null;
          }
        })
      )
    );

    sendSSE(res, "progress", { step: "saving", message: "Saving alerts to your dashboard...", pct: 90 });

    // 5. Insert alerts
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const alerts: any[] = [];
    for (const r of results) {
      if (r.status === "fulfilled" && r.value !== null) {
        alerts.push(r.value);
      }
    }

    let alertsCreated = 0;
    if (alerts.length > 0) {
      const { data: inserted } = await supabase
        .from("alerts")
        .upsert(alerts, { onConflict: "reddit_post_id", ignoreDuplicates: true })
        .select("id");
      alertsCreated = inserted?.length || 0;
    }

    // Update last_seen_post_id for each subreddit
    for (const sub of subredditList) {
      const subPosts = allPosts.filter((p) => p.subreddit_id === sub.id);
      if (subPosts.length > 0) {
        await supabase
          .from("monitored_subreddits")
          .update({
            last_scanned_at: new Date().toISOString(),
            last_seen_post_id: subPosts[0].name,
          })
          .eq("id", sub.id);
      }
    }

    sendSSE(res, "progress", { step: "done", message: "Dashboard ready!", pct: 100 });
    sendSSE(res, "complete", {
      alertsCreated,
      totalPosts: allPosts.length,
      filtered: filtered.length,
    });
  } catch (error) {
    console.error("[first-scan] Error:", error);
    sendSSE(res, "error", { message: "Scan failed. Your dashboard will update on the next cycle." });
  } finally {
    res.end();
  }
}
