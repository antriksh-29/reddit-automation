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
      const redditRes = await fetch(`https://www.reddit.com/r/${cleanName}/about.json?raw_json=1`, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; AreteBot/1.0; +https://getarete.co)" },
        redirect: "manual",
        signal: AbortSignal.timeout(10000),
      });

      // 302/301 = non-existent (redirect to search)
      if (redditRes.status === 302 || redditRes.status === 301) {
        res.json({ valid: false, reason: `r/${cleanName} does not exist. Please check the spelling.` });
        return;
      }

      // 404 = banned
      if (redditRes.status === 404) {
        let detail = "banned or removed";
        try { const b = await redditRes.json(); if (b?.reason) detail = b.reason; } catch {}
        res.json({ valid: false, reason: `r/${cleanName} has been ${detail} by Reddit.` });
        return;
      }

      // 403 = quarantined or private
      if (redditRes.status === 403) {
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
        res.json({ valid: false, reason: `Could not verify r/${cleanName}. Reddit returned ${redditRes.status}.` });
        return;
      }

      const data = await redditRes.json();
      if (data?.kind !== "t5" || !data?.data) {
        res.json({ valid: false, reason: `r/${cleanName} does not exist.` });
        return;
      }

      const sub = data.data;
      if (sub.over18) {
        res.json({ valid: false, reason: `r/${cleanName} is NSFW and cannot be monitored.` });
        return;
      }

      res.json({
        valid: true,
        subreddit: {
          name: sub.display_name || cleanName,
          subscribers: sub.subscribers || 0,
          description: sub.public_description || "",
        },
      });
    } catch (err) {
      console.error(`[worker] Subreddit validation failed for ${cleanName}:`, err);
      res.json({ valid: false, reason: "Could not reach Reddit. Please try again." });
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
