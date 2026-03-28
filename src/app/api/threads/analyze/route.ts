import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { callClaude } from "@/lib/llm/anthropic";
import { checkCredits, deductCredits } from "@/lib/credits/manager";

/**
 * POST /api/threads/analyze — Analyze a Reddit thread.
 * Ref: PRODUCT-SPEC.md §5.3, TECH-SPEC.md §5
 *
 * Body: { reddit_url: string, alert_id?: string }
 * Returns: thread analysis (summary, pain points, insights, buying signals, competitive landscape)
 */
export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: business } = await supabase
    .from("businesses")
    .select("id, description, icp_description, keywords")
    .eq("user_id", user.id)
    .single();
  if (!business) return NextResponse.json({ error: "No business found" }, { status: 404 });

  // Credit check
  const creditCheck = await checkCredits(user.id, "thread_analysis");
  if (!creditCheck.hasEnough) {
    const { data: planData } = await supabase.from("users").select("plan_tier").eq("id", user.id).single();
    return NextResponse.json({
      error: "Insufficient credits",
      balance: creditCheck.balance,
      required: creditCheck.estimatedMin,
      plan_tier: planData?.plan_tier || "free",
    }, { status: 402 });
  }

  const { reddit_url, alert_id } = await request.json();
  if (!reddit_url) return NextResponse.json({ error: "reddit_url required" }, { status: 400 });

  // Check if we already have an analysis for this URL (strip query params for comparison)
  const cleanedUrl = reddit_url.split("?")[0].split("#")[0].replace(/\/$/, "");
  const { data: existing } = await supabase
    .from("thread_analyses")
    .select("*")
    .eq("business_id", business.id)
    .eq("analysis_status", "complete")
    .eq("reddit_url", cleanedUrl)
    .limit(1)
    .maybeSingle();

  if (existing) {
    // Return existing analysis (no credit charge)
    const { data: messages } = await supabase
      .from("thread_chat_messages")
      .select("*")
      .eq("thread_analysis_id", existing.id)
      .order("created_at", { ascending: true });

    return NextResponse.json({ analysis: existing, messages: messages || [], cached: true });
  }

  try {
    // Validate URL format
    const cleanUrl = reddit_url.split("?")[0].split("#")[0];
    if (!cleanUrl.includes("reddit.com/r/")) {
      return NextResponse.json({ error: "Please enter a valid Reddit URL." }, { status: 400 });
    }
    if (!cleanUrl.match(/reddit\.com\/r\/\w+\/comments\/\w+/)) {
      return NextResponse.json({ error: "This doesn't look like a Reddit post URL. Make sure it links to a specific post." }, { status: 400 });
    }

    // Fetch thread from Reddit
    const threadData = await fetchRedditThread(reddit_url);
    if (!threadData) {
      return NextResponse.json({ error: "Could not fetch this thread. It may have been deleted, removed, or the subreddit may be private." }, { status: 400 });
    }

    // Build analysis prompt
    const prompt = buildAnalysisPrompt(threadData, business);

    // Primary: Claude Sonnet. Fallback: GPT-5.4. Per TECH-SPEC.md §6.5
    let result: { text: string; inputTokens: number; outputTokens: number };
    let modelUsed = "claude-sonnet-4-20250514";
    const sysPrompt = "You are a business intelligence analyst. Analyze Reddit threads to extract actionable insights for businesses. Always return valid JSON.";

    try {
      result = await callClaude({ model: "claude-sonnet-4-20250514", maxTokens: 2000, systemPrompt: sysPrompt, userMessage: prompt });
    } catch (claudeErr) {
      console.error("[threads/analyze] Claude failed, falling back to GPT-5.4:", (claudeErr as Error).message);
      const { callOpenAI } = await import("@/lib/llm/openai");
      modelUsed = "gpt-5.4";
      result = await callOpenAI({ model: "gpt-5.4", maxTokens: 2000, systemPrompt: sysPrompt, userMessage: prompt });
    }

    // Parse the analysis
    const analysis = parseAnalysis(result.text);
    const totalTokens = result.inputTokens + result.outputTokens;

    // Create thread_analysis record
    const { data: threadAnalysis, error: insertError } = await supabase
      .from("thread_analyses")
      .insert({
        business_id: business.id,
        alert_id: alert_id || null,
        reddit_url: cleanedUrl,
        thread_title: threadData.title,
        summary: analysis.summary,
        pain_points: analysis.pain_points,
        buying_signals: analysis.buying_signals,
        competitive_landscape: analysis.competitive_landscape,
        sentiment: analysis.sentiment,
        key_insights: analysis.key_insights,
        comment_count: threadData.comments.length,
        analysis_status: "complete",
      })
      .select()
      .single();

    if (insertError) throw insertError;

    // Deduct credits
    const deductResult = await deductCredits(user.id, "thread_analysis", totalTokens, modelUsed, threadAnalysis.id);

    return NextResponse.json({
      analysis: threadAnalysis,
      messages: [],
      cached: false,
      credits: { used: deductResult.creditsUsed, balanceAfter: deductResult.balanceAfter },
    });
  } catch (err) {
    console.error("Thread analysis failed:", err);
    return NextResponse.json({ error: "Analysis failed. Please try again." }, { status: 500 });
  }
}

interface RedditThread {
  title: string;
  body: string;
  author: string;
  subreddit: string;
  upvotes: number;
  numComments: number;
  url: string;
  comments: { author: string; body: string; upvotes: number; depth: number }[];
}

async function fetchRedditThread(url: string): Promise<RedditThread | null> {
  // Proxy through Railway worker — Reddit blocks Vercel IPs
  const workerUrl = process.env.WORKER_URL;
  const workerSecret = process.env.WORKER_WEBHOOK_SECRET;

  if (!workerUrl || !workerSecret) {
    console.error("[thread-analysis] WORKER_URL or WORKER_WEBHOOK_SECRET not set");
    return null;
  }

  try {
    const res = await fetch(`${workerUrl}/fetch-thread`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${workerSecret}`,
      },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(20000),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      console.error(`[thread-analysis] Worker fetch-thread failed: ${err.error}`);
      return null;
    }

    const data = await res.json();
    const t = data.thread;
    const comments: RedditThread["comments"] = (data.comments || [])
      .slice(0, 100)
      .map((c: { author: string; body: string; score: number; depth: number }) => ({
        author: c.author || "[deleted]",
        body: (c.body || "").slice(0, 500),
        upvotes: c.score || 0,
        depth: c.depth || 0,
      }));

    return {
      title: t.title || "",
      body: t.body || "",
      author: t.author || "[deleted]",
      subreddit: t.subreddit || "",
      upvotes: t.upvotes || 0,
      numComments: t.num_comments || 0,
      url,
      comments,
    };
  } catch (err) {
    console.error("[thread-analysis] fetchRedditThread error:", err);
    return null;
  }
}

function buildAnalysisPrompt(thread: RedditThread, business: Record<string, unknown>): string {
  const commentsText = thread.comments
    .slice(0, 50)
    .map((c, i) => `${i + 1}. [${c.upvotes}↑] u/${c.author}: ${c.body}`)
    .join("\n");

  return `Analyze this Reddit thread for business intelligence.

BUSINESS CONTEXT:
- Description: ${business.description}
- ICP: ${business.icp_description}
- Keywords: ${JSON.stringify(business.keywords)}

REDDIT THREAD:
- Title: ${thread.title}
- Author: u/${thread.author}
- Subreddit: r/${thread.subreddit}
- Upvotes: ${thread.upvotes} | Comments: ${thread.numComments}
- Post body: ${thread.body.slice(0, 1500)}

TOP COMMENTS (${thread.comments.length} total):
${commentsText}

Return a JSON object with these fields:
{
  "summary": "2-3 sentence summary of the thread and its key discussion",
  "pain_points": ["pain point 1", "pain point 2", ...],
  "key_insights": ["insight 1", "insight 2", ...],
  "buying_signals": [{"user": "u/username", "signal": "what they said indicating purchase intent"}],
  "competitive_landscape": [{"competitor": "name", "sentiment": "positive|negative|neutral", "context": "what was said"}],
  "sentiment": "positive|negative|neutral|mixed"
}

Rules:
- Pain points: specific frustrations expressed (not inferred)
- Key insights: actionable takeaways for the business
- Buying signals: only include if someone explicitly indicates they're looking for a solution or willing to pay
- Competitive landscape: only include competitors actually mentioned in the thread
- Be specific — quote users where possible
- Return ONLY the JSON object, no other text`;
}

function parseAnalysis(content: string): {
  summary: string;
  pain_points: string[];
  key_insights: string[];
  buying_signals: unknown[];
  competitive_landscape: unknown[];
  sentiment: string;
} {
  try {
    // Extract JSON from the response (may have markdown fences)
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch {
    // Fallback
  }

  return {
    summary: content.slice(0, 500),
    pain_points: [],
    key_insights: [],
    buying_signals: [],
    competitive_landscape: [],
    sentiment: "neutral",
  };
}
