import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/**
 * Validate a subreddit exists on Reddit.
 *
 * Proxies to the Railway worker because Reddit blocks Vercel's IPs.
 * The worker runs on Railway with different IPs that Reddit doesn't block.
 *
 * Flow: Browser → Vercel API → Railway Worker → Reddit API → response back
 */
export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { name } = await request.json();

  if (!name || typeof name !== "string") {
    return NextResponse.json({ valid: false, reason: "Subreddit name required" });
  }

  const workerUrl = process.env.WORKER_URL;
  const workerSecret = process.env.WORKER_WEBHOOK_SECRET;

  if (!workerUrl || !workerSecret) {
    return NextResponse.json({
      valid: false,
      reason: "Service configuration error. Please try again later.",
    });
  }

  try {
    const res = await fetch(`${workerUrl}/validate-subreddit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${workerSecret}`,
      },
      body: JSON.stringify({ name }),
      signal: AbortSignal.timeout(15000),
    });

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({
      valid: false,
      reason: `Could not verify subreddit (${message}). Please try again.`,
    });
  }
}
