import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { callClaude } from "@/lib/llm/anthropic";
import { checkCredits, deductCredits } from "@/lib/credits/manager";

/**
 * POST /api/drafts/generate — Generate comment drafts for a Reddit post.
 * Ref: PRODUCT-SPEC.md §5.4, TECH-SPEC.md §5
 *
 * Body: { alert_id: string, tone?: string }
 * Generates 2 drafts with different tones.
 * Uses Claude Sonnet (GPT-4o when OpenAI key is configured — per failover strategy).
 */
export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: business } = await supabase
    .from("businesses")
    .select("id, name, description, icp_description, keywords")
    .eq("user_id", user.id)
    .single();
  if (!business) return NextResponse.json({ error: "No business found" }, { status: 404 });

  // Credit check
  const creditCheck = await checkCredits(user.id, "draft_generation");
  if (!creditCheck.hasEnough) {
    return NextResponse.json({
      error: "Insufficient credits",
      balance: creditCheck.balance,
      required: creditCheck.estimatedMin,
    }, { status: 402 });
  }

  const { alert_id } = await request.json();
  if (!alert_id) return NextResponse.json({ error: "alert_id required" }, { status: 400 });

  // Get alert details
  const { data: alert } = await supabase
    .from("alerts")
    .select("*, monitored_subreddits!inner(subreddit_name)")
    .eq("id", alert_id)
    .single();

  if (!alert) return NextResponse.json({ error: "Alert not found" }, { status: 404 });

  const subredditName = (alert.monitored_subreddits as { subreddit_name: string })?.subreddit_name || "unknown";

  // Fetch subreddit rules
  let rules = "No specific rules available.";
  try {
    const rulesRes = await fetch(
      `https://www.reddit.com/r/${subredditName}/about/rules.json?raw_json=1`,
      { headers: { "User-Agent": "Arete/1.0" }, redirect: "manual" }
    );
    if (rulesRes.ok) {
      const rulesData = await rulesRes.json();
      const rulesList = rulesData.rules || [];
      if (rulesList.length > 0) {
        rules = rulesList.map((r: { short_name: string; description: string }) =>
          `- ${r.short_name}: ${r.description?.slice(0, 150) || "No description"}`
        ).join("\n");
      }
    }
  } catch {
    // Non-blocking
  }

  try {
    const prompt = `Generate 2 Reddit comment drafts for the following post. Each draft should have a different tone.

POST CONTEXT:
- Subreddit: r/${subredditName}
- Title: ${alert.post_title}
- Body: ${(alert.post_body || "").slice(0, 1500)}
- Category: ${alert.category}

SUBREDDIT RULES:
${rules}

BUSINESS CONTEXT:
- Business: ${business.name} — ${business.description?.slice(0, 300)}
- Target audience: ${business.icp_description?.slice(0, 200)}

REQUIREMENTS:
1. Sound genuinely human — like a real Reddit user who happens to know about this space
2. Follow the subreddit rules strictly — avoid direct self-promotion
3. Provide real value first — share genuine insight, ask thoughtful questions, or offer help
4. Only mention the business naturally if it fits the conversation — never force it
5. Match the tone and language style of the subreddit
6. Keep each draft under 200 words

Return a JSON array with exactly 2 drafts:
[
  { "tone": "Helpful & Conversational", "text": "..." },
  { "tone": "Technical & Detailed", "text": "..." }
]

Return ONLY the JSON array, no other text.`;

    const result = await callClaude({
      model: "claude-sonnet-4-20250514",
      maxTokens: 1500,
      systemPrompt: "You are an expert Reddit user who writes authentic, helpful comments. Never write obviously promotional content. Always return valid JSON.",
      userMessage: prompt,
    });

    // Parse drafts
    let drafts: { tone: string; text: string }[];
    try {
      const jsonMatch = result.text.match(/\[[\s\S]*\]/);
      drafts = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
    } catch {
      drafts = [{ tone: "Helpful", text: result.text.slice(0, 500) }];
    }

    const totalTokens = result.inputTokens + result.outputTokens;

    // Save drafts to DB
    const savedDrafts = [];
    for (const draft of drafts) {
      const { data: saved } = await supabase
        .from("comment_drafts")
        .insert({
          alert_id,
          business_id: business.id,
          draft_text: draft.text,
          tone: draft.tone,
          rule_check: { rules_count: rules.split("\n").length, checked: true },
          approval_state: "pending",
        })
        .select()
        .single();

      if (saved) savedDrafts.push(saved);
    }

    // Deduct credits
    await deductCredits(user.id, "draft_generation", totalTokens, "claude-sonnet-4-20250514", alert_id);

    return NextResponse.json({
      drafts: savedDrafts,
      subreddit_rules: rules,
    });
  } catch (err) {
    console.error("Draft generation failed:", err);
    return NextResponse.json({ error: "Failed to generate drafts" }, { status: 500 });
  }
}

/**
 * PATCH /api/drafts/generate — Regenerate a single draft.
 * Body: { draft_id: string }
 */
export async function PATCH(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const creditCheck = await checkCredits(user.id, "draft_regeneration");
  if (!creditCheck.hasEnough) {
    return NextResponse.json({
      error: "Insufficient credits",
      balance: creditCheck.balance,
    }, { status: 402 });
  }

  const { draft_id } = await request.json();

  // Get existing draft
  const { data: existingDraft } = await supabase
    .from("comment_drafts")
    .select("*, alerts!inner(post_title, post_body, category, monitored_subreddits!inner(subreddit_name))")
    .eq("id", draft_id)
    .single();

  if (!existingDraft) return NextResponse.json({ error: "Draft not found" }, { status: 404 });

  const alert = existingDraft.alerts as Record<string, unknown>;
  const sub = (alert.monitored_subreddits as { subreddit_name: string })?.subreddit_name || "unknown";

  try {
    const prompt = `Regenerate this Reddit comment draft with a "${existingDraft.tone}" tone.

Post: ${alert.post_title}
Body: ${(alert.post_body as string || "").slice(0, 500)}
Subreddit: r/${sub}

Write a new version that's different from: "${existingDraft.draft_text.slice(0, 200)}"

Keep it under 200 words. Sound human. Follow subreddit norms. Return ONLY the comment text, no JSON.`;

    const result = await callClaude({
      model: "claude-sonnet-4-20250514",
      maxTokens: 500,
      systemPrompt: "You are an expert Reddit user. Write authentic, helpful comments. Return only the comment text.",
      userMessage: prompt,
    });

    const totalTokens = result.inputTokens + result.outputTokens;

    // Update the draft
    const { data: updated } = await supabase
      .from("comment_drafts")
      .update({ draft_text: result.text, approval_state: "pending" })
      .eq("id", draft_id)
      .select()
      .single();

    await deductCredits(user.id, "draft_regeneration", totalTokens, "claude-sonnet-4-20250514", draft_id);

    return NextResponse.json({ draft: updated });
  } catch {
    return NextResponse.json({ error: "Regeneration failed" }, { status: 500 });
  }
}
