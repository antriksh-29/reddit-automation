/**
 * Pass 2: LLM Relevance Scoring + Priority Calculation
 * Uses Claude Haiku for relevance scoring.
 * Ref: PRODUCT-SPEC.md §7.1 (Pass 2), TECH-SPEC.md §7
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

import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
import { join } from "path";
import type { RedditPost } from "./reddit.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Load prompt template once
const promptTemplate = readFileSync(
  join(process.cwd(), "prompts", "relevance-scoring.md"),
  "utf-8"
);

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

/**
 * Pass 2: Score a post's relevance using Claude Haiku.
 */
export async function scoreRelevance(
  post: RedditPost,
  business: BusinessContext
): Promise<ScoringResult> {
  const allKeywords = [
    ...(business.keywords.primary || []),
    ...(business.keywords.discovery || []),
  ];

  const prompt = promptTemplate
    .replace("{{business_description}}", business.description || "")
    .replace("{{icp_description}}", business.icp_description || "")
    .replace("{{keywords}}", allKeywords.join(", "))
    .replace("{{competitors}}", business.competitors.join(", "))
    .replace("{{subreddit}}", post.subreddit)
    .replace("{{post_title}}", post.title)
    .replace("{{post_body}}", post.selftext.slice(0, 1500)) // Truncate long posts
    .replace("{{upvotes}}", String(post.ups))
    .replace("{{num_comments}}", String(post.num_comments));

  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 100,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const text =
      response.content[0].type === "text" ? response.content[0].text : "";

    // Parse JSON from response (handle potential markdown wrapping)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn("[scoring] Failed to parse LLM response:", text);
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
    console.error("[scoring] LLM call failed:", error);
    // Fallback: return middle score to not discard the post
    return { relevanceScore: 0.5, category: "industry_discussion" };
  }
}

/**
 * Calculate recency score based on post age.
 * Ref: PRODUCT-SPEC.md §7.1 (recency tiers)
 */
function recencyScore(postCreatedUtc: number): number {
  const ageMinutes = (Date.now() / 1000 - postCreatedUtc) / 60;

  if (ageMinutes < 15) return 1.0;
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
  if (roundedScore > 0.7) level = "high";
  else if (roundedScore >= 0.4) level = "medium";
  else level = "low";

  return { score: roundedScore, level, factors };
}
