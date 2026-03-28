/**
 * First-Scan API — proxies to the worker's /first-scan SSE endpoint.
 * The worker has MiniLM loaded in memory for full Pass 1 quality.
 * This route just forwards the SSE stream from worker to frontend.
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
    // Call worker's first-scan endpoint
    const workerRes = await fetch(`${workerUrl}/first-scan`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${workerSecret}`,
      },
      body: JSON.stringify({ user_id: user.id }),
    });

    if (!workerRes.ok) {
      return new Response(
        JSON.stringify({ error: "Worker scan failed" }),
        { status: 502 }
      );
    }

    // Forward the SSE stream from worker to client
    return new Response(workerRes.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("First scan proxy error:", error);
    return new Response(
      JSON.stringify({ error: "Could not reach worker" }),
      { status: 502 }
    );
  }
}
