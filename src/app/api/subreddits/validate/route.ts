import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/**
 * Validate that a subreddit exists on Reddit.
 * Uses Reddit's public JSON API (no OAuth needed).
 *
 * Reddit API response codes:
 *   302 → non-existent subreddit (redirects to search)
 *   404 → banned or removed subreddit
 *   403 → quarantined or private (body has "reason" field)
 *   200 → exists (check kind="t5" and data.over18)
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
    // Try multiple User-Agent strings — Reddit blocks some cloud IPs with generic UAs
    const userAgents = [
      "Mozilla/5.0 (compatible; AreteBot/1.0; +https://getarete.co)",
      "Arete/1.0 (subreddit-validation; contact: antriksh@getarete.co)",
    ];

    let response: Response | null = null;
    for (const ua of userAgents) {
      response = await fetch(
        `https://www.reddit.com/r/${cleanName}/about.json`,
        {
          headers: {
            "User-Agent": ua,
            "Accept": "application/json",
          },
          redirect: "manual",
          signal: AbortSignal.timeout(8000),
        }
      );
      // If we got a real response (not 403 from IP block), use it
      if (response.status !== 403) break;
      // For 403, check if it's a real restriction vs IP block
      try {
        const body403 = await response.clone().json();
        if (body403?.reason === "quarantined" || body403?.reason === "private") break; // Real restriction
      } catch {
        // 403 without JSON body = likely IP block, try next UA
      }
    }

    if (!response) {
      return NextResponse.json({
        valid: false,
        reason: "Could not reach Reddit. Please try again.",
      });
    }

    // 302/301 = Reddit redirects to search → subreddit does not exist
    if (response.status === 302 || response.status === 301) {
      return NextResponse.json({
        valid: false,
        reason: `r/${cleanName} does not exist. Please check the spelling and try again.`,
      });
    }

    // 404 = subreddit has been banned or permanently removed by Reddit
    if (response.status === 404) {
      return NextResponse.json({
        valid: false,
        reason: `r/${cleanName} has been banned or removed by Reddit and cannot be monitored.`,
      });
    }

    // 403 = quarantined, private, or IP-blocked by Reddit
    if (response.status === 403) {
      // Try to parse the body to distinguish quarantined vs private
      try {
        const body = await response.json();
        if (body?.reason === "quarantined") {
          return NextResponse.json({
            valid: false,
            reason: `r/${cleanName} is quarantined by Reddit. Quarantined subreddits cannot be monitored.`,
          });
        }
        if (body?.reason === "private") {
          return NextResponse.json({
            valid: false,
            reason: `r/${cleanName} is a private subreddit. Private subreddits cannot be monitored.`,
          });
        }
      } catch {
        // Could not parse body — likely an IP block, not a real restriction
      }

      // Fallback: try fetching /new.json to see if the subreddit is actually readable
      try {
        const fallbackRes = await fetch(
          `https://www.reddit.com/r/${cleanName}/new.json?limit=1`,
          {
            headers: {
              "User-Agent": "Mozilla/5.0 (compatible; AreteBot/1.0; +https://getarete.co)",
              "Accept": "application/json",
            },
            redirect: "manual",
            signal: AbortSignal.timeout(8000),
          }
        );
        if (fallbackRes.ok) {
          const fallbackData = await fallbackRes.json();
          if (fallbackData?.data?.children?.length >= 0) {
            // Subreddit is readable — the 403 was an IP block on /about.json
            return NextResponse.json({
              valid: true,
              subreddit: {
                name: cleanName,
                subscribers: 0,
                description: "",
              },
            });
          }
        }
      } catch {
        // Fallback also failed
      }

      return NextResponse.json({
        valid: false,
        reason: `r/${cleanName} is restricted and cannot be monitored. It may be private or quarantined.`,
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
        reason: `Could not verify r/${cleanName}. Reddit returned an unexpected response. Please try again.`,
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

    // NSFW check — block NSFW subreddits
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
  } catch {
    return NextResponse.json({
      valid: false,
      reason: "Could not reach Reddit to verify this subreddit. Please check your connection and try again.",
    });
  }
}
