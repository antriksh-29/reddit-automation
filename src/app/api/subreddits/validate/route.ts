import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/**
 * Validate that a subreddit exists on Reddit.
 * Uses api.reddit.com (not www.reddit.com) because Reddit blocks
 * Vercel/cloud IPs on www.reddit.com with 403 responses.
 *
 * api.reddit.com response codes:
 *   302 → non-existent subreddit (redirects to search)
 *   404 → banned or removed (body: {"reason": "banned"})
 *   403 → quarantined or private (body: {"reason": "quarantined"/"private"})
 *   200 → exists (kind="t5" with subreddit data)
 */
export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { name } = await request.json();

  if (!name || typeof name !== "string") {
    return NextResponse.json({ error: "Subreddit name required" }, { status: 400 });
  }

  const cleanName = name.replace(/^r\//, "").trim().toLowerCase();

  if (!cleanName || !/^[a-zA-Z0-9_]+$/.test(cleanName)) {
    return NextResponse.json({
      valid: false,
      reason: "Invalid subreddit name. Only letters, numbers, and underscores are allowed.",
    });
  }

  try {
    // Use api.reddit.com — it works from cloud IPs where www.reddit.com returns 403
    const response = await fetch(
      `https://api.reddit.com/r/${cleanName}/about`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; AreteBot/1.0; +https://getarete.co)",
          "Accept": "application/json",
        },
        redirect: "manual",
        signal: AbortSignal.timeout(10000),
      }
    );

    // 302/301 = Reddit redirects to search → subreddit does not exist
    if (response.status === 302 || response.status === 301) {
      return NextResponse.json({
        valid: false,
        reason: `r/${cleanName} does not exist. Please check the spelling and try again.`,
      });
    }

    // 404 = subreddit has been banned or permanently removed
    if (response.status === 404) {
      let banReason = "banned or removed";
      try {
        const body = await response.json();
        if (body?.reason) banReason = body.reason;
      } catch {}
      return NextResponse.json({
        valid: false,
        reason: `r/${cleanName} has been ${banReason} by Reddit and cannot be monitored.`,
      });
    }

    // 403 = quarantined or private
    if (response.status === 403) {
      let restrictReason = "restricted";
      try {
        const body = await response.json();
        if (body?.reason === "quarantined") restrictReason = "quarantined";
        if (body?.reason === "private") restrictReason = "private";
      } catch {}
      return NextResponse.json({
        valid: false,
        reason: `r/${cleanName} is ${restrictReason} by Reddit and cannot be monitored.`,
      });
    }

    // 429 = rate limited
    if (response.status === 429) {
      return NextResponse.json({
        valid: false,
        reason: "Reddit is temporarily rate-limiting our requests. Please wait a moment and try again.",
      });
    }

    // Other non-200 codes
    if (!response.ok) {
      return NextResponse.json({
        valid: false,
        reason: `Could not verify r/${cleanName}. Reddit returned status ${response.status}. Please try again.`,
      });
    }

    // 200 — parse the response
    const data = await response.json();
    const sub = data?.data;

    // Reddit sometimes returns 200 with a different kind for non-existent subs
    if (!sub || data?.kind !== "t5") {
      return NextResponse.json({
        valid: false,
        reason: `r/${cleanName} does not exist. Please check the spelling and try again.`,
      });
    }

    // NSFW check
    if (sub.over18) {
      return NextResponse.json({
        valid: false,
        reason: `r/${cleanName} is an NSFW subreddit and cannot be monitored on this platform.`,
      });
    }

    return NextResponse.json({
      valid: true,
      subreddit: {
        name: sub.display_name || cleanName,
        subscribers: sub.subscribers || 0,
        description: sub.public_description || "",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({
      valid: false,
      reason: `Could not reach Reddit to verify this subreddit (${message}). Please try again.`,
    });
  }
}
