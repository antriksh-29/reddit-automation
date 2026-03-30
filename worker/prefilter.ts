/**
 * Pass 1: GPT-5.4-nano Relevance Pre-filter
 * Replaces MiniLM embeddings with GPT-5.4-nano for intent-aware filtering.
 * Ref: PRODUCT-SPEC.md §7.1 (Pass 1), TECH-SPEC.md §7
 *
 * WHY NANO OVER MiniLM:
 *   MiniLM uses semantic similarity (topic overlap). It can't distinguish
 *   "I need a Reddit monitoring tool" (RELEVANT) from "Share your SaaS
 *   marketing tactics" (IRRELEVANT) because both are semantically close
 *   to "SaaS founders doing Reddit marketing."
 *
 *   Nano understands INTENT and CONTEXT. It correctly rejects generic SaaS
 *   chatter while catching nuanced pain points and solution requests.
 *
 *   Real data (200 posts): MiniLM passed 100%, Nano passed 4.5%.
 *   Of the 200 alerts MiniLM+Haiku created, only 9 were actually relevant.
 *
 * COST: ~$0.00005 per post (negligible). Saves money overall because
 *   fewer posts reach the expensive Haiku scoring step.
 */

import OpenAI from "openai";
import type { RedditPost } from "./reddit.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface UserProfile {
  embedding_vectors: number[] | null;
  keywords: { primary: string[]; discovery: string[] };
  competitors: string[];
  description?: string;
  icp_description?: string;
}

export interface PrefilterResult {
  passed: boolean;
  category: string;
  reason: string;
  pass1Score: number;
  // Legacy fields kept for compatibility with scanner.ts logging
  semanticScore: number;
  keywordScore: number;
  keywordMatch: boolean;
  competitorMatch: boolean;
  intentMatch: boolean;
  matchedKeywords: string[];
  matchedCompetitors: string[];
}

function buildSystemPrompt(user: UserProfile): string {
  const allKeywords = [
    ...(user.keywords.primary || []),
    ...(user.keywords.discovery || []),
  ];

  return `You are a relevance filter for a Reddit monitoring platform. Determine if a Reddit post is relevant to this specific business.

BUSINESS: ${user.description || "Reddit monitoring and intelligence platform"}
ICP: ${user.icp_description || "SaaS founders and marketers using Reddit for customer acquisition"}
KEYWORDS: ${allKeywords.join(", ")}
COMPETITORS: ${user.competitors.join(", ") || "none specified"}

A post is RELEVANT if it fits ANY of these categories for the business above:

1. PAIN POINT — Poster expresses frustration with a problem the business solves. They know something hurts but haven't framed it as a tool request yet. Look for: complaints about manual work the business automates, time wasted on tasks the business streamlines, frustration with existing tools in the space.

2. SOLUTION REQUEST — Poster is actively looking for or evaluating tools in the business's category. They've moved past frustration and are in "shopping mode." Look for: "looking for", "recommend", "best tool for", "any suggestions", "alternative to", competitor name mentions.

3. COMPETITOR DISSATISFACTION — Poster specifically names a competitor and expresses dissatisfaction or is seeking alternatives. The conversation is anchored around an existing product the business competes with.

4. EXPERIENCE SHARING — Poster shares their personal experience with the workflow or problem space the business addresses. They're telling the community what they found — reviews, comparisons, stack-sharing. This is only relevant if the experience directly relates to the business's domain, NOT generic industry experience.

5. INDUSTRY DISCUSSION — Poster discusses strategies, best practices, or trends directly related to the business's domain. They're in "learning mode" about the specific area the business operates in.

A post is NOT RELEVANT if:
- Generic industry discussion with NO connection to the business's specific domain
- Someone promoting their own unrelated product
- General advice not specific to the business's problem space
- Tech/AI discussion with no connection to the business's domain
- The only overlap is the subreddit name or generic terms

Be STRICT. When in doubt, reject. Users want fewer, higher-quality alerts.

Respond ONLY with JSON: {"relevant": true/false, "category": "pain_point|solution_request|competitor_dissatisfaction|experience_sharing|industry_discussion|none", "reason": "15 words max"}`;
}

/**
 * Run Pass 1 pre-filter on a single post using GPT-5.4-nano.
 * Returns relevance decision with category and reason.
 */
export async function prefilterPost(
  post: RedditPost,
  user: UserProfile
): Promise<PrefilterResult> {
  const postText = `${post.title} ${post.selftext || ""}`.substring(0, 500);

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5.4-nano",
      messages: [
        { role: "system", content: buildSystemPrompt(user) },
        { role: "user", content: `Title: ${post.title}\nBody: ${(post.selftext || "").substring(0, 300)}` },
      ],
      max_completion_tokens: 80,
      temperature: 0,
    });

    const text = response.choices[0]?.message?.content || "";
    let parsed: { relevant: boolean; category: string; reason: string };

    try {
      parsed = JSON.parse(text);
    } catch {
      // If JSON parsing fails, default to reject
      console.warn(`[prefilter] Failed to parse nano response: ${text.substring(0, 100)}`);
      parsed = { relevant: false, category: "none", reason: "parse_error" };
    }

    // Quick keyword/competitor check for logging (not used for filtering)
    const postLower = postText.toLowerCase();
    const matchedCompetitors = user.competitors.filter(
      (c) => postLower.includes(c.toLowerCase())
    );
    const allKeywords = [...(user.keywords.primary || []), ...(user.keywords.discovery || [])];
    const matchedKeywords = allKeywords.filter(
      (kw) => kw.split(/\s+/).some((w) => w.length > 3 && postLower.includes(w.toLowerCase()))
    );

    return {
      passed: parsed.relevant === true,
      category: parsed.category || "none",
      reason: parsed.reason || "",
      pass1Score: parsed.relevant ? 0.8 : 0.1, // Binary for nano — 0.8 if relevant, 0.1 if not
      semanticScore: 0, // Not used with nano
      keywordScore: 0,
      keywordMatch: matchedKeywords.length > 0,
      competitorMatch: matchedCompetitors.length > 0,
      intentMatch: false,
      matchedKeywords,
      matchedCompetitors,
    };
  } catch (error) {
    // On API failure, fall back to keyword-only matching
    console.error(`[prefilter] Nano API error: ${error instanceof Error ? error.message : "unknown"}`);

    const postLower = postText.toLowerCase();
    const allKeywords = [...(user.keywords.primary || []), ...(user.keywords.discovery || [])];
    const matchedKeywords = allKeywords.filter(
      (kw) => kw.split(/\s+/).some((w) => w.length > 3 && postLower.includes(w.toLowerCase()))
    );
    const matchedCompetitors = user.competitors.filter(
      (c) => postLower.includes(c.toLowerCase())
    );

    // Fallback: pass if any keyword or competitor matches
    const fallbackPass = matchedKeywords.length > 0 || matchedCompetitors.length > 0;

    return {
      passed: fallbackPass,
      category: "none",
      reason: "fallback_keyword_match",
      pass1Score: fallbackPass ? 0.5 : 0.1,
      semanticScore: 0,
      keywordScore: 0,
      keywordMatch: matchedKeywords.length > 0,
      competitorMatch: matchedCompetitors.length > 0,
      intentMatch: false,
      matchedKeywords,
      matchedCompetitors,
    };
  }
}
