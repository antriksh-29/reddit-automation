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
    // Ensure public.users row exists (auth trigger may not have fired if user was deleted and re-logged in)
    const { data: existingUser } = await admin
      .from("users")
      .select("id")
      .eq("id", user.id)
      .single();

    if (!existingUser) {
      await admin.from("users").insert({
        id: user.id,
        email: user.email!,
        name: user.user_metadata?.name || user.email?.split("@")[0] || "",
        plan_tier: "free",
        auth_provider_id: user.id,
      });
    }
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

      // NOTE: First-scan is triggered by /onboarding/setup page, NOT here.
      // The setup page calls /api/onboarding/first-scan → worker /first-scan
      // which bypasses the 25-min guard and streams progress to the user.
    }

    return NextResponse.json({
      business_id: business.id,
      trial_ends_at: trialEnd.toISOString(),
      credits_granted: PLANS.free.initialCredits,
    });
  } catch (error: unknown) {
    // Extract message from any error type (Error, Supabase PostgrestError, plain object)
    let errMsg: string;
    if (error instanceof Error) {
      errMsg = error.message;
    } else if (error && typeof error === "object" && "message" in error) {
      errMsg = String((error as { message: unknown }).message);
    } else if (error && typeof error === "object" && "code" in error) {
      errMsg = `DB error ${(error as { code: unknown }).code}: ${JSON.stringify(error)}`;
    } else {
      errMsg = JSON.stringify(error);
    }

    console.error("Onboarding error:", errMsg);

    // Log the error to event_logs for debugging
    try {
      await admin.from("event_logs").insert({
        user_id: user.id,
        event_type: "onboarding.error",
        event_data: { error: errMsg },
        source: "backend",
      });
    } catch { /* Don't let logging fail the error response */ }

    return NextResponse.json(
      { error: `Failed to complete onboarding: ${errMsg}` },
      { status: 500 }
    );
  }
}
