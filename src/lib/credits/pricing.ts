/**
 * Plan definitions and credit pricing constants.
 * Ref: PRODUCT-SPEC.md §12, TECH-SPEC.md §14
 *
 * 1 credit ≈ 1,000 LLM tokens (input + output combined)
 * Credits are fractional — displayed to 2 decimal places.
 */

export const PLANS = {
  free: {
    name: "Free",
    price: 0,
    maxSubreddits: 3,
    maxBusinesses: 1,
    trialDays: 3,
    initialCredits: 25.0,
    monthlyCredits: 0, // No monthly reset — one-time grant
    scanning: true, // During trial only
    emailAlerts: true, // During trial only
  },
  growth: {
    name: "Growth",
    price: 39,
    maxSubreddits: 10,
    maxBusinesses: 1,
    trialDays: 0,
    initialCredits: 250.0,
    monthlyCredits: 250.0,
    scanning: true,
    emailAlerts: true,
  },
  custom: {
    name: "Custom",
    price: null, // Negotiated
    maxSubreddits: 10, // Per business, negotiated
    maxBusinesses: null, // Negotiated
    trialDays: 0,
    initialCredits: null, // Negotiated
    monthlyCredits: null, // Negotiated
    scanning: true,
    emailAlerts: true,
  },
} as const;

export type PlanTier = keyof typeof PLANS;

/**
 * Credit cost estimates per action (shown to user BEFORE action).
 * Actual cost = tokens_consumed / 1000 (calculated AFTER action).
 */
export const CREDIT_ESTIMATES = {
  thread_analysis: { min: 2, max: 8, label: "2-8 credits" },
  thread_chat: { min: 1, max: 2, label: "1-2 credits" },
  draft_generation: { min: 2, max: 4, label: "2-4 credits" },
  draft_regeneration: { min: 1, max: 2, label: "1-2 credits" },
} as const;

export type CreditAction = keyof typeof CREDIT_ESTIMATES;

/** Convert token count to credit cost (2 decimal precision) */
export function tokensToCredits(tokens: number): number {
  return Math.round((tokens / 1000) * 100) / 100;
}
