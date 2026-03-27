import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
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

  // Use admin client for reads — avoids RLS issues on server-side API routes
  const admin = createAdminClient();

  const { data: userData } = await admin
    .from("users")
    .select("plan_tier, trial_started_at, trial_ends_at, notification_preferences")
    .eq("id", user.id)
    .single();

  const { data: business } = await admin
    .from("businesses")
    .select("name, description, icp_description, keywords, website_url")
    .eq("user_id", user.id)
    .single();

  const businessId = business ? (await admin.from("businesses").select("id").eq("user_id", user.id).single()).data?.id : null;

  const { data: competitors } = await admin
    .from("competitors")
    .select("id, name, source")
    .eq("business_id", businessId || "")
    .order("created_at");

  const { data: subreddits } = await admin
    .from("monitored_subreddits")
    .select("id, subreddit_name, status, source")
    .eq("business_id", businessId || "")
    .eq("is_active", true)
    .order("created_at");

  const { data: creditBalance } = await admin
    .from("credit_balances")
    .select("balance, lifetime_used, last_reset_at")
    .eq("user_id", user.id)
    .single();

  return NextResponse.json({
    user: { email: user.email, ...userData },
    business,
    competitors: competitors || [],
    subreddits: subreddits || [],
    credits: creditBalance || { balance: 0, lifetime_used: 0, last_reset_at: null },
  });
}

export async function PATCH(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const body = await request.json();
  const { section } = body;

  const { data: business } = await admin
    .from("businesses")
    .select("id")
    .eq("user_id", user.id)
    .single();

  if (!business) return NextResponse.json({ error: "No business" }, { status: 404 });

  if (section === "profile") {
    const { name, description, icp_description, keywords } = body;
    const { error } = await admin
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
    const { data: competitor, error } = await admin
      .from("competitors")
      .insert({ business_id: business.id, name, source: "manual" })
      .select("id")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, competitor });
  }

  if (section === "remove_competitor") {
    const { competitor_id } = body;
    const { error } = await admin.from("competitors").delete().eq("id", competitor_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (section === "add_subreddit") {
    const { name } = body;
    // Check for duplicate (case-insensitive)
    const { data: existing } = await admin
      .from("monitored_subreddits")
      .select("id, is_active")
      .eq("business_id", business.id)
      .ilike("subreddit_name", name)
      .limit(1);

    if (existing && existing.length > 0) {
      if (!existing[0].is_active) {
        // Re-activate previously removed subreddit
        const { error } = await supabase
          .from("monitored_subreddits")
          .update({ is_active: true, status: "active" })
          .eq("id", existing[0].id);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ ok: true, subreddit: { id: existing[0].id } });
      }
      return NextResponse.json({ error: "Subreddit already monitored" }, { status: 409 });
    }

    const { data: subreddit, error } = await admin
      .from("monitored_subreddits")
      .insert({ business_id: business.id, subreddit_name: name, source: "manual" })
      .select("id")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, subreddit });
  }

  if (section === "remove_subreddit") {
    const { subreddit_id } = body;
    const { error } = await admin
      .from("monitored_subreddits")
      .update({ is_active: false })
      .eq("id", subreddit_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (body.section === "notifications") {
    const { email_enabled, email_priorities } = body;
    const { error } = await admin
      .from("users")
      .update({
        notification_preferences: {
          email_enabled: email_enabled ?? true,
          email_priorities: email_priorities || ["high", "medium"],
        },
      })
      .eq("id", user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown section" }, { status: 400 });
}
