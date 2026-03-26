import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/alerts — Fetch alerts for the authenticated user's business.
 * Ref: PRODUCT-SPEC.md §5.2 (Dashboard)
 *
 * Query params:
 *   - view: "new" | "seen" | "all" (default: "all")
 *   - priority: "high" | "medium" | "low" | "all" (default: "all")
 *   - category: one of 5 categories | "all" (default: "all")
 *   - subreddit: subreddit name | "all" (default: "all")
 *   - sort: "priority" | "newest" | "comments" (default: "priority")
 *   - limit: number (default: 50)
 *   - offset: number (default: 0)
 */
export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get business
  const { data: business } = await supabase
    .from("businesses")
    .select("id")
    .eq("user_id", user.id)
    .single();

  if (!business) {
    return NextResponse.json({ error: "No business found" }, { status: 404 });
  }

  const params = request.nextUrl.searchParams;
  const view = params.get("view") || "all";
  const priority = params.get("priority") || "all";
  const category = params.get("category") || "all";
  const subreddit = params.get("subreddit") || "all";
  const sort = params.get("sort") || "priority";
  const limit = parseInt(params.get("limit") || "50");
  const offset = parseInt(params.get("offset") || "0");

  let query = supabase
    .from("alerts")
    .select(
      `
      id, post_title, post_body, post_author, post_url, post_created_at,
      upvotes, num_comments, priority_score, priority_level, priority_factors,
      category, is_seen, seen_at, created_at,
      monitored_subreddits!inner(subreddit_name)
    `
    )
    .eq("business_id", business.id);

  // Filters
  if (view === "new") query = query.eq("is_seen", false);
  if (view === "seen") query = query.eq("is_seen", true);
  if (priority !== "all") query = query.eq("priority_level", priority);
  if (category !== "all") query = query.eq("category", category);
  if (subreddit !== "all") {
    query = query.eq("monitored_subreddits.subreddit_name", subreddit);
  }

  // Sort
  if (sort === "priority") {
    query = query.order("priority_score", { ascending: false });
  } else if (sort === "newest") {
    query = query.order("post_created_at", { ascending: false });
  } else if (sort === "comments") {
    query = query.order("num_comments", { ascending: false });
  }

  query = query.range(offset, offset + limit - 1);

  const { data: alerts, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Flatten subreddit name
  const formatted = (alerts || []).map((a: Record<string, unknown>) => {
    const sub = a.monitored_subreddits as { subreddit_name: string } | null;
    return {
      ...a,
      subreddit_name: sub?.subreddit_name || "unknown",
      monitored_subreddits: undefined,
    };
  });

  return NextResponse.json({ alerts: formatted });
}

/**
 * PATCH /api/alerts — Mark alerts as seen.
 * Body: { alert_ids: string[] }
 */
export async function PATCH(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { alert_ids } = await request.json();
  if (!Array.isArray(alert_ids) || alert_ids.length === 0) {
    return NextResponse.json({ error: "alert_ids required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("alerts")
    .update({ is_seen: true, seen_at: new Date().toISOString() })
    .in("id", alert_ids)
    .eq("is_seen", false);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
