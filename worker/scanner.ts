/**
 * Core Scanner — orchestrates the full scan cycle.
 * Ref: TECH-SPEC.md §7, PRODUCT-SPEC.md §7.1
 *
 * SCAN CYCLE:
 *   1. Get all unique active subreddits
 *   2. Fetch new posts per subreddit (1 Reddit API call each)
 *   3. Get eligible users per subreddit (plan check)
 *   4. Per-post, per-user: Pass 1 → Pass 2 → Priority → Alert
 *   5. Update scan timestamps
 *
 * Circuit breaker: abort at 27 min to stay within 30-min window.
 * Mutex: skip cycle if previous scan still running.
 */

import { createClient } from "@supabase/supabase-js";
import pLimit from "p-limit";
import { fetchNewPosts, type RedditPost } from "./reddit.js";
import { prefilterPost, type UserProfile } from "./prefilter.js";
import { scoreRelevance, calculatePriority, type PostCategory } from "./scoring.js";
import { sendAlertEmail, type AlertEmailData } from "../src/lib/email/ses.js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Concurrency limit for Haiku API calls
const haikuLimiter = pLimit(5); // Conservative for public API rate limits

let scanInProgress = false;
let lastScanTime: Date | null = null;
let lastScanMetrics: ScanMetrics | null = null;

interface ScanMetrics {
  startedAt: Date;
  completedAt: Date;
  subredditsScanned: number;
  postsFetched: number;
  postsPassedPass1: number;
  postsPassedPass2: number;
  alertsCreated: number;
  errors: number;
  aborted: boolean;
}

interface EligibleUser {
  user_id: string;
  email: string;
  business_id: string;
  description: string;
  icp_description: string;
  keywords: { primary: string[]; discovery: string[] };
  competitors: string[];
  embedding_vectors: number[] | null;
  subreddit_id: string;
}

export function isScanInProgress(): boolean {
  return scanInProgress;
}

export function getLastScanTime(): Date | null {
  return lastScanTime;
}

export function getLastScanMetrics(): ScanMetrics | null {
  return lastScanMetrics;
}

/**
 * Run a full scan cycle across all active subreddits.
 */
export async function runScanCycle(): Promise<ScanMetrics> {
  if (scanInProgress) {
    console.log("[scanner] Skipping — previous scan still running");
    return lastScanMetrics!;
  }

  scanInProgress = true;
  const cycleStart = Date.now();

  const metrics: ScanMetrics = {
    startedAt: new Date(),
    completedAt: new Date(),
    subredditsScanned: 0,
    postsFetched: 0,
    postsPassedPass1: 0,
    postsPassedPass2: 0,
    alertsCreated: 0,
    errors: 0,
    aborted: false,
  };

  try {
    // 1. Get all unique active subreddits
    const { data: subs, error: subsError } = await supabase
      .from("monitored_subreddits")
      .select("subreddit_name")
      .eq("is_active", true)
      .eq("status", "active");

    if (subsError || !subs) {
      console.error("[scanner] Failed to fetch subreddits:", subsError);
      metrics.errors++;
      return metrics;
    }

    // Deduplicate subreddit names (multiple users may monitor the same sub)
    const uniqueSubs = [...new Set(subs.map((s) => s.subreddit_name))];
    console.log(`[scanner] Scanning ${uniqueSubs.length} unique subreddits`);

    for (const subName of uniqueSubs) {
      // Circuit breaker: abort if approaching 30-min limit
      if (Date.now() - cycleStart > 27 * 60 * 1000) {
        console.warn("[scanner] Circuit breaker: aborting remaining subreddits");
        metrics.aborted = true;
        break;
      }

      try {
        await scanSubreddit(subName, metrics);
        metrics.subredditsScanned++;
      } catch (error) {
        console.error(`[scanner] Error scanning r/${subName}:`, error);
        metrics.errors++;
      }
    }

    // Log scan cycle event
    await supabase.from("event_logs").insert({
      event_type: "scan.cycle_completed",
      event_data: {
        duration_ms: Date.now() - cycleStart,
        subreddits_scanned: metrics.subredditsScanned,
        posts_fetched: metrics.postsFetched,
        posts_filtered_pass1: metrics.postsPassedPass1,
        posts_scored_pass2: metrics.postsPassedPass2,
        alerts_created: metrics.alertsCreated,
        errors: metrics.errors,
        aborted: metrics.aborted,
      },
      source: "cron",
    });
  } finally {
    metrics.completedAt = new Date();
    scanInProgress = false;
    lastScanTime = new Date();
    lastScanMetrics = metrics;

    const duration = ((Date.now() - cycleStart) / 1000).toFixed(1);
    console.log(
      `[scanner] Cycle complete: ${metrics.subredditsScanned} subs, ` +
        `${metrics.postsFetched} posts, ${metrics.alertsCreated} alerts, ` +
        `${metrics.errors} errors in ${duration}s`
    );
  }

  return metrics;
}

/**
 * Scan a single subreddit — fetch posts, score per user, create alerts.
 */
async function scanSubreddit(subName: string, metrics: ScanMetrics): Promise<void> {
  // Get the last seen post ID for this subreddit (from any user monitoring it)
  const { data: subRecord } = await supabase
    .from("monitored_subreddits")
    .select("last_seen_post_id")
    .eq("subreddit_name", subName)
    .eq("is_active", true)
    .limit(1)
    .single();

  // Fetch new posts from Reddit
  const { posts } = await fetchNewPosts(subName, {
    limit: 25,
  });

  if (posts.length === 0) return;
  metrics.postsFetched += posts.length;

  console.log(`[scanner] r/${subName}: ${posts.length} posts fetched`);

  // Get eligible users monitoring this subreddit
  const users = await getEligibleUsers(subName);
  if (users.length === 0) return;

  // Filter out posts we've already seen (by checking last_seen_post_id timestamp)
  const lastSeenId = subRecord?.last_seen_post_id;
  const newPosts = lastSeenId
    ? posts.filter((p) => p.name > lastSeenId || !lastSeenId)
    : posts;

  if (newPosts.length === 0) return;

  // Process each post against each user
  for (const post of newPosts) {
    // Dedup: check if alert already exists for this post
    const { data: existing } = await supabase
      .from("alerts")
      .select("id")
      .eq("reddit_post_id", post.id)
      .limit(1);

    if (existing && existing.length > 0) continue;

    // Score against each eligible user
    await Promise.allSettled(
      users.map((user) => scoreAndAlert(post, user, metrics))
    );
  }

  // Update last_seen_post_id for all monitored_subreddits rows with this name
  const latestPostName = posts[0]?.name; // Posts are sorted newest first
  if (latestPostName) {
    await supabase
      .from("monitored_subreddits")
      .update({
        last_scanned_at: new Date().toISOString(),
        last_seen_post_id: latestPostName,
      })
      .eq("subreddit_name", subName)
      .eq("is_active", true);
  }
}

/**
 * Get users eligible for scanning on a given subreddit.
 * Growth/Custom: always eligible.
 * Free: only if trial is still active.
 */
async function getEligibleUsers(subName: string): Promise<EligibleUser[]> {
  const { data, error } = await supabase
    .from("monitored_subreddits")
    .select(
      `
      id,
      business_id,
      businesses!inner (
        id,
        user_id,
        description,
        icp_description,
        keywords,
        embedding_vectors,
        users!inner (
          id,
          email,
          plan_tier,
          trial_ends_at
        )
      )
    `
    )
    .eq("subreddit_name", subName)
    .eq("is_active", true)
    .eq("status", "active");

  if (error || !data) {
    console.error(`[scanner] Failed to get users for r/${subName}:`, error);
    return [];
  }

  const now = new Date();

  return data
    .filter((row) => {
      const business = row.businesses as unknown as {
        id: string;
        user_id: string;
        description: string;
        icp_description: string;
        keywords: { primary: string[]; discovery: string[] };
        embedding_vectors: number[] | null;
        users: { id: string; email: string; plan_tier: string; trial_ends_at: string | null };
      };
      const user = business.users;

      // Plan eligibility check
      if (user.plan_tier === "growth" || user.plan_tier === "custom") return true;
      if (user.plan_tier === "free" && user.trial_ends_at) {
        return new Date(user.trial_ends_at) > now;
      }
      return false;
    })
    .map((row) => {
      const business = row.businesses as unknown as {
        id: string;
        user_id: string;
        description: string;
        icp_description: string;
        keywords: { primary: string[]; discovery: string[] };
        embedding_vectors: number[] | null;
        users: { id: string; email: string; plan_tier: string; trial_ends_at: string | null };
      };

      // Get competitors for this business
      return {
        user_id: business.users.id,
        email: business.users.email,
        business_id: business.id,
        description: business.description || "",
        icp_description: business.icp_description || "",
        keywords: business.keywords || { primary: [], discovery: [] },
        competitors: [], // Will be fetched separately
        embedding_vectors: business.embedding_vectors,
        subreddit_id: row.id,
      };
    });
}

/**
 * Score a single post against a single user.
 * Pass 1 → Pass 2 → Priority → Create Alert
 */
async function scoreAndAlert(
  post: RedditPost,
  user: EligibleUser,
  metrics: ScanMetrics
): Promise<void> {
  // Fetch competitors for this user
  const { data: comps } = await supabase
    .from("competitors")
    .select("name")
    .eq("business_id", user.business_id);

  const competitorNames = (comps || []).map((c) => c.name);

  const userProfile: UserProfile = {
    embedding_vectors: user.embedding_vectors,
    keywords: user.keywords,
    competitors: competitorNames,
  };

  // Pass 1: Semantic + keyword pre-filter
  const pass1 = await prefilterPost(post, userProfile);

  if (!pass1.passed) return;
  metrics.postsPassedPass1++;

  // Pass 2: LLM relevance scoring (rate limited)
  const { relevanceScore, category } = await haikuLimiter(() =>
    scoreRelevance(post, {
      description: user.description,
      icp_description: user.icp_description,
      keywords: user.keywords,
      competitors: competitorNames,
    })
  );

  metrics.postsPassedPass2++;

  // Calculate priority
  const priority = calculatePriority(relevanceScore, post);

  // Below threshold — don't create alert
  if (priority.score < 0.2) return;

  // Create alert
  const { error: alertError } = await supabase.from("alerts").insert({
    business_id: user.business_id,
    subreddit_id: user.subreddit_id,
    reddit_post_id: post.id,
    post_title: post.title,
    post_body: post.selftext.slice(0, 5000), // Cap body length
    post_author: post.author,
    post_url: `https://reddit.com${post.permalink}`,
    post_created_at: new Date(post.created_utc * 1000).toISOString(),
    upvotes: post.ups,
    num_comments: post.num_comments,
    priority_score: priority.score,
    priority_level: priority.level,
    priority_factors: priority.factors,
    category,
    email_status: (priority.level === "high" || priority.level === "medium") ? "pending" : "skipped",
  });

  if (alertError) {
    // Duplicate post for this business — ignore
    if (alertError.code === "23505") return;
    console.error("[scanner] Alert insert failed:", alertError);
    metrics.errors++;
    return;
  }

  metrics.alertsCreated++;
  console.log(
    `[scanner] Alert: r/${post.subreddit} "${post.title.slice(0, 50)}..." ` +
      `→ ${priority.level} (${priority.score}) [${category}]`
  );

  // Send email for high and medium priority alerts
  if (priority.level === "high" || priority.level === "medium") {
    const minutesAgo = Math.floor((Date.now() - post.created_utc * 1000) / 60000);
    const timeAgo = minutesAgo < 60 ? `${minutesAgo}m ago` : `${Math.floor(minutesAgo / 60)}h ago`;

    const emailData: AlertEmailData = {
      postTitle: post.title,
      postUrl: `https://reddit.com${post.permalink}`,
      subreddit: post.subreddit,
      category,
      priorityLevel: priority.level,
      priorityScore: priority.score,
      upvotes: post.ups,
      numComments: post.num_comments,
      postBody: post.selftext?.slice(0, 300),
      timeAgo,
    };

    const emailSent = await sendAlertEmail(user.email, emailData);

    // Update email status on the alert
    if (emailSent) {
      await supabase.from("alerts").update({
        email_status: "sent",
        email_sent_at: new Date().toISOString(),
      }).eq("reddit_post_id", post.id).eq("business_id", user.business_id);

      await supabase.from("event_logs").insert({
        user_id: user.user_id,
        business_id: user.business_id,
        event_type: "email.sent",
        event_data: { alert_post_id: post.id, priority_level: priority.level },
        source: "cron",
      });

      console.log(`[scanner] Email sent to ${user.email} for "${post.title.slice(0, 50)}..."`);
    } else {
      await supabase.from("alerts").update({
        email_status: "failed",
      }).eq("reddit_post_id", post.id).eq("business_id", user.business_id);

      await supabase.from("event_logs").insert({
        user_id: user.user_id,
        business_id: user.business_id,
        event_type: "email.failed",
        event_data: { alert_post_id: post.id, error: "SES send failed" },
        source: "cron",
      });
    }
  }

  // Log the event
  await supabase.from("event_logs").insert({
    user_id: user.user_id,
    business_id: user.business_id,
    event_type: "priority.calculated",
    event_data: {
      alert_post_id: post.id,
      factors: priority.factors,
      total: priority.score,
      level: priority.level,
      category,
      pass1_score: pass1.pass1Score,
    },
    source: "cron",
  });
}
