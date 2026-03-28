import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/threads/estimate — Estimate credits for a thread analysis.
 * Fetches thread metadata from Reddit to calculate token-based cost.
 *
 * Body: { reddit_url: string }
 * Returns: { estimatedCredits, postLength, commentCount, breakdown }
 */
export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { reddit_url } = body;
  if (!reddit_url) return NextResponse.json({ error: "reddit_url required" }, { status: 400 });

  console.log("[estimate] URL:", reddit_url);

  // Check if already analyzed (cached — no credits needed)
  const { data: business } = await supabase
    .from("businesses")
    .select("id")
    .eq("user_id", user.id)
    .single();

  if (business) {
    const cleanedUrl = reddit_url.split("?")[0].split("#")[0].replace(/\/$/, "");
    const { data: existing } = await supabase
      .from("thread_analyses")
      .select("id")
      .eq("business_id", business.id)
      .eq("analysis_status", "complete")
      .eq("reddit_url", cleanedUrl)
      .limit(1)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({
        estimatedCredits: 0,
        cached: true,
        message: "This thread was already analyzed. No credits will be used.",
      });
    }
  }

  // Validate URL format
  const cleanedUrl = reddit_url.split("?")[0].split("#")[0].replace(/\/$/, "");
  if (!cleanedUrl.match(/reddit\.com\/r\/\w+\/comments\/\w+/)) {
    return NextResponse.json({ error: "Invalid Reddit post URL" }, { status: 400 });
  }

  try {
    // Proxy through Railway worker — Reddit blocks Vercel IPs
    const workerUrl = process.env.WORKER_URL;
    const workerSecret = process.env.WORKER_WEBHOOK_SECRET;

    let postTitle = "";
    let postBody = "";
    let numComments = 0;
    let fetchedComments = 0;
    let totalCommentChars = 0;

    if (workerUrl && workerSecret) {
      const res = await fetch(`${workerUrl}/fetch-thread`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${workerSecret}`,
        },
        body: JSON.stringify({ url: reddit_url }),
        signal: AbortSignal.timeout(15000),
      });

      if (res.ok) {
        const data = await res.json();
        postTitle = data.thread?.title || "";
        postBody = data.thread?.body || "";
        numComments = data.thread?.num_comments || 0;
        fetchedComments = (data.comments || []).length;
        totalCommentChars = (data.comments || []).reduce(
          (sum: number, c: { body: string }) => sum + Math.min((c.body || "").length, 500), 0
        );
      }
    }

    // Token estimation (1 token ≈ 4 chars)
    const systemPromptTokens = 200;
    const businessContextTokens = 150;
    const postTokens = Math.ceil((postTitle.length + Math.min(postBody.length, 1500)) / 4);
    const commentTokens = Math.ceil(totalCommentChars / 4);
    const outputTokens = 500;

    const totalInputTokens = systemPromptTokens + businessContextTokens + postTokens + commentTokens;
    const totalTokens = totalInputTokens + outputTokens;
    const estimatedCredits = Math.round((totalTokens / 1000) * 100) / 100;

    // Get user's current balance
    const { data: balance } = await supabase
      .from("credit_balances")
      .select("balance")
      .eq("user_id", user.id)
      .single();

    return NextResponse.json({
      estimatedCredits: estimatedCredits || 5,
      cached: false,
      balance: balance?.balance || 0,
      hasEnough: (balance?.balance || 0) >= (estimatedCredits || 5),
      breakdown: {
        postTitle: postTitle.slice(0, 80),
        postLength: postBody.length,
        commentCount: numComments,
        fetchedComments,
        totalInputTokens,
        outputTokens,
        totalTokens,
      },
    });
  } catch {
    return NextResponse.json({
      estimatedCredits: 5,
      cached: false,
      fallback: true,
      breakdown: { note: "Could not fetch thread metadata. Using average estimate." },
    });
  }
}
