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

  // Fetch thread metadata from Reddit
  let cleanUrl = reddit_url.split("?")[0].split("#")[0].replace(/\/$/, "");
  cleanUrl = cleanUrl.replace("://reddit.com", "://www.reddit.com");
  cleanUrl = cleanUrl.replace("://old.reddit.com", "://www.reddit.com");

  if (!cleanUrl.match(/reddit\.com\/r\/\w+\/comments\/\w+/)) {
    return NextResponse.json({ error: "Invalid Reddit post URL" }, { status: 400 });
  }

  try {
    const jsonUrl = cleanUrl + ".json?raw_json=1&limit=100";
    const res = await fetch(jsonUrl, {
      headers: { "User-Agent": "Arete/1.0 (estimate)" },
      redirect: "manual",
    });

    if (!res.ok || res.status === 302) {
      return NextResponse.json({ error: "Could not fetch thread" }, { status: 400 });
    }

    const data = await res.json();
    if (!Array.isArray(data) || data.length < 2) {
      return NextResponse.json({ error: "Invalid thread data" }, { status: 400 });
    }

    const post = data[0]?.data?.children?.[0]?.data;
    if (!post) {
      return NextResponse.json({ error: "Post not found" }, { status: 400 });
    }

    // Calculate token estimates
    const postBody = post.selftext || "";
    const postTitle = post.title || "";
    const numComments = post.num_comments || 0;

    // Count actual comment text from fetched comments
    let totalCommentChars = 0;
    let fetchedComments = 0;
    function countComments(children: unknown[]) {
      if (!Array.isArray(children)) return;
      for (const child of children) {
        const c = (child as Record<string, unknown>)?.data as Record<string, unknown> | undefined;
        if (!c || !c.body) continue;
        totalCommentChars += Math.min((c.body as string).length, 500); // We cap at 500 chars per comment
        fetchedComments++;
        if (c.replies && typeof c.replies === "object") {
          const replyData = (c.replies as Record<string, unknown>)?.data as Record<string, unknown> | undefined;
          if (replyData?.children) countComments(replyData.children as unknown[]);
        }
      }
    }
    countComments(data[1]?.data?.children || []);

    // Token estimation (1 token ≈ 4 chars)
    const systemPromptTokens = 200;
    const businessContextTokens = 150;
    const postTokens = Math.ceil((postTitle.length + Math.min(postBody.length, 1500)) / 4);
    const commentTokens = Math.ceil(totalCommentChars / 4);
    const outputTokens = 500; // Estimated output

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
      estimatedCredits,
      cached: false,
      balance: balance?.balance || 0,
      hasEnough: (balance?.balance || 0) >= estimatedCredits,
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
    // Fallback to static estimate if fetch fails
    return NextResponse.json({
      estimatedCredits: 5,
      cached: false,
      fallback: true,
      breakdown: { note: "Could not fetch thread metadata. Using average estimate." },
    });
  }
}
