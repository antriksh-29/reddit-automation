import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { callClaude } from "@/lib/llm/anthropic";
import { checkCredits, deductCredits } from "@/lib/credits/manager";

/**
 * POST /api/threads/chat — Follow-up question on a thread analysis.
 * Ref: PRODUCT-SPEC.md §5.3 (Chat functionality)
 *
 * Body: { thread_analysis_id: string, message: string }
 */
export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Credit check
  const creditCheck = await checkCredits(user.id, "thread_chat");
  if (!creditCheck.hasEnough) {
    const { data: planData } = await supabase.from("users").select("plan_tier").eq("id", user.id).single();
    return NextResponse.json({
      error: "Insufficient credits",
      balance: creditCheck.balance,
      required: creditCheck.estimatedMin,
      plan_tier: planData?.plan_tier || "free",
    }, { status: 402 });
  }

  const { thread_analysis_id, message } = await request.json();
  if (!thread_analysis_id || !message) {
    return NextResponse.json({ error: "thread_analysis_id and message required" }, { status: 400 });
  }

  // Get business context
  const { data: business } = await supabase
    .from("businesses")
    .select("id, description, icp_description, keywords")
    .eq("user_id", user.id)
    .single();
  if (!business) return NextResponse.json({ error: "No business found" }, { status: 404 });

  // Get the thread analysis
  const { data: analysis } = await supabase
    .from("thread_analyses")
    .select("*")
    .eq("id", thread_analysis_id)
    .eq("business_id", business.id)
    .single();

  if (!analysis) return NextResponse.json({ error: "Analysis not found" }, { status: 404 });

  // Get previous chat messages for context
  const { data: prevMessages } = await supabase
    .from("thread_chat_messages")
    .select("role, content")
    .eq("thread_analysis_id", thread_analysis_id)
    .order("created_at", { ascending: true });

  // Save user message
  await supabase.from("thread_chat_messages").insert({
    thread_analysis_id,
    role: "user",
    content: message,
  });

  // Build chat context
  const contextMessages = (prevMessages || []).map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  const systemPrompt = `You are a business intelligence assistant helping analyze a Reddit thread.

THREAD CONTEXT:
- Title: ${analysis.thread_title}
- URL: ${analysis.reddit_url}
- Summary: ${analysis.summary}
- Pain points: ${JSON.stringify(analysis.pain_points)}
- Key insights: ${JSON.stringify(analysis.key_insights)}
- Buying signals: ${JSON.stringify(analysis.buying_signals)}
- Competitive landscape: ${JSON.stringify(analysis.competitive_landscape)}
- Sentiment: ${analysis.sentiment}
- Comments analyzed: ${analysis.comment_count}

BUSINESS CONTEXT:
- Description: ${business?.description || "N/A"}
- ICP: ${business?.icp_description || "N/A"}
- Keywords: ${JSON.stringify(business?.keywords || {})}

Answer the user's follow-up questions about this thread. Be specific, reference users and comments from the thread where relevant. Keep answers concise and actionable.

FORMATTING RULES:
- Do NOT use markdown formatting (no #, ##, *, **, -, etc.)
- Use plain text only
- Use numbered lists (1. 2. 3.) or simple line breaks for structure
- Keep paragraphs short and readable`;

  try {
    const chatPrompt = contextMessages
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n\n");

    const fullPrompt = chatPrompt ? `${chatPrompt}\n\nUser: ${message}` : message;

    // Primary: Claude Sonnet. Fallback: GPT-5.4.
    let result: { text: string; inputTokens: number; outputTokens: number };
    let modelUsed = "claude-sonnet-4-6-20250514";

    try {
      result = await callClaude({ model: "claude-sonnet-4-6-20250514", maxTokens: 1000, systemPrompt, userMessage: fullPrompt });
    } catch {
      const { callOpenAI } = await import("@/lib/llm/openai");
      modelUsed = "gpt-5.4";
      result = await callOpenAI({ model: "gpt-5.4", maxTokens: 1000, systemPrompt, userMessage: fullPrompt });
    }

    const totalTokens = result.inputTokens + result.outputTokens;

    // Save assistant response
    await supabase.from("thread_chat_messages").insert({
      thread_analysis_id,
      role: "assistant",
      content: result.text,
    });

    // Deduct credits
    const deductResult = await deductCredits(user.id, "thread_chat", totalTokens, modelUsed, thread_analysis_id);

    return NextResponse.json({
      response: result.text,
      credits: { used: deductResult.creditsUsed, balanceAfter: deductResult.balanceAfter },
    });
  } catch (err) {
    console.error("Chat failed:", err);
    return NextResponse.json({ error: "Failed to generate response" }, { status: 500 });
  }
}
