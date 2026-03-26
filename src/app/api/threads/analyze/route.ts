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
    return NextResponse.json({
      error: "Insufficient credits",
      balance: creditCheck.balance,
      required: creditCheck.estimatedMin,
    }, { status: 402 });
  }

  const { reddit_url, alert_id } = await request.json();
  if (!reddit_url) return NextResponse.json({ error: "reddit_url required" }, { status: 400 });

  // Check if we already have an analysis for this URL
  const { data: existing } = await supabase
    .from("thread_analyses")
    .select("*")
    .eq("business_id", business.id)
    .eq("reddit_url", reddit_url)
    .eq("analysis_status", "complete")
    .single();

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
    // Fetch thread from Reddit
    const threadData = await fetchRedditThread(reddit_url);
    if (!threadData) {
      return NextResponse.json({ error: "Could not fetch thread from Reddit" }, { status: 400 });
    }

    // Build analysis prompt
    const prompt = buildAnalysisPrompt(threadData, business);

    // Call Claude Sonnet
    const result = await callClaude({
      model: "claude-sonnet-4-20250514",
      maxTokens: 2000,
      systemPrompt: "You are a business intelligence analyst. Analyze Reddit threads to extract actionable insights for businesses. Always return valid JSON.",
      userMessage: prompt,
    });

    // Parse the analysis
    const analysis = parseAnalysis(result.text);
    const totalTokens = result.inputTokens + result.outputTokens;

    // Create thread_analysis record
    const { data: threadAnalysis, error: insertError } = await supabase
      .from("thread_analyses")
      .insert({
        business_id: business.id,
        alert_id: alert_id || null,
        reddit_url,
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
    await deductCredits(user.id, "thread_analysis", totalTokens, "claude-sonnet-4-20250514", threadAnalysis.id);

    return NextResponse.json({ analysis: threadAnalysis, messages: [], cached: false });
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
  // Normalize URL to .json endpoint
  let jsonUrl = url.replace(/\/$/, "");
  if (!jsonUrl.endsWith(".json")) jsonUrl += ".json";
  // Ensure it's a www.reddit.com URL
  jsonUrl = jsonUrl.replace("://reddit.com", "://www.reddit.com");
  if (!jsonUrl.includes("reddit.com")) return null;
  jsonUrl += "?raw_json=1&limit=100";

  const res = await fetch(jsonUrl, {
    headers: { "User-Agent": "Arete/1.0 (thread-analysis)" },
    redirect: "manual",
  });

  if (!res.ok) return null;

  const data = await res.json();
  if (!Array.isArray(data) || data.length < 2) return null;

  const post = data[0]?.data?.children?.[0]?.data;
  if (!post) return null;

  // Extract comments (flatten tree, max 100)
  const comments: RedditThread["comments"] = [];
  function extractComments(children: unknown[], depth: number) {
    if (!Array.isArray(children) || comments.length >= 100) return;
    for (const child of children) {
      const c = (child as Record<string, unknown>)?.data as Record<string, unknown> | undefined;
      if (!c || !c.body) continue;
      comments.push({
        author: (c.author as string) || "[deleted]",
        body: (c.body as string).slice(0, 500),
        upvotes: (c.ups as number) || 0,
        depth,
      });
      if (c.replies && typeof c.replies === "object") {
        const replyData = (c.replies as Record<string, unknown>)?.data as Record<string, unknown> | undefined;
        if (replyData?.children) {
          extractComments(replyData.children as unknown[], depth + 1);
        }
      }
    }
  }

  extractComments(data[1]?.data?.children || [], 0);

  return {
    title: post.title || "",
    body: post.selftext || "",
    author: post.author || "[deleted]",
    subreddit: post.subreddit || "",
    upvotes: post.ups || 0,
    numComments: post.num_comments || 0,
    url,
    comments,
  };
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
