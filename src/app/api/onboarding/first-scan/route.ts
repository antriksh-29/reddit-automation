/**
 * First-Scan API — triggers the worker's first-scan and waits for completion.
 * Returns the number of alerts created.
 *
 * Vercel function timeout: 60s (free) / 300s (pro).
 * First scan with nano takes ~30-45s for 75 posts — fits within 60s.
 *
 * The worker's /first-scan endpoint streams SSE events. We consume the
 * stream server-side, extract the final result, and return a simple JSON.
 */

import { createServerSupabaseClient } from "@/lib/supabase/server";

// Vercel function config — max duration 60s
export const maxDuration = 60;

export async function POST() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
    });
  }

  const workerUrl = process.env.WORKER_URL;
  const workerSecret = process.env.WORKER_WEBHOOK_SECRET;

  if (!workerUrl || !workerSecret) {
    return new Response(JSON.stringify({ error: "Worker not configured" }), {
      status: 503,
    });
  }

  try {
    // Call worker and wait for the SSE stream to complete
    const workerRes = await fetch(`${workerUrl}/first-scan`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${workerSecret}`,
      },
      body: JSON.stringify({ user_id: user.id }),
    });

    if (!workerRes.ok) {
      const errText = await workerRes.text().catch(() => "unknown");
      console.error(`[first-scan] Worker returned ${workerRes.status}: ${errText.substring(0, 200)}`);
      return new Response(
        JSON.stringify({ error: "Worker scan failed", status: "error" }),
        { status: 502 }
      );
    }

    // Consume the SSE stream to get the final result
    const body = await workerRes.text();

    // Parse SSE events to find the "complete" event
    let alertsCreated = 0;
    const lines = body.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] === "event: complete" && i + 1 < lines.length) {
        const dataLine = lines[i + 1];
        if (dataLine.startsWith("data: ")) {
          try {
            const data = JSON.parse(dataLine.slice(6));
            alertsCreated = data.alertsCreated || 0;
          } catch {
            // ignore parse error
          }
        }
      }
    }

    return new Response(
      JSON.stringify({ status: "complete", alertsCreated }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("First scan error:", error);
    return new Response(
      JSON.stringify({ error: "Could not complete scan", status: "error" }),
      { status: 502 }
    );
  }
}
