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

  return `You are a relevance filter. Determine if a Reddit post is relevant to a specific business.

BUSINESS: ${user.description || "Reddit monitoring and intelligence platform"}
ICP: ${user.icp_description || "SaaS founders and marketers using Reddit for customer acquisition"}
KEYWORDS: ${allKeywords.join(", ")}
COMPETITORS: ${user.competitors.join(", ") || "none specified"}

PRIMARY RELEVANCE CHECK (use these to determine if the post is relevant):

A post is RELEVANT if it matches ANY of these criteria:

1. BUSINESS MATCH — The post discusses the PROBLEM the business solves, the DOMAIN the business operates in, or the WORKFLOW the business automates. The connection must be specific to what this business does, not just the broader industry.

2. KEYWORD MATCH — The post contains or discusses topics closely related to the KEYWORDS listed above. The match should be semantic (about the same concept), not just surface-level word overlap.

3. ICP MATCH — The post is written by or clearly targets someone matching the ICP description. They are describing a challenge, need, or experience that someone in the ICP would have SPECIFICALLY related to the business's domain.

4. COMPETITOR MATCH — The post mentions any of the COMPETITORS by name, discusses switching from them, compares tools in the same category, or expresses opinions about them.

SECONDARY CHECK (use ONLY when primary check is borderline — the post seems related but you're not sure):

If a post doesn't clearly match the primary criteria above but might still be relevant, check if it fits one of these post types IN THE CONTEXT of the business's domain:
- Pain point: frustration with a problem the business solves
- Solution request: actively seeking tools in the business's category
- Experience sharing: firsthand experience with the business's domain workflow
- Industry discussion: strategies/trends specific to the business's domain

A post is NOT RELEVANT if:
- It's a generic industry discussion with NO specific connection to the business's domain, keywords, ICP, or competitors
- Someone promoting their own unrelated product
- General advice that could apply to any business
- The only overlap is being posted in a related subreddit or using generic terms like "SaaS" or "marketing"

Be STRICT. When in doubt, reject. Users want fewer, higher-quality alerts — not a firehose.

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
  const postBody = (post.selftext || "").substring(0, 1500);
  const postText = `${post.title} ${postBody}`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5.4-nano",
      messages: [
        { role: "system", content: buildSystemPrompt(user) },
        { role: "user", content: `Title: ${post.title}\nBody: ${postBody}` },
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
    // On API failure, reject the post. No keyword fallback — it's too noisy.
    console.error(`[prefilter] Nano API error, rejecting post: ${error instanceof Error ? error.message : "unknown"}`);

    return {
      passed: false,
      category: "none",
      reason: "api_error",
      pass1Score: 0,
      semanticScore: 0,
      keywordScore: 0,
      keywordMatch: false,
      competitorMatch: false,
      intentMatch: false,
      matchedKeywords: [],
      matchedCompetitors: [],
    };
  }
}
