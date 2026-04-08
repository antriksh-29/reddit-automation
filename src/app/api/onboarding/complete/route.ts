import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { grantCredits } from "@/lib/credits/manager";
import { PLANS } from "@/lib/credits/pricing";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const {
    business_name,
    website_url,
    description,
    icp_description,
    brand_voice,
    keywords,
    competitors,
    subreddits,
  } = body;

  if (!business_name || !description) {
    return NextResponse.json(
      { error: "Business name and description are required" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  try {
    // 1. Create business
    const { data: business, error: bizError } = await admin
      .from("businesses")
      .insert({
        user_id: user.id,
        name: business_name,
        website_url: website_url || null,
        description,
        icp_description: icp_description || null,
        brand_voice: brand_voice || null,
        keywords: keywords || { primary: [], discovery: [] },
      })
      .select("id")
      .single();

    if (bizError) {
      // Duplicate — user already onboarded
      if (bizError.code === "23505") {
        return NextResponse.json(
          { error: "You already have a business profile." },
          { status: 409 }
        );
      }
      throw bizError;
    }

    // 2. Insert competitors
    if (competitors?.length) {
      const competitorRows = competitors.map((c: { name: string; source?: string }) => ({
        business_id: business.id,
        name: c.name,
        source: c.source || "auto_suggested",
      }));
      await admin.from("competitors").insert(competitorRows);
    }

    // 3. Insert monitored subreddits
    if (subreddits?.length) {
      const subRows = subreddits.map((s: { name: string; source?: string }) => ({
        business_id: business.id,
        subreddit_name: s.name.replace(/^r\//, "").toLowerCase(),
        source: s.source || "auto_suggested",
        is_active: true,
        status: "active",
      }));
      await admin.from("monitored_subreddits").insert(subRows);
    }

    // 4. Set trial period (3 days)
    const now = new Date();
    const trialEnd = new Date(now.getTime() + PLANS.free.trialDays * 24 * 60 * 60 * 1000);

    await admin
      .from("users")
      .update({
        trial_started_at: now.toISOString(),
        trial_ends_at: trialEnd.toISOString(),
      })
      .eq("id", user.id);

    // 5. Grant initial credits
    await grantCredits(user.id, PLANS.free.initialCredits, "trial_grant");

    // 6. Log onboarding event
    await admin.from("event_logs").insert({
      user_id: user.id,
      business_id: business.id,
      event_type: "onboarding.completed",
      event_data: {
        subreddits_count: subreddits?.length || 0,
        keywords_count:
          (keywords?.primary?.length || 0) + (keywords?.discovery?.length || 0),
        competitors_count: competitors?.length || 0,
      },
      source: "backend",
    });

    // 7. Trigger worker: generate embeddings + first-time scan
    //    Non-blocking — don't wait for these to complete.
    //    User gets redirected to dashboard immediately.
    const workerUrl = process.env.WORKER_URL;
    const workerSecret = process.env.WORKER_WEBHOOK_SECRET;

    if (workerUrl && workerSecret) {
      // Generate embeddings for the new business
      fetch(`${workerUrl}/generate-embeddings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${workerSecret}`,
        },
        body: JSON.stringify({ business_id: business.id }),
      }).catch((err) =>
        console.error("Worker embedding webhook failed (non-blocking):", err)
      );

      // Trigger immediate scan so user sees posts on first dashboard load
      fetch(`${workerUrl}/scan-now`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${workerSecret}`,
        },
      }).catch((err) =>
        console.error("Worker scan-now webhook failed (non-blocking):", err)
      );
    }

    return NextResponse.json({
      business_id: business.id,
      trial_ends_at: trialEnd.toISOString(),
      credits_granted: PLANS.free.initialCredits,
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error("Onboarding error:", errMsg, error);

    // Log the error to event_logs for debugging
    await admin.from("event_logs").insert({
      user_id: user.id,
      event_type: "onboarding.error",
      event_data: { error: errMsg, stack: error instanceof Error ? error.stack?.substring(0, 500) : null },
      source: "backend",
    }).catch(() => {}); // Don't let logging fail the error response

    return NextResponse.json(
      { error: `Failed to complete onboarding: ${errMsg}` },
      { status: 500 }
    );
  }
}
