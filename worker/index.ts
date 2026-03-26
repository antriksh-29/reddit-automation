/**
 * Worker Entry Point — runs on Railway (or locally via pnpm worker:dev).
 * Ref: TECH-SPEC.md §7 (Worker Design)
 *
 * STARTUP SEQUENCE:
 *   1. Load sentence-transformer model (MiniLM-L6-v2)
 *   2. Start HTTP server (health + scan-now webhook)
 *   3. Run initial scan immediately
 *   4. Start 15-min scan interval
 *
 * ENDPOINTS:
 *   GET  /health   → { status, model_loaded, last_scan, uptime }
 *   POST /scan-now → trigger immediate scan (shared secret auth)
 */

import express from "express";
import { loadModel, isModelLoaded } from "./embeddings.js";
import {
  runScanCycle,
  isScanInProgress,
  getLastScanTime,
  getLastScanMetrics,
} from "./scanner.js";

const PORT = Number(process.env.PORT) || 3001;
const SCAN_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const WEBHOOK_SECRET = process.env.WORKER_WEBHOOK_SECRET || "dev-secret";

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

  // 2. Start HTTP server
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
    if (authHeader !== `Bearer ${WEBHOOK_SECRET}`) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    if (isScanInProgress()) {
      res.json({ status: "already_running" });
      return;
    }

    // Trigger scan async — don't wait for it
    runScanCycle().catch((err) =>
      console.error("[worker] Scan-now cycle failed:", err)
    );

    res.json({ status: "triggered" });
  });

  app.listen(PORT, () => {
    console.log(`[worker] Health server listening on port ${PORT}`);
  });

  // 3. Run initial scan immediately
  console.log("[worker] Running initial scan...");
  try {
    await runScanCycle();
  } catch (error) {
    console.error("[worker] Initial scan failed:", error);
    // Don't exit — still run on interval
  }

  // 4. Start scan interval
  console.log(`[worker] Starting scan interval (every ${SCAN_INTERVAL_MS / 60000} min)`);
  setInterval(async () => {
    try {
      await runScanCycle();
    } catch (error) {
      console.error("[worker] Scan cycle failed:", error);
    }
  }, SCAN_INTERVAL_MS);
}

main().catch((error) => {
  console.error("[worker] Fatal error:", error);
  process.exit(1);
});
