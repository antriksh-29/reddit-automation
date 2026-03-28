import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/**
 * Validate that a subreddit exists on Reddit.
 *
 * Uses a multi-fallback strategy because Reddit aggressively blocks
 * cloud/Vercel IPs with 403 responses:
 *
 * 1. Try api.reddit.com/r/{name}/about (fastest, works from some IPs)
 * 2. Try old.reddit.com/r/{name}/about.json (less restrictive)
 * 3. Try Reddit search API as final fallback (most reliable from cloud IPs)
 *
 * Response codes from Reddit:
 *   302 → non-existent (redirects to search)
 *   404 → banned or removed
 *   403 → IP block OR quarantined/private (we distinguish using fallbacks)
 *   200 → exists
 */

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

interface SubredditResult {
  valid: boolean;
  name?: string;
  subscribers?: number;
  description?: string;
  reason?: string;
}

/** Attempt 1: api.reddit.com */
async function tryApiReddit(name: string): Promise<SubredditResult | null> {
  try {
    const res = await fetch(`https://api.reddit.com/r/${name}/about`, {
      headers: { "User-Agent": BROWSER_UA, Accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
    });

    if (res.status === 302 || res.status === 301) {
      return { valid: false, reason: `r/${name} does not exist. Please check the spelling.` };
    }
    if (res.status === 404) {
      let detail = "banned or removed";
      try { const b = await res.json(); if (b?.reason) detail = b.reason; } catch {}
      return { valid: false, reason: `r/${name} has been ${detail} by Reddit and cannot be monitored.` };
    }
    if (res.status === 403) {
      // Could be IP block OR actually quarantined/private — check body
      try {
        const b = await res.json();
        if (b?.reason === "quarantined") return { valid: false, reason: `r/${name} is quarantined by Reddit and cannot be monitored.` };
        if (b?.reason === "private") return { valid: false, reason: `r/${name} is a private subreddit and cannot be monitored.` };
      } catch {}
      // No reason field → likely IP block, try fallback
      return null;
    }
    if (res.status === 429) return null; // Rate limited, try fallback
    if (!res.ok) return null; // Unknown error, try fallback

    const data = await res.json();
    if (data?.kind !== "t5" || !data?.data) return null;

    const sub = data.data;
    if (sub.over18) return { valid: false, reason: `r/${name} is an NSFW subreddit and cannot be monitored.` };

    return { valid: true, name: sub.display_name || name, subscribers: sub.subscribers || 0, description: sub.public_description || "" };
  } catch {
    return null; // Timeout or network error, try fallback
  }
}

/** Attempt 2: old.reddit.com */
async function tryOldReddit(name: string): Promise<SubredditResult | null> {
  try {
    const res = await fetch(`https://old.reddit.com/r/${name}/about.json`, {
      headers: { "User-Agent": BROWSER_UA },
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
    });

    if (res.status === 302 || res.status === 301) {
      return { valid: false, reason: `r/${name} does not exist. Please check the spelling.` };
    }
    if (res.status === 404) {
      return { valid: false, reason: `r/${name} has been banned or removed by Reddit.` };
    }
    if (res.status === 403) {
      try {
        const b = await res.json();
        if (b?.reason === "quarantined") return { valid: false, reason: `r/${name} is quarantined by Reddit and cannot be monitored.` };
        if (b?.reason === "private") return { valid: false, reason: `r/${name} is a private subreddit and cannot be monitored.` };
      } catch {}
      return null; // IP block, try search fallback
    }
    if (!res.ok) return null;

    const data = await res.json();
    if (data?.kind !== "t5" || !data?.data) return null;

    const sub = data.data;
    if (sub.over18) return { valid: false, reason: `r/${name} is an NSFW subreddit and cannot be monitored.` };

    return { valid: true, name: sub.display_name || name, subscribers: sub.subscribers || 0, description: sub.public_description || "" };
  } catch {
    return null;
  }
}

/** Attempt 3: Reddit search API (most reliable from cloud IPs) */
async function trySearchApi(name: string): Promise<SubredditResult | null> {
  try {
    const res = await fetch(
      `https://www.reddit.com/subreddits/search.json?q=${encodeURIComponent(name)}&limit=5&raw_json=1`,
      {
        headers: { "User-Agent": BROWSER_UA },
        redirect: "manual",
        signal: AbortSignal.timeout(8000),
      }
    );

    if (!res.ok) return null;

    const data = await res.json();
    const children = data?.data?.children || [];

    // Look for exact name match (case-insensitive)
    const match = children.find(
      (c: { data: { display_name: string } }) =>
        c.data.display_name.toLowerCase() === name.toLowerCase()
    );

    if (!match) {
      // No exact match found — subreddit doesn't exist
      return { valid: false, reason: `r/${name} does not exist. Please check the spelling.` };
    }

    const sub = match.data;

    if (sub.over18) return { valid: false, reason: `r/${name} is an NSFW subreddit and cannot be monitored.` };
    if (sub.quarantine) return { valid: false, reason: `r/${name} is quarantined by Reddit and cannot be monitored.` };
    if (sub.subreddit_type === "private") return { valid: false, reason: `r/${name} is a private subreddit and cannot be monitored.` };

    return {
      valid: true,
      name: sub.display_name || name,
      subscribers: sub.subscribers || 0,
      description: sub.public_description || "",
    };
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

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

  // Try each method in order — return first definitive result
  const result =
    (await tryApiReddit(cleanName)) ??
    (await tryOldReddit(cleanName)) ??
    (await trySearchApi(cleanName));

  if (result) {
    if (result.valid) {
      return NextResponse.json({
        valid: true,
        subreddit: {
          name: result.name,
          subscribers: result.subscribers,
          description: result.description,
        },
      });
    } else {
      return NextResponse.json({ valid: false, reason: result.reason });
    }
  }

  // All methods failed — Reddit is completely blocking us
  return NextResponse.json({
    valid: false,
    reason: "Could not verify this subreddit right now. Reddit may be temporarily blocking our requests. Please try again in a few minutes.",
  });
}
