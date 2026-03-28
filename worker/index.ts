/**
 * Worker Entry Point — runs on Railway (or locally via pnpm worker:dev).
 * Ref: TECH-SPEC.md §7 (Worker Design)
 *
 * STARTUP SEQUENCE:
 *   1. Load sentence-transformer model (MiniLM-L6-v2)
 *   2. Backfill embeddings for any businesses missing them
 *   3. Start HTTP server (health + scan-now + generate-embeddings webhooks)
 *   4. Run initial scan immediately
 *   5. Start 30-min scan interval
 *
 * ENDPOINTS:
 *   GET  /health              → { status, model_loaded, last_scan, uptime }
 *   POST /scan-now            → trigger immediate scan (shared secret auth)
 *   POST /generate-embeddings → generate embeddings for a business (from onboarding)
 */

import express from "express";
import { loadModel, isModelLoaded } from "./embeddings.js";
import { backfillEmbeddings, generateAndStoreEmbedding } from "./generate-embeddings.js";
import { runFirstScan } from "./first-scan.js";
import {
  runScanCycle,
  isScanInProgress,
  getLastScanTime,
  getLastScanMetrics,
} from "./scanner.js";

const PORT = Number(process.env.PORT) || 3001;
const SCAN_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const WEBHOOK_SECRET = process.env.WORKER_WEBHOOK_SECRET;
if (!WEBHOOK_SECRET && process.env.NODE_ENV === "production") {
  console.error("[worker] FATAL: WORKER_WEBHOOK_SECRET is not set in production");
  process.exit(1);
}
const effectiveSecret = WEBHOOK_SECRET || "dev-secret-local-only";

const startedAt = new Date();

async function main() {
  console.log("[worker] Starting Arete Scanner Worker...");

  // 1. Load ML model
  try {
    await loadModel();
    console.log("[worker] ML model loaded successfully");
  } catch (error) {
    console.error("[worker] FATAL: Failed to load ML model:", error);
    process.exit(1);
  }

  // 2. Backfill embeddings for businesses that don't have them
  try {
    const backfilled = await backfillEmbeddings();
    if (backfilled > 0) {
      console.log(`[worker] Backfilled embeddings for ${backfilled} businesses`);
    }
  } catch (error) {
    console.error("[worker] Embedding backfill failed (non-fatal):", error);
  }

  // 3. Start HTTP server
  const app = express();
  app.use(express.json());

  // Health endpoint
  app.get("/health", (_req, res) => {
    const metrics = getLastScanMetrics();
    res.json({
      status: "ok",
      model_loaded: isModelLoaded(),
      scan_in_progress: isScanInProgress(),
      last_scan: getLastScanTime()?.toISOString() || null,
      last_scan_metrics: metrics
        ? {
            subreddits: metrics.subredditsScanned,
            posts: metrics.postsFetched,
            alerts: metrics.alertsCreated,
            errors: metrics.errors,
            duration_ms:
              metrics.completedAt.getTime() - metrics.startedAt.getTime(),
          }
        : null,
      uptime_seconds: Math.floor((Date.now() - startedAt.getTime()) / 1000),
    });
  });

  // Scan-now webhook (triggered from Vercel after onboarding)
  app.post("/scan-now", (req, res) => {
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${effectiveSecret}`) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    if (isScanInProgress()) {
      res.json({ status: "already_running" });
      return;
    }

    runScanCycle().catch((err) =>
      console.error("[worker] Scan-now cycle failed:", err)
    );

    res.json({ status: "triggered" });
  });

  // Generate embeddings webhook (triggered from onboarding complete)
  app.post("/generate-embeddings", async (req, res) => {
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${effectiveSecret}`) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const { business_id } = req.body;
    if (!business_id) {
      res.status(400).json({ error: "business_id required" });
      return;
    }

    try {
      await generateAndStoreEmbedding(business_id);
      res.json({ status: "generated" });
    } catch (err) {
      console.error("[worker] Embedding generation failed:", err);
      res.status(500).json({ error: "Failed to generate embeddings" });
    }
  });

  // First scan SSE endpoint (called from onboarding setup page)
  app.post("/first-scan", (req, res) => {
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${effectiveSecret}`) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const { user_id } = req.body;
    if (!user_id) {
      res.status(400).json({ error: "user_id required" });
      return;
    }

    // Set SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    runFirstScan(user_id, res).catch((err) => {
      console.error("[worker] First scan failed:", err);
      res.write(`event: error\ndata: ${JSON.stringify({ message: "Scan failed" })}\n\n`);
      res.end();
    });
  });

  // Validate subreddit endpoint (proxied from Vercel — Reddit blocks Vercel IPs)
  app.post("/validate-subreddit", async (req, res) => {
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${effectiveSecret}`) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const { name } = req.body;
    if (!name || typeof name !== "string") {
      res.status(400).json({ valid: false, reason: "Subreddit name required" });
      return;
    }

    const cleanName = name.replace(/^r\//, "").trim().toLowerCase();
    if (!cleanName || !/^[a-zA-Z0-9_]+$/.test(cleanName)) {
      res.json({ valid: false, reason: "Invalid subreddit name. Only letters, numbers, and underscores." });
      return;
    }

    try {
      // Use the SAME fetch approach as the scanner (which works from Railway).
      // Key: same User-Agent, same endpoint format, same rate-limited approach.
      const fetchUrl = `https://api.reddit.com/r/${cleanName}/new.json?limit=1&raw_json=1`;
      console.log(`[validate] Fetching: ${fetchUrl}`);

      const redditRes = await fetch(fetchUrl, {
        headers: { "User-Agent": "Arete/1.0 (Reddit Lead Intelligence)" },
        redirect: "manual",
        signal: AbortSignal.timeout(10000),
      });

      console.log(`[validate] Response: HTTP ${redditRes.status}, content-type: ${redditRes.headers.get("content-type")}`);

      // 302 = non-existent (redirect to search)
      if (redditRes.status === 302 || redditRes.status === 301) {
        res.json({ valid: false, reason: `r/${cleanName} does not exist. Please check the spelling.` });
        return;
      }

      // 404 = banned or removed
      if (redditRes.status === 404) {
        res.json({ valid: false, reason: `r/${cleanName} has been banned or removed by Reddit.` });
        return;
      }

      // 403 = could be IP block (HTML) or actual restriction (JSON)
      if (redditRes.status === 403) {
        const contentType = redditRes.headers.get("content-type") || "";
        if (contentType.includes("text/html")) {
          // IP block — accept the subreddit anyway, scanner will validate async
          console.warn(`[validate] IP blocked for r/${cleanName} — accepting with async validation`);
          res.json({
            valid: true,
            subreddit: { name: cleanName, subscribers: 0, description: "" },
          });
          return;
        }
        // Actual restriction
        let restrictReason = "restricted";
        try {
          const b = await redditRes.json();
          if (b?.reason === "quarantined") restrictReason = "quarantined";
          if (b?.reason === "private") restrictReason = "private";
        } catch {}
        res.json({ valid: false, reason: `r/${cleanName} is ${restrictReason} and cannot be monitored.` });
        return;
      }

      if (!redditRes.ok) {
        // Unknown error — accept anyway, let scanner validate
        console.warn(`[validate] HTTP ${redditRes.status} for r/${cleanName} — accepting with async validation`);
        res.json({
          valid: true,
          subreddit: { name: cleanName, subscribers: 0, description: "" },
        });
        return;
      }

      const data = await redditRes.json();
      if (data?.kind !== "Listing") {
        res.json({ valid: false, reason: `r/${cleanName} does not exist.` });
        return;
      }

      // Success — subreddit exists
      const children = data?.data?.children || [];
      const displayName = children.length > 0
        ? children[0]?.data?.subreddit || cleanName
        : cleanName;

      res.json({
        valid: true,
        subreddit: { name: displayName, subscribers: 0, description: "" },
      });
    } catch (err) {
      // Network error — accept anyway, let scanner validate async
      console.error(`[worker] Subreddit validation error for ${cleanName}:`, err);
      res.json({
        valid: true,
        subreddit: { name: cleanName, subscribers: 0, description: "" },
      });
    }
  });

  // Fetch subreddit rules endpoint (proxied from Vercel — Reddit blocks Vercel IPs)
  app.post("/fetch-rules", async (req, res) => {
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${effectiveSecret}`) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const { subreddit } = req.body;
    if (!subreddit || typeof subreddit !== "string") {
      res.status(400).json({ error: "subreddit required" });
      return;
    }

    try {
      const rulesUrl = `https://api.reddit.com/r/${subreddit}/about/rules.json?raw_json=1`;
      const redditRes = await fetch(rulesUrl, {
        headers: { "User-Agent": "Arete/1.0 (Reddit Lead Intelligence)" },
        redirect: "manual",
        signal: AbortSignal.timeout(10000),
      });

      if (!redditRes.ok) {
        res.json({ rules: "No specific rules available." });
        return;
      }

      const data = await redditRes.json();
      const rulesList = data.rules || [];
      if (rulesList.length === 0) {
        res.json({ rules: "No specific rules available." });
        return;
      }

      const rules = rulesList.map((r: { short_name: string; description: string }) =>
        `- ${r.short_name}: ${(r.description || "No description").slice(0, 150)}`
      ).join("\n");

      res.json({ rules });
    } catch {
      res.json({ rules: "No specific rules available." });
    }
  });

  // Fetch Reddit thread endpoint (proxied from Vercel — Reddit blocks Vercel IPs)
  // Used by thread analysis and draft response features
  app.post("/fetch-thread", async (req, res) => {
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${effectiveSecret}`) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const { url } = req.body;
    if (!url || typeof url !== "string") {
      res.status(400).json({ error: "URL required" });
      return;
    }

    try {
      // Clean the URL and convert to api.reddit.com JSON endpoint
      let cleanUrl = url.split("?")[0].replace(/\/$/, "");
      cleanUrl = cleanUrl.replace("://www.reddit.com", "://api.reddit.com");
      cleanUrl = cleanUrl.replace("://reddit.com", "://api.reddit.com");
      cleanUrl = cleanUrl.replace("://old.reddit.com", "://api.reddit.com");

      if (!cleanUrl.includes(".json")) {
        cleanUrl += ".json";
      }
      cleanUrl += "?raw_json=1&limit=100";

      console.log(`[fetch-thread] Fetching: ${cleanUrl}`);

      const redditRes = await fetch(cleanUrl, {
        headers: { "User-Agent": "Arete/1.0 (Reddit Lead Intelligence)" },
        redirect: "manual",
        signal: AbortSignal.timeout(15000),
      });

      console.log(`[fetch-thread] Response: HTTP ${redditRes.status}`);

      if (redditRes.status === 302 || redditRes.status === 301) {
        res.status(404).json({ error: "Thread not found" });
        return;
      }

      if (redditRes.status === 403) {
        const contentType = redditRes.headers.get("content-type") || "";
        if (contentType.includes("text/html")) {
          res.status(503).json({ error: "Reddit is temporarily blocking requests. Please try again in a few minutes." });
          return;
        }
        res.status(403).json({ error: "Thread is restricted or quarantined" });
        return;
      }

      if (!redditRes.ok) {
        res.status(redditRes.status).json({ error: `Reddit returned ${redditRes.status}` });
        return;
      }

      const data = await redditRes.json();

      // Parse thread data
      if (!Array.isArray(data) || data.length < 2) {
        res.status(422).json({ error: "Invalid thread data from Reddit" });
        return;
      }

      const postData = data[0]?.data?.children?.[0]?.data;
      if (!postData) {
        res.status(404).json({ error: "Thread not found" });
        return;
      }

      // Extract comments recursively
      const comments: { author: string; body: string; score: number; depth: number }[] = [];
      function extractComments(children: unknown[], depth = 0) {
        if (!Array.isArray(children)) return;
        for (const child of children) {
          const c = (child as { kind: string; data: Record<string, unknown> });
          if (c.kind !== "t1") continue;
          const d = c.data;
          if (d.author && d.body) {
            comments.push({
              author: d.author as string,
              body: d.body as string,
              score: (d.score as number) || 0,
              depth,
            });
          }
          if (d.replies && typeof d.replies === "object") {
            const replies = (d.replies as { data?: { children?: unknown[] } });
            if (replies?.data?.children) {
              extractComments(replies.data.children, depth + 1);
            }
          }
        }
      }

      extractComments(data[1]?.data?.children || []);

      res.json({
        thread: {
          title: postData.title,
          body: postData.selftext || "",
          author: postData.author,
          subreddit: postData.subreddit,
          url: `https://reddit.com${postData.permalink}`,
          upvotes: postData.ups || 0,
          num_comments: postData.num_comments || 0,
          created_utc: postData.created_utc,
        },
        comments,
      });
    } catch (err) {
      console.error("[fetch-thread] Error:", err);
      res.status(500).json({ error: "Failed to fetch thread from Reddit" });
    }
  });

  app.listen(PORT, () => {
    console.log(`[worker] Health server listening on port ${PORT}`);
  });

  // 4. Run initial scan immediately
  console.log("[worker] Running initial scan...");
  try {
    await runScanCycle();
  } catch (error) {
    console.error("[worker] Initial scan failed:", error);
  }

  // 5. Start scan interval
  console.log(`[worker] Starting scan interval (every ${SCAN_INTERVAL_MS / 60000} min)`);
  setInterval(async () => {
    try {
      await runScanCycle();
    } catch (error) {
      console.error("[worker] Scan cycle failed:", error);
    }
  }, SCAN_INTERVAL_MS);

  // 6. Monthly credit reset check (runs every scan cycle)
  // Also runs once on startup
  await checkMonthlyCreditResets();
  setInterval(async () => {
    try {
      await checkMonthlyCreditResets();
    } catch (error) {
      console.error("[worker] Credit reset check failed:", error);
    }
  }, SCAN_INTERVAL_MS);
}

/**
 * Monthly credit reset for Growth plan users.
 * Checks all growth users whose last_reset_at is >30 days ago
 * and resets their credits to 250.
 */
async function checkMonthlyCreditResets() {
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();

  // Find growth users whose credits haven't been reset in 30+ days
  const { data: users } = await supabase
    .from("users")
    .select("id")
    .eq("plan_tier", "growth");

  if (!users || users.length === 0) return;

  for (const user of users) {
    const { data: balance } = await supabase
      .from("credit_balances")
      .select("balance, last_reset_at")
      .eq("user_id", user.id)
      .single();

    if (!balance) continue;

    // Check if last reset was >30 days ago
    if (balance.last_reset_at && new Date(balance.last_reset_at) > new Date(thirtyDaysAgo)) {
      continue; // Already reset recently
    }

    // Reset credits to 250
    const { error } = await supabase
      .from("credit_balances")
      .update({
        balance: 250.0,
        lifetime_used: 0,
        last_reset_at: new Date().toISOString(),
      })
      .eq("user_id", user.id);

    if (error) {
      console.error(`[worker] Credit reset failed for user ${user.id}:`, error.message);
      continue;
    }

    // Log the transaction
    await supabase.from("credit_transactions").insert({
      user_id: user.id,
      action_type: "monthly_reset",
      credits_used: -(250.0 - balance.balance), // Negative = added
      balance_after: 250.0,
      tokens_consumed: 0,
    });

    console.log(`[worker] Monthly credit reset: user ${user.id} → 250 credits`);

    await supabase.from("event_logs").insert({
      user_id: user.id,
      event_type: "credits.monthly_reset",
      event_data: { previous_balance: balance.balance, new_balance: 250.0 },
      source: "cron",
    });
  }
}

main().catch((error) => {
  console.error("[worker] Fatal error:", error);
  process.exit(1);
});
