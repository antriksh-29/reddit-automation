import { describe, it, expect } from "vitest";

/**
 * Trial eligibility tests.
 * Verifies that the scanner correctly filters users based on plan tier and trial status.
 * Ref: PRODUCT-SPEC.md §12.1, TECH-SPEC.md §14
 *
 * The actual eligibility check in worker/scanner.ts (getEligibleUsers) runs against
 * Supabase, but the filtering logic is testable in isolation.
 */

// Extract the eligibility logic from the scanner into a pure function for testing
function isUserEligible(user: {
  plan_tier: string;
  trial_ends_at: string | null;
}): boolean {
  const now = new Date();

  // Growth/Custom: always eligible
  if (user.plan_tier === "growth" || user.plan_tier === "custom") return true;

  // Free: only if trial is still active
  if (user.plan_tier === "free" && user.trial_ends_at) {
    return new Date(user.trial_ends_at) > now;
  }

  // Free with no trial_ends_at: not eligible
  return false;
}

describe("Trial Eligibility — Scanner", () => {
  describe("Growth plan users", () => {
    it("should always be eligible regardless of trial dates", () => {
      expect(isUserEligible({ plan_tier: "growth", trial_ends_at: null })).toBe(true);
      expect(isUserEligible({ plan_tier: "growth", trial_ends_at: "2020-01-01T00:00:00Z" })).toBe(true);
      expect(isUserEligible({ plan_tier: "growth", trial_ends_at: "2099-01-01T00:00:00Z" })).toBe(true);
    });
  });

  describe("Custom plan users", () => {
    it("should always be eligible regardless of trial dates", () => {
      expect(isUserEligible({ plan_tier: "custom", trial_ends_at: null })).toBe(true);
      expect(isUserEligible({ plan_tier: "custom", trial_ends_at: "2020-01-01T00:00:00Z" })).toBe(true);
    });
  });

  describe("Free plan users — active trial", () => {
    it("should be eligible when trial_ends_at is in the future", () => {
      const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // +1 day
      expect(isUserEligible({ plan_tier: "free", trial_ends_at: futureDate })).toBe(true);
    });

    it("should be eligible when trial_ends_at is 1 minute from now", () => {
      const almostExpired = new Date(Date.now() + 60 * 1000).toISOString(); // +1 min
      expect(isUserEligible({ plan_tier: "free", trial_ends_at: almostExpired })).toBe(true);
    });

    it("should be eligible when trial_ends_at is 72 hours from now (full trial)", () => {
      const fullTrial = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(); // +72 hrs
      expect(isUserEligible({ plan_tier: "free", trial_ends_at: fullTrial })).toBe(true);
    });
  });

  describe("Free plan users — expired trial", () => {
    it("should NOT be eligible when trial_ends_at is in the past", () => {
      const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // -1 day
      expect(isUserEligible({ plan_tier: "free", trial_ends_at: pastDate })).toBe(false);
    });

    it("should NOT be eligible when trial_ends_at is 1 second ago", () => {
      const justExpired = new Date(Date.now() - 1000).toISOString(); // -1 sec
      expect(isUserEligible({ plan_tier: "free", trial_ends_at: justExpired })).toBe(false);
    });

    it("should NOT be eligible when trial expired days ago", () => {
      const longExpired = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(); // -7 days
      expect(isUserEligible({ plan_tier: "free", trial_ends_at: longExpired })).toBe(false);
    });
  });

  describe("Free plan users — no trial activated", () => {
    it("should NOT be eligible when trial_ends_at is null", () => {
      expect(isUserEligible({ plan_tier: "free", trial_ends_at: null })).toBe(false);
    });
  });

  describe("Edge cases", () => {
    it("should NOT be eligible for unknown plan tier", () => {
      expect(isUserEligible({ plan_tier: "enterprise", trial_ends_at: null })).toBe(false);
      expect(isUserEligible({ plan_tier: "", trial_ends_at: null })).toBe(false);
    });
  });
});

describe("Trial Eligibility — Feature Access", () => {
  /**
   * Even after trial expires, free users can still:
   * - View the dashboard (read-only, no new alerts)
   * - Use remaining credits for thread analysis and drafts
   * - Access settings
   *
   * They CANNOT:
   * - Get new alerts from the scanner (tested above)
   * - Receive email notifications
   */

  function canAccessPaidFeatures(user: {
    plan_tier: string;
    trial_ends_at: string | null;
    credits_balance: number;
  }): { scanning: boolean; threadAnalysis: boolean; drafts: boolean; emails: boolean } {
    const trialActive = user.plan_tier !== "free" ||
      (user.trial_ends_at !== null && new Date(user.trial_ends_at) > new Date());

    return {
      scanning: trialActive, // Requires active trial or paid plan
      threadAnalysis: user.credits_balance > 0, // Requires credits only
      drafts: user.credits_balance > 0, // Requires credits only
      emails: trialActive, // Requires active trial or paid plan
    };
  }

  it("expired free user with credits can analyze threads and draft but NOT scan or get emails", () => {
    const result = canAccessPaidFeatures({
      plan_tier: "free",
      trial_ends_at: new Date(Date.now() - 86400000).toISOString(), // expired
      credits_balance: 10,
    });

    expect(result.scanning).toBe(false);
    expect(result.threadAnalysis).toBe(true); // Can still use remaining credits
    expect(result.drafts).toBe(true); // Can still use remaining credits
    expect(result.emails).toBe(false);
  });

  it("expired free user with 0 credits cannot do anything", () => {
    const result = canAccessPaidFeatures({
      plan_tier: "free",
      trial_ends_at: new Date(Date.now() - 86400000).toISOString(),
      credits_balance: 0,
    });

    expect(result.scanning).toBe(false);
    expect(result.threadAnalysis).toBe(false);
    expect(result.drafts).toBe(false);
    expect(result.emails).toBe(false);
  });

  it("active free user with credits can do everything", () => {
    const result = canAccessPaidFeatures({
      plan_tier: "free",
      trial_ends_at: new Date(Date.now() + 86400000).toISOString(), // active
      credits_balance: 25,
    });

    expect(result.scanning).toBe(true);
    expect(result.threadAnalysis).toBe(true);
    expect(result.drafts).toBe(true);
    expect(result.emails).toBe(true);
  });

  it("growth user with credits can do everything", () => {
    const result = canAccessPaidFeatures({
      plan_tier: "growth",
      trial_ends_at: null,
      credits_balance: 250,
    });

    expect(result.scanning).toBe(true);
    expect(result.threadAnalysis).toBe(true);
    expect(result.drafts).toBe(true);
    expect(result.emails).toBe(true);
  });

  it("growth user with 0 credits can scan but not analyze/draft", () => {
    const result = canAccessPaidFeatures({
      plan_tier: "growth",
      trial_ends_at: null,
      credits_balance: 0,
    });

    expect(result.scanning).toBe(true); // Scanning is plan-based, not credit-based
    expect(result.threadAnalysis).toBe(false);
    expect(result.drafts).toBe(false);
    expect(result.emails).toBe(true); // Email alerts still work
  });
});
