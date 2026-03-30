/**
 * First-Scan API — fires off the worker's first-scan and returns immediately.
 * The worker runs the scan in the background. The frontend polls /api/alerts.
 *
 * This is fire-and-forget because Vercel's serverless timeout (10-15s) is
 * shorter than the scan duration (~30-45s with nano processing 75 posts).
 */

import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function POST() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const workerUrl = process.env.WORKER_URL;
  const workerSecret = process.env.WORKER_WEBHOOK_SECRET;

  if (!workerUrl || !workerSecret) {
    return new Response(JSON.stringify({ error: "Worker not configured" }), { status: 503 });
  }

  try {
    // Fire-and-forget: tell worker to start scanning, don't wait for completion
    // Use AbortController to not wait for the response body
    const controller = new AbortController();

    fetch(`${workerUrl}/first-scan`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${workerSecret}`,
      },
      body: JSON.stringify({ user_id: user.id }),
      signal: controller.signal,
    }).catch(() => {
      // Ignore — we don't wait for the response
    });

    // Give the request 500ms to reach the worker, then abort the connection
    setTimeout(() => controller.abort(), 500);

    return new Response(
      JSON.stringify({ status: "scanning", message: "Scan started. Poll /api/alerts for results." }),
      { status: 202, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("First scan trigger error:", error);
    return new Response(
      JSON.stringify({ error: "Could not reach worker" }),
      { status: 502 }
    );
  }
}
