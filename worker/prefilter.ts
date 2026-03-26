/**
 * Pass 1: Semantic + Keyword + Regex Pre-filter
 * Runs locally — zero LLM API cost.
 * Ref: PRODUCT-SPEC.md §7.1 (Pass 1), TECH-SPEC.md §7
 *
 * Scoring:
 *   semantic_score (cosine similarity, 0.0-1.0)
 *   + keyword_boost (+0.2 if keyword match, +0.3 if competitor match)
 *   + intent_boost (+0.15 if intent regex matches)
 *   = pass1_score (capped at 1.0)
 *
 * Threshold: pass1_score >= 0.4 passes to Pass 2
 */

import { embed, cosineSimilarity } from "./embeddings.js";
import type { RedditPost } from "./reddit.js";

const PASS1_THRESHOLD = 0.4;

// Intent signal regex patterns — phrases indicating buying/seeking behavior
const INTENT_PATTERNS = [
  /looking for/i,
  /recommend/i,
  /alternative to/i,
  /help me find/i,
  /anyone use/i,
  /best tool for/i,
  /need a\b/i,
  /budget \$/i,
  /switching from/i,
  /what do you use/i,
  /tired of/i,
  /any suggestions/i,
  /what['']s the best/i,
  /can anyone suggest/i,
  /looking to replace/i,
  /how do you handle/i,
  /frustrated with/i,
  /hate doing/i,
  /waste of time/i,
  /so tedious/i,
  /anyone else deal with/i,
  /is it just me or/i,
];

export interface UserProfile {
  embedding_vectors: number[] | null;
  keywords: { primary: string[]; discovery: string[] };
  competitors: string[];
}

export interface PrefilterResult {
  pass1Score: number;
  semanticScore: number;
  keywordMatch: boolean;
  competitorMatch: boolean;
  intentMatch: boolean;
  matchedKeywords: string[];
  matchedCompetitors: string[];
  passed: boolean;
}

/**
 * Run Pass 1 pre-filter on a single post against a user profile.
 * Returns score and match details.
 */
export async function prefilterPost(
  post: RedditPost,
  user: UserProfile
): Promise<PrefilterResult> {
  const postText = `${post.title} ${post.selftext}`.toLowerCase();

  // 1. Semantic similarity (if user has embeddings)
  let semanticScore = 0;
  if (user.embedding_vectors && user.embedding_vectors.length > 0) {
    const postEmbedding = await embed(`${post.title} ${post.selftext}`);
    semanticScore = cosineSimilarity(postEmbedding, user.embedding_vectors);
    // Clamp to 0-1 range (cosine can be negative for very dissimilar)
    semanticScore = Math.max(0, semanticScore);
  }

  // 2. Keyword matching (primary + discovery)
  const allKeywords = [
    ...(user.keywords.primary || []),
    ...(user.keywords.discovery || []),
  ];
  const matchedKeywords = allKeywords.filter((kw) =>
    postText.includes(kw.toLowerCase())
  );
  const keywordMatch = matchedKeywords.length > 0;
  const keywordBoost = keywordMatch ? 0.2 : 0;

  // 3. Competitor mention
  const matchedCompetitors = user.competitors.filter((comp) =>
    postText.includes(comp.toLowerCase())
  );
  const competitorMatch = matchedCompetitors.length > 0;
  const competitorBoost = competitorMatch ? 0.3 : 0;

  // 4. Intent signal regex
  const intentMatch = INTENT_PATTERNS.some((pattern) => pattern.test(postText));
  const intentBoost = intentMatch ? 0.15 : 0;

  // 5. Combined score (capped at 1.0)
  const pass1Score = Math.min(
    1.0,
    semanticScore + keywordBoost + competitorBoost + intentBoost
  );

  return {
    pass1Score,
    semanticScore,
    keywordMatch,
    competitorMatch,
    intentMatch,
    matchedKeywords,
    matchedCompetitors,
    passed: pass1Score >= PASS1_THRESHOLD,
  };
}
