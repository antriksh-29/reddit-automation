import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/settings — Fetch user's business profile + settings.
 * PATCH /api/settings — Update business profile fields.
 * Ref: PRODUCT-SPEC.md §5.5
 */
export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: userData } = await supabase
    .from("users")
    .select("plan_tier, trial_started_at, trial_ends_at")
    .eq("id", user.id)
    .single();

  const { data: business } = await supabase
    .from("businesses")
    .select("*")
    .eq("user_id", user.id)
    .single();

  const { data: competitors } = await supabase
    .from("competitors")
    .select("id, name, source")
    .eq("business_id", business?.id || "")
    .order("created_at");

  const { data: subreddits } = await supabase
    .from("monitored_subreddits")
    .select("id, subreddit_name, status, source")
    .eq("business_id", business?.id || "")
    .eq("is_active", true)
    .order("created_at");

  return NextResponse.json({
    user: { email: user.email, ...userData },
    business,
    competitors: competitors || [],
    subreddits: subreddits || [],
  });
}

export async function PATCH(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { section } = body;

  const { data: business } = await supabase
    .from("businesses")
    .select("id")
    .eq("user_id", user.id)
    .single();

  if (!business) return NextResponse.json({ error: "No business" }, { status: 404 });

  if (section === "profile") {
    const { name, description, icp_description, keywords } = body;
    const { error } = await supabase
      .from("businesses")
      .update({
        name,
        description,
        icp_description,
        keywords,
        updated_at: new Date().toISOString(),
      })
      .eq("id", business.id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (section === "add_competitor") {
    const { name } = body;
    const { error } = await supabase
      .from("competitors")
      .insert({ business_id: business.id, name, source: "manual" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (section === "remove_competitor") {
    const { competitor_id } = body;
    const { error } = await supabase.from("competitors").delete().eq("id", competitor_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (section === "add_subreddit") {
    const { name } = body;
    const { error } = await supabase
      .from("monitored_subreddits")
      .insert({ business_id: business.id, subreddit_name: name, source: "manual" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (section === "remove_subreddit") {
    const { subreddit_id } = body;
    const { error } = await supabase
      .from("monitored_subreddits")
      .update({ is_active: false })
      .eq("id", subreddit_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown section" }, { status: 400 });
}
