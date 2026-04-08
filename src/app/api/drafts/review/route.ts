import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { callClaude } from "@/lib/llm/anthropic";
import { checkCredits, deductCredits } from "@/lib/credits/manager";

/**
 * POST /api/drafts/review — Review a user-written draft against subreddit rules.
 * Ref: PRODUCT-SPEC.md §5.4
 *
 * Body: { alert_id: string, user_draft: string }
 *
 * Returns:
 *   - rule_violations: specific rules the draft may violate
 *   - suggestions: actionable improvements
 *   - improved_draft: AI-rewritten version incorporating suggestions
 *   - overall_score: 1-10 readiness score
 */
export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: business } = await supabase
    .from("businesses")
    .select("id, name, description, icp_description")
    .eq("user_id", user.id)
    .single();
  if (!business) return NextResponse.json({ error: "No business found" }, { status: 404 });

  // Credit check
  const creditCheck = await checkCredits(user.id, "draft_generation");
  if (!creditCheck.hasEnough) {
    const { data: planData } = await supabase.from("users").select("plan_tier").eq("id", user.id).single();
    return NextResponse.json({
      error: "Insufficient credits",
      balance: creditCheck.balance,
      plan_tier: planData?.plan_tier || "free",
    }, { status: 402 });
  }

  const { alert_id, user_draft } = await request.json();
  if (!alert_id || !user_draft?.trim()) {
    return NextResponse.json({ error: "alert_id and user_draft are required" }, { status: 400 });
  }

  // Get alert details
  const { data: alert } = await supabase
    .from("alerts")
    .select("*, monitored_subreddits!inner(subreddit_name)")
    .eq("id", alert_id)
    .eq("business_id", business.id)
    .single();

  if (!alert) return NextResponse.json({ error: "Alert not found" }, { status: 404 });

  const subredditName = (alert.monitored_subreddits as { subreddit_name: string })?.subreddit_name || "unknown";

  // Fetch subreddit rules
  let rules = "No specific rules available.";
  try {
    const rulesRes = await fetch(
      `https://api.reddit.com/r/${subredditName}/about/rules.json?raw_json=1`,
      { headers: { "User-Agent": "Arete/1.0" }, redirect: "manual" }
    );
    if (rulesRes.ok) {
      const rulesData = await rulesRes.json();
      const rulesList = rulesData.rules || [];
      if (rulesList.length > 0) {
        rules = rulesList.map((r: { short_name: string; description: string }) =>
          `- ${r.short_name}: ${r.description?.slice(0, 200) || "No description"}`
        ).join("\n");
      }
    }
  } catch {
    // Non-blocking
  }

  try {
    const prompt = `You are a Reddit community expert and writing coach. A user has written a comment draft for a Reddit post. Your job is to:

1. Check the draft against the subreddit rules and flag any violations
2. Suggest specific improvements to make it more engaging, authentic, and useful
3. Provide an improved version that incorporates your suggestions

POST CONTEXT:
- Subreddit: r/${subredditName}
- Post Title: ${alert.post_title}
- Post Body: ${(alert.post_body || "").slice(0, 1000)}

SUBREDDIT RULES:
${rules}

BUSINESS CONTEXT (the user's business — they may want to subtly reference it):
- Business: ${business.name} — ${business.description?.slice(0, 300)}

USER'S DRAFT:
"""
${user_draft.slice(0, 2000)}
"""

Analyze the draft and return a JSON object with this exact structure:
{
  "overall_score": <number 1-10, where 10 = perfect comment ready to post>,
  "rule_violations": [
    { "rule": "<rule name>", "issue": "<what specifically violates it>", "severity": "high" | "medium" | "low" }
  ],
  "suggestions": [
    { "type": "tone" | "content" | "structure" | "authenticity" | "value", "suggestion": "<specific actionable suggestion>" }
  ],
  "improved_draft": "<your improved version of their draft that addresses all issues and suggestions, keeping their voice and intent but making it better>"
}

SCORING GUIDE:
- 9-10: Ready to post as-is. Follows rules, sounds human, provides value.
- 7-8: Good with minor tweaks. Maybe slightly promotional or could be more specific.
- 5-6: Needs work. Rule concerns, too salesy, or doesn't add enough value.
- 3-4: Significant issues. Likely to get removed or downvoted.
- 1-2: Would get banned or is completely off-topic.

Be honest but constructive. If the draft is good, say so. If it needs work, be specific about why.

Return ONLY the JSON object, no other text.`;

    // Primary: GPT-5.4. Fallback: Claude Sonnet 4.6.
    let result: { text: string; inputTokens: number; outputTokens: number };
    let modelUsed = "gpt-5.4";
    const sysPrompt = "You are a Reddit community expert who reviews comment drafts for authenticity, rule compliance, and effectiveness. Always return valid JSON.";

    try {
      const { callOpenAI } = await import("@/lib/llm/openai");
      result = await callOpenAI({ model: "gpt-5.4", maxTokens: 2000, systemPrompt: sysPrompt, userMessage: prompt });
    } catch {
      modelUsed = "claude-sonnet-4-6-20250514";
      result = await callClaude({ model: "claude-sonnet-4-6-20250514", maxTokens: 2000, systemPrompt: sysPrompt, userMessage: prompt });
    }

    // Parse response
    let review;
    try {
      const jsonMatch = result.text.match(/\{[\s\S]*\}/);
      review = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    } catch {
      review = null;
    }

    if (!review) {
      return NextResponse.json({ error: "Failed to parse review response" }, { status: 500 });
    }

    const totalTokens = result.inputTokens + result.outputTokens;

    // Deduct credits
    await deductCredits(user.id, "draft_generation", totalTokens, modelUsed, alert_id);

    return NextResponse.json({
      review: {
        overall_score: review.overall_score || 5,
        rule_violations: review.rule_violations || [],
        suggestions: review.suggestions || [],
        improved_draft: review.improved_draft || "",
      },
      subreddit_rules: rules,
    });
  } catch (err) {
    console.error("Draft review failed:", err);
    return NextResponse.json({ error: "Failed to review draft" }, { status: 500 });
  }
}
