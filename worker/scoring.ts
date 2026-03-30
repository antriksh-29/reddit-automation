/**
 * Pass 2: GPT-5.4-nano Relevance Scoring + Priority Calculation
 * Replaces Claude Haiku with nano — 8-10x cheaper, same quality on pre-filtered posts.
 * Ref: PRODUCT-SPEC.md §7.1 (Pass 2), TECH-SPEC.md §7
 *
 * Posts reaching Pass 2 have already been filtered by nano in Pass 1,
 * so they're all genuinely relevant. Pass 2's job is to:
 *   1. Assign a relevance score (0.0-1.0)
 *   2. Categorize the post (pain_point, solution_request, etc.)
 *
 * Priority formula (PRODUCT-SPEC.md):
 *   40% relevance + 30% recency + 15% velocity + 15% intent
 *
 * Recency tiers:
 *   < 15 min  → 1.0
 *   < 1 hour  → 0.8
 *   < 3 hours → 0.6
 *   < 6 hours → 0.4
 *   < 12 hours → 0.2
 *   > 12 hours → 0.1
 */

import OpenAI from "openai";
import type { RedditPost } from "./reddit.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export type PostCategory =
  | "pain_point"
  | "solution_request"
  | "competitor_dissatisfaction"
  | "experience_sharing"
  | "industry_discussion";

export interface ScoringResult {
  relevanceScore: number;
  category: PostCategory;
}

export interface PriorityResult {
  score: number;
  level: "high" | "medium" | "low";
  factors: {
    relevance: number;
    recency: number;
    velocity: number;
    intent: number;
  };
}

interface BusinessContext {
  description: string;
  icp_description: string;
  keywords: { primary: string[]; discovery: string[] };
  competitors: string[];
}

const SCORING_SYSTEM_PROMPT = `You are a relevance scorer for a Reddit monitoring platform. Score how relevant a Reddit post is to a specific business.

This post has ALREADY been identified as potentially relevant. Your job is to:
1. Score the relevance from 0.0 to 1.0
2. Categorize the post type

SCORING GUIDE:
- 0.9-1.0: Post directly asks for or discusses a tool/solution in the business's exact category. Mentions a competitor. Describes the exact problem the business solves.
- 0.7-0.8: Post is clearly about the business's domain. The poster's situation closely matches the ICP. Strong keyword overlap.
- 0.5-0.6: Post is related to the business's domain but not a direct match. Adjacent topic that the ICP would care about.
- 0.3-0.4: Post has some connection but is tangential. Loosely related to the business's space.
- 0.1-0.2: Barely relevant. Only passed the initial filter due to surface-level overlap.

CATEGORIES:
- pain_point: Poster expresses frustration with a problem the business solves
- solution_request: Poster actively looking for tools in the business's category
- competitor_dissatisfaction: Poster names a competitor with negative sentiment or seeking alternatives
- experience_sharing: Poster shares experience with the business's domain workflow
- industry_discussion: Poster discusses strategies/trends in the business's domain

Respond ONLY with JSON: {"relevance_score": 0.0-1.0, "category": "pain_point|solution_request|competitor_dissatisfaction|experience_sharing|industry_discussion"}`;

/**
 * Pass 2: Score a post's relevance using GPT-5.4-nano.
 */
export async function scoreRelevance(
  post: RedditPost,
  business: BusinessContext
): Promise<ScoringResult> {
  const allKeywords = [
    ...(business.keywords.primary || []),
    ...(business.keywords.discovery || []),
  ];

  const userMessage = `BUSINESS: ${business.description || ""}
ICP: ${business.icp_description || ""}
KEYWORDS: ${allKeywords.join(", ")}
COMPETITORS: ${business.competitors.join(", ")}

POST:
Subreddit: r/${post.subreddit}
Title: ${post.title}
Body: ${(post.selftext || "").slice(0, 1500)}
Upvotes: ${post.ups} | Comments: ${post.num_comments}`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5.4-nano",
      messages: [
        { role: "system", content: SCORING_SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
      max_completion_tokens: 60,
      temperature: 0,
    });

    const text = response.choices[0]?.message?.content || "";

    // Parse JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn("[scoring] Failed to parse nano response:", text.substring(0, 100));
      return { relevanceScore: 0.5, category: "industry_discussion" };
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Validate score range
    const score = Math.max(0, Math.min(1, Number(parsed.relevance_score) || 0.5));

    // Validate category
    const validCategories: PostCategory[] = [
      "pain_point",
      "solution_request",
      "competitor_dissatisfaction",
      "experience_sharing",
      "industry_discussion",
    ];
    const category = validCategories.includes(parsed.category)
      ? (parsed.category as PostCategory)
      : "industry_discussion";

    return { relevanceScore: score, category };
  } catch (error) {
    console.error("[scoring] Nano scoring failed:", (error as Error).message);
    // On failure, assign a middle score — the post already passed Pass 1 so it's relevant
    return { relevanceScore: 0.5, category: "industry_discussion" };
  }
}

/**
 * Calculate recency score based on post age.
 * Ref: PRODUCT-SPEC.md §7.1 (recency tiers)
 */
function recencyScore(postCreatedUtc: number): number {
  const ageMinutes = (Date.now() / 1000 - postCreatedUtc) / 60;

  if (ageMinutes < 30) return 1.0; // Within current scan window
  if (ageMinutes < 60) return 0.8;
  if (ageMinutes < 180) return 0.6; // 3 hours
  if (ageMinutes < 360) return 0.4; // 6 hours
  if (ageMinutes < 720) return 0.2; // 12 hours
  return 0.1;
}

/**
 * Calculate engagement velocity.
 * (upvotes + comments) / minutes since posted
 * Normalized to 0-1 range.
 */
function velocityScore(post: RedditPost): number {
  const ageMinutes = Math.max(1, (Date.now() / 1000 - post.created_utc) / 60);
  const velocity = (post.ups + post.num_comments) / ageMinutes;

  // Normalize: 1.0 velocity/min is considered very high
  return Math.min(1.0, velocity);
}

/**
 * Calculate intent score from post text.
 * 1.0 = strong intent phrases, 0.5 = weak, 0.0 = none
 */
function intentScore(post: RedditPost): number {
  const text = `${post.title} ${post.selftext}`.toLowerCase();

  const strongIntent = [
    /looking for/,
    /recommend/,
    /best tool/,
    /any suggestions/,
    /alternative to/,
    /switching from/,
    /need a\b/,
    /budget \$/,
    /anyone know a good/,
  ];

  const weakIntent = [
    /how do you/,
    /what do you use/,
    /anyone use/,
    /curious about/,
    /thinking about/,
    /frustrated with/,
  ];

  if (strongIntent.some((p) => p.test(text))) return 1.0;
  if (weakIntent.some((p) => p.test(text))) return 0.5;
  return 0.0;
}

/**
 * Calculate composite priority score.
 * Ref: PRODUCT-SPEC.md §7.1
 *   40% relevance + 30% recency + 15% velocity + 15% intent
 */
export function calculatePriority(
  relevanceScore: number,
  post: RedditPost
): PriorityResult {
  const factors = {
    relevance: relevanceScore,
    recency: recencyScore(post.created_utc),
    velocity: velocityScore(post),
    intent: intentScore(post),
  };

  const score =
    factors.relevance * 0.4 +
    factors.recency * 0.3 +
    factors.velocity * 0.15 +
    factors.intent * 0.15;

  // Round to 2 decimal places
  const roundedScore = Math.round(score * 100) / 100;

  let level: "high" | "medium" | "low";
  if (roundedScore > 0.6) level = "high";
  else if (roundedScore >= 0.3) level = "medium";
  else level = "low";

  return { score: roundedScore, level, factors };
}
