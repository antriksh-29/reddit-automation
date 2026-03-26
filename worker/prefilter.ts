/**
 * Pass 1: Semantic + Keyword + Regex Pre-filter
 * Runs locally — zero LLM API cost.
 * Ref: PRODUCT-SPEC.md §7.1 (Pass 1), TECH-SPEC.md §7
 *
 * SCORING STRATEGY:
 *   The semantic score from MiniLM is the PRIMARY signal — it captures
 *   meaning even when exact keywords don't appear. Keyword/competitor/intent
 *   matches provide BOOSTS on top of the semantic score.
 *
 *   pass1_score = semantic_score + keyword_boost + competitor_boost + intent_boost
 *   (capped at 1.0)
 *
 *   Threshold: pass1_score >= 0.35 passes to Pass 2
 *
 * KEYWORD MATCHING:
 *   Word-level matching, not exact substring. Each keyword is split into
 *   individual words, and we check if ALL significant words appear anywhere
 *   in the post. This means:
 *     - keyword "incident response tool" matches a post containing
 *       "our incident response was terrible" (all significant words present)
 *     - keyword "root cause analysis" matches "we did a root cause investigation"
 *       (2 of 3 significant words = partial match)
 */

import { embed, cosineSimilarity } from "./embeddings.js";
import type { RedditPost } from "./reddit.js";

const PASS1_THRESHOLD = 0.35;

// Intent signal regex patterns — phrases indicating buying/seeking/pain behavior
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
  /what are you using/i,
  /migrat(e|ed|ing) from/i,
  /end of life/i,
  /eol/i,
  /how do you/i,
  /what's your process/i,
  /evaluating/i,
  /comparing/i,
  /worth it/i,
  /anyone tried/i,
];

// Stop words to ignore in keyword matching
const STOP_WORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "to", "of", "in", "for",
  "on", "with", "at", "by", "from", "as", "into", "through", "during",
  "before", "after", "and", "but", "or", "nor", "not", "so", "yet",
  "both", "either", "neither", "each", "every", "all", "any", "few",
  "more", "most", "other", "some", "such", "no", "only", "own", "same",
  "than", "too", "very", "just", "about", "up", "out", "how", "what",
  "when", "where", "who", "which", "why", "this", "that", "these", "those",
  "it", "its", "my", "your", "our", "their", "me", "you", "we", "they",
]);

export interface UserProfile {
  embedding_vectors: number[] | null;
  keywords: { primary: string[]; discovery: string[] };
  competitors: string[];
}

export interface PrefilterResult {
  pass1Score: number;
  semanticScore: number;
  keywordScore: number;
  keywordMatch: boolean;
  competitorMatch: boolean;
  intentMatch: boolean;
  matchedKeywords: string[];
  matchedCompetitors: string[];
  passed: boolean;
}

/**
 * Word-level keyword matching.
 * Splits keyword into significant words (removing stop words),
 * then checks what percentage of those words appear in the post.
 *
 * Returns a match ratio: 0.0 (no words match) to 1.0 (all words match).
 * A keyword is considered "matched" if ratio >= 0.6 (most significant words present).
 */
function keywordMatchRatio(keyword: string, postWords: Set<string>): number {
  const kwWords = keyword
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

  if (kwWords.length === 0) return 0;

  const matched = kwWords.filter((w) => {
    // Check exact word match
    if (postWords.has(w)) return true;
    // Check stem match — if post contains a word starting with this keyword word
    // (e.g., "monitor" matches "monitoring", "automat" matches "automation")
    const stem = w.length > 4 ? w.slice(0, -2) : w;
    for (const pw of postWords) {
      if (pw.startsWith(stem) || stem.startsWith(pw.slice(0, -2))) return true;
    }
    return false;
  });

  return matched.length / kwWords.length;
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
  const postWords = new Set(
    postText.split(/[\s,;:.!?()[\]{}"'\/\-]+/).filter((w) => w.length > 2)
  );

  // 1. Semantic similarity (PRIMARY signal — this is why we loaded MiniLM)
  let semanticScore = 0;
  if (user.embedding_vectors && user.embedding_vectors.length > 0) {
    const postEmbedding = await embed(`${post.title} ${post.selftext}`);
    semanticScore = cosineSimilarity(postEmbedding, user.embedding_vectors);
    semanticScore = Math.max(0, semanticScore);
  }

  // 2. Word-level keyword matching (primary + discovery)
  const allKeywords = [
    ...(user.keywords.primary || []),
    ...(user.keywords.discovery || []),
  ];

  const keywordMatches: { keyword: string; ratio: number }[] = [];
  for (const kw of allKeywords) {
    const ratio = keywordMatchRatio(kw, postWords);
    if (ratio >= 0.5) {
      // At least half the significant words match
      keywordMatches.push({ keyword: kw, ratio });
    }
  }

  const matchedKeywords = keywordMatches.map((m) => m.keyword);
  const keywordMatch = matchedKeywords.length > 0;
  // Best keyword match ratio determines boost strength (0.1 to 0.2)
  const bestKeywordRatio = keywordMatches.length > 0
    ? Math.max(...keywordMatches.map((m) => m.ratio))
    : 0;
  const keywordBoost = keywordMatch ? 0.1 + bestKeywordRatio * 0.1 : 0;

  // 3. Competitor mention (case-insensitive, word boundary aware)
  const matchedCompetitors = user.competitors.filter((comp) => {
    const compLower = comp.toLowerCase();
    // Check if the competitor name appears as a word (not just substring)
    return postWords.has(compLower) || postText.includes(compLower);
  });
  const competitorMatch = matchedCompetitors.length > 0;
  const competitorBoost = competitorMatch ? 0.25 : 0;

  // 4. Intent signal regex
  const intentMatch = INTENT_PATTERNS.some((pattern) => pattern.test(postText));
  const intentBoost = intentMatch ? 0.1 : 0;

  // 5. Combined score (capped at 1.0)
  //    Semantic is the foundation; keyword/competitor/intent are boosts
  const pass1Score = Math.min(
    1.0,
    semanticScore + keywordBoost + competitorBoost + intentBoost
  );

  return {
    pass1Score,
    semanticScore,
    keywordScore: bestKeywordRatio,
    keywordMatch,
    competitorMatch,
    intentMatch,
    matchedKeywords,
    matchedCompetitors,
    passed: pass1Score >= PASS1_THRESHOLD,
  };
}
