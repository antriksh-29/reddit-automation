import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { callOpenAI } from "@/lib/llm/openai";
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
    const { data: planData } = await supabase.from("users").select("plan_tier").eq("id", user.id).single();
    return NextResponse.json({
      error: "Insufficient credits",
      balance: creditCheck.balance,
      required: creditCheck.estimatedMin,
      plan_tier: planData?.plan_tier || "free",
    }, { status: 402 });
  }

  const { alert_id } = await request.json();
  if (!alert_id) return NextResponse.json({ error: "alert_id required" }, { status: 400 });

  // Get alert details (separate queries to avoid RLS join issues)
  const { data: alert, error: alertError } = await supabase
    .from("alerts")
    .select("*")
    .eq("id", alert_id)
    .eq("business_id", business.id)
    .single();

  if (!alert || alertError) {
    console.error("Alert fetch failed:", alertError?.message);
    return NextResponse.json({ error: "Alert not found" }, { status: 404 });
  }

  // Get subreddit name separately
  const { data: sub } = await supabase
    .from("monitored_subreddits")
    .select("subreddit_name")
    .eq("id", alert.subreddit_id)
    .single();

  const subredditName = sub?.subreddit_name || "unknown";

  // Fetch subreddit rules (proxy through Railway — Reddit blocks Vercel IPs)
  let rules = "No specific rules available.";
  try {
    const workerUrl = process.env.WORKER_URL;
    const workerSecret = process.env.WORKER_WEBHOOK_SECRET;

    if (workerUrl && workerSecret) {
      const rulesRes = await fetch(`${workerUrl}/fetch-rules`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${workerSecret}`,
        },
        body: JSON.stringify({ subreddit: subredditName }),
        signal: AbortSignal.timeout(10000),
      });
      if (rulesRes.ok) {
        const rulesData = await rulesRes.json();
        if (rulesData.rules) {
          rules = rulesData.rules;
        }
      }
    }
  } catch {
    // Non-blocking
  }

  try {
    const prompt = `Generate 2 Reddit comment drafts for the following post. Each draft should use a completely different approach.

POST CONTEXT:
- Subreddit: r/${subredditName}
- Title: ${alert.post_title}
- Body: ${(alert.post_body || "").slice(0, 1500)}
- Post category: ${alert.category}

SUBREDDIT RULES:
${rules}

BUSINESS CONTEXT (for your awareness — do NOT mention the business name or link in the drafts):
- Business: ${business.name} — ${business.description?.slice(0, 300)}
- Target audience: ${business.icp_description?.slice(0, 200)}

═══════════════════════════════════════════════════
CORE PHILOSOPHY: VALUE-FIRST, NEVER SELL
═══════════════════════════════════════════════════

The goal is to write comments that make the reader think "this person really knows what they're talking about" — NOT "this person is trying to sell me something."

COMMENT STRUCTURE RULES:

1. HOOK WITH THE PROBLEM — Start by acknowledging a specific pain point the OP mentioned. Show you actually read their post. Reference their exact words or situation.

2. SPEAK FROM EXPERIENCE — Write as someone who has personally dealt with this. Use first-person: "I ran into this exact thing when...", "What worked for us was...", "I wasted 3 months on X before realizing..."

3. SHARE A FRAMEWORK OR ACTIONABLE STEPS — Give a concrete 3-5 step approach, a checklist, a mental model, or a specific metric/number from real experience. Not vague advice. Real specifics anyone can apply.

4. PROVIDE PROOF — Include a specific metric, result, screenshot reference, or before/after: "went from 2% to 11% conversion", "cut our deploy time from 45 min to 3 min", "reduced churn by 30% in one quarter"

5. END WITH A GENUINE QUESTION OR NUDGE — Close with something that invites conversation. Either ask a real follow-up question about their situation, or end with a thought-provoking point. This draws people in.

6. ZERO SELF-PROMOTION — No product links. No business name. No "check out my tool." No "I built something for this." Reddit kills these instantly. The business context is ONLY so you can speak authentically about the domain.

WHAT MAKES A COMMENT FEEL HUMAN (study these patterns):

- Use casual connectors: "honestly", "the thing is", "what actually worked was", "I kinda stumbled into"
- Show vulnerability: admit mistakes, share what didn't work, be honest about limitations
- Use Reddit-native formatting: short paragraphs, occasional line breaks, maybe a bullet list for steps
- Match the subreddit's energy — some subs love jokes and memes, others stick to facts and deep discussion. Check the vibe.
- Throw in a quick personal anecdote or a joke if it fits. It makes the reply feel yours.
- Avoid corporate language: no "leverage", "utilize", "solution", "platform", "empower", "streamline"
- Avoid one-word or low-effort responses
- A good reply starts by noting what the OP said, then adds real help or a smart point. End with a nudge — like asking a question. This draws people in.

WHAT TO ABSOLUTELY AVOID:

- Leading with product links in every comment
- Generic advice that could apply to any post ("focus on your users!")
- Pretending to be a customer of your own product
- Replies that don't match the post — check context before writing
- Arguing with other commenters or being rude
- Excessive low-effort, one-word replies or spam

EXAMPLE OF A GREAT REDDIT COMMENT (for reference):
"""
I stopped thinking in terms of "channels" and just chased specific people with the exact problem I solved. I started by writing down 3 super-specific pains my product fixed. Then I searched Reddit and X for people literally complaining about those things, replied with actual fixes, and only mentioned my tool if they asked how I was doing it. Same on Slack communities and niche forums. It felt slow and small, but those first 50 users were crazy engaged and kept talking. What surprised me: live "fix this with you" calls. I'd DM: "Got 20 mins? I'll set it up for you and we'll see if it helps." Half said yes, and those calls turned into referrals.
"""

Notice: personal story, specific actions, real numbers, no links, conversational tone, genuine helpfulness.

ANOTHER EXAMPLE:
"""
the customer concentration point is huge. i never thought about it until someone pointed out that acquirers basically see it as risk concentration. 42% in your top 5 is a tough spot because if even one churns, the whole revenue story changes overnight.

curious about the founder dependency part. how long did it take you to actually reduce it once you started the process?
"""

Notice: acknowledges OP's specific point, adds unique insight with a number, asks genuine follow-up question, lowercase casual tone.

═══════════════════════════════════════════════════

Generate exactly 2 drafts with DIFFERENT approaches:

Draft 1 — "Story & Experience": Lead with a personal story or anecdote related to the topic. Share what you tried, what failed, what worked. Feel like a peer sharing war stories.

Draft 2 — "Framework & Tactical": Lead with a specific framework, checklist, or step-by-step approach. More structured, but still conversational. Feel like the smartest person in the thread dropping actionable knowledge.

Keep each draft between 80-200 words. Short is fine — a punchy 80-word comment with real insight beats a 200-word wall of generic advice.

Return a JSON array with exactly 2 drafts:
[
  { "tone": "Story & Experience", "text": "..." },
  { "tone": "Framework & Tactical", "text": "..." }
]

Return ONLY the JSON array, no other text.`;

    // Primary: OpenAI GPT-4o. Fallback: Claude Sonnet. Per TECH-SPEC.md §6.5
    let result: { text: string; inputTokens: number; outputTokens: number };
    let modelUsed = "gpt-5.4";

    try {
      result = await callOpenAI({
        model: "gpt-5.4",
        maxTokens: 2000,
        systemPrompt: `You are a real Reddit power user — someone who has been on Reddit for years, participates genuinely in communities, and has deep domain expertise. You write comments that get upvoted because they're genuinely helpful, not because they're promotional.

Your comments sound like they come from a person with real experience, not a marketing team. You use casual language, admit when things are complicated, share specific numbers from real experience, and ask thoughtful questions.

You NEVER mention any business, product, or tool by name unless the OP specifically asked for recommendations. Even then, you mention it as "one option among others" — never the hero.

Reddit is not where deals close. It's where trust begins. Off-platform assets like a checklist, comparison guide, case study, or how-to resource is where value lives — but only share these if genuinely relevant and asked for.

Always return valid JSON.`,
      userMessage: prompt,
    });
    } catch (openaiErr) {
      console.error("[drafts] OpenAI failed, falling back to Claude:", (openaiErr as Error).message);
      modelUsed = "gpt-5.4";
      result = await callClaude({
        model: "claude-sonnet-4-20250514",
        maxTokens: 2000,
        systemPrompt: `You are a real Reddit power user. Write authentic, helpful comments. Never write promotional content. Always return valid JSON.`,
        userMessage: prompt,
      });
    }

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
    await deductCredits(user.id, "draft_generation", totalTokens, modelUsed, alert_id);

    return NextResponse.json({
      drafts: savedDrafts,
      subreddit_rules: rules,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const errorStack = err instanceof Error ? err.stack : undefined;
    console.error("Draft generation failed:", errorMessage);
    if (errorStack) console.error("Stack:", errorStack);
    return NextResponse.json({ error: `Failed to generate drafts: ${errorMessage}` }, { status: 500 });
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
    const { data: planData } = await supabase.from("users").select("plan_tier").eq("id", user.id).single();
    return NextResponse.json({
      error: "Insufficient credits",
      balance: creditCheck.balance,
      plan_tier: planData?.plan_tier || "free",
    }, { status: 402 });
  }

  const { draft_id } = await request.json();

  // Get existing draft (separate queries to avoid RLS join issues)
  // Get business for IDOR protection
  const { data: business } = await supabase
    .from("businesses")
    .select("id")
    .eq("user_id", user.id)
    .single();
  if (!business) return NextResponse.json({ error: "No business found" }, { status: 404 });

  const { data: existingDraft } = await supabase
    .from("comment_drafts")
    .select("*")
    .eq("id", draft_id)
    .eq("business_id", business.id)
    .single();

  if (!existingDraft) return NextResponse.json({ error: "Draft not found" }, { status: 404 });

  // Get alert details separately
  const { data: draftAlert } = await supabase
    .from("alerts")
    .select("post_title, post_body, category, subreddit_id")
    .eq("id", existingDraft.alert_id)
    .single();

  if (!draftAlert) return NextResponse.json({ error: "Associated alert not found" }, { status: 404 });

  // Get subreddit name
  const { data: draftSub } = await supabase
    .from("monitored_subreddits")
    .select("subreddit_name")
    .eq("id", draftAlert.subreddit_id)
    .single();

  const sub = draftSub?.subreddit_name || "unknown";

  try {
    const toneGuide = existingDraft.tone?.includes("Story") || existingDraft.tone?.includes("Experience")
      ? "Lead with a personal story or anecdote. Share what you tried, what failed, what worked. Feel like a peer sharing war stories over coffee."
      : "Lead with a specific framework, checklist, or step-by-step approach. Structured but still conversational. Feel like the smartest person in the thread dropping actionable knowledge.";

    const prompt = `Regenerate this Reddit comment for a post in r/${sub}.

POST:
Title: ${draftAlert.post_title}
Body: ${(draftAlert.post_body as string || "").slice(0, 800)}

TONE: ${existingDraft.tone}
${toneGuide}

PREVIOUS VERSION (write something DIFFERENT — new angle, new anecdote, new approach):
"${existingDraft.draft_text.slice(0, 300)}"

RULES:
- Hook with the OP's specific problem. Show you read their post.
- Speak from personal experience: "I ran into this...", "What worked for us..."
- Include at least one specific number, metric, or concrete detail
- End with a genuine question or thought-provoking point
- NO product mentions, NO links, NO self-promotion
- Use casual Reddit tone: "honestly", "the thing is", "kinda", "ngl"
- Keep between 80-200 words. Punchy > long.

Return ONLY the comment text. No JSON, no quotes, no meta-commentary.`;

    // Primary: OpenAI GPT-4o. Fallback: Claude Sonnet.
    let result: { text: string; inputTokens: number; outputTokens: number };
    let regenModel = "gpt-4o";
    const sysPrompt = "You are a real Reddit power user with years of genuine community participation. Write comments that get upvoted because they're helpful, specific, and human — not promotional. Return only the comment text.";

    try {
      result = await callOpenAI({ model: "gpt-5.4", maxTokens: 600, systemPrompt: sysPrompt, userMessage: prompt });
    } catch {
      regenModel = "claude-sonnet-4-20250514";
      result = await callClaude({ model: "claude-sonnet-4-20250514", maxTokens: 600, systemPrompt: sysPrompt, userMessage: prompt });
    }

    const totalTokens = result.inputTokens + result.outputTokens;

    // Update the draft
    const { data: updated } = await supabase
      .from("comment_drafts")
      .update({ draft_text: result.text, approval_state: "pending" })
      .eq("id", draft_id)
      .select()
      .single();

    await deductCredits(user.id, "draft_regeneration", totalTokens, regenModel, draft_id);

    return NextResponse.json({ draft: updated });
  } catch {
    return NextResponse.json({ error: "Regeneration failed" }, { status: 500 });
  }
}
