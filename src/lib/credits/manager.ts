import { createAdminClient } from "@/lib/supabase/admin";
import { tokensToCredits, CREDIT_ESTIMATES, type CreditAction } from "./pricing";

/**
 * Credit Manager — all credit operations go through here.
 * Uses admin client (service_role) for writes — bypasses RLS.
 * Ref: PRODUCT-SPEC.md §12.2, TECH-SPEC.md §14
 */

export interface CreditCheckResult {
  hasEnough: boolean;
  balance: number;
  estimatedMin: number;
  estimatedMax: number;
}

export interface CreditDeductResult {
  creditsUsed: number;
  balanceAfter: number;
}

/** Pre-check: does the user have enough credits for this action? */
export async function checkCredits(
  userId: string,
  action: CreditAction
): Promise<CreditCheckResult> {
  const supabase = createAdminClient();
  const estimate = CREDIT_ESTIMATES[action];

  const { data, error } = await supabase
    .from("credit_balances")
    .select("balance")
    .eq("user_id", userId)
    .single();

  if (error || !data) {
    return {
      hasEnough: false,
      balance: 0,
      estimatedMin: estimate.min,
      estimatedMax: estimate.max,
    };
  }

  return {
    hasEnough: data.balance >= estimate.min,
    balance: Math.round(data.balance * 100) / 100,
    estimatedMin: estimate.min,
    estimatedMax: estimate.max,
  };
}

/**
 * Deduct credits after an LLM action completes.
 * Uses atomic UPDATE to prevent double-spend (concurrent requests).
 * Returns the actual credits used and remaining balance.
 */
export async function deductCredits(
  userId: string,
  action: CreditAction,
  tokensConsumed: number,
  modelUsed: string,
  referenceId?: string
): Promise<CreditDeductResult> {
  const supabase = createAdminClient();
  const creditsUsed = tokensToCredits(tokensConsumed);

  // Atomic deduction: only succeeds if balance >= creditsUsed
  const { data, error } = await supabase.rpc("deduct_credits", {
    p_user_id: userId,
    p_credits: creditsUsed,
  });

  if (error || data === null) {
    throw new Error(`Credit deduction failed: ${error?.message ?? "insufficient balance"}`);
  }

  const balanceAfter = Math.round(data * 100) / 100;

  // Log the transaction
  await supabase.from("credit_transactions").insert({
    user_id: userId,
    action_type: action,
    credits_used: creditsUsed,
    balance_after: balanceAfter,
    tokens_consumed: tokensConsumed,
    model_used: modelUsed,
    reference_id: referenceId,
  });

  return { creditsUsed, balanceAfter };
}

/** Grant credits to a user (trial grant, monthly reset, manual adjustment) */
export async function grantCredits(
  userId: string,
  credits: number,
  actionType: "trial_grant" | "monthly_reset" | "plan_upgrade" | "manual_adjustment"
): Promise<number> {
  const supabase = createAdminClient();

  // Upsert balance
  const { data, error } = await supabase
    .from("credit_balances")
    .upsert(
      {
        user_id: userId,
        balance: credits,
        last_reset_at: actionType === "monthly_reset" ? new Date().toISOString() : undefined,
      },
      { onConflict: "user_id" }
    )
    .select("balance")
    .single();

  if (error) {
    throw new Error(`Credit grant failed: ${error.message}`);
  }

  // Log the transaction
  await supabase.from("credit_transactions").insert({
    user_id: userId,
    action_type: actionType,
    credits_used: -credits, // Negative = added
    balance_after: data.balance,
    tokens_consumed: 0,
  });

  return data.balance;
}

/** Expire credits (set balance to 0, log expiry) */
export async function expireCredits(userId: string): Promise<void> {
  const supabase = createAdminClient();

  const { data } = await supabase
    .from("credit_balances")
    .select("balance")
    .eq("user_id", userId)
    .single();

  if (!data || data.balance <= 0) return;

  await supabase
    .from("credit_balances")
    .update({ balance: 0 })
    .eq("user_id", userId);

  await supabase.from("credit_transactions").insert({
    user_id: userId,
    action_type: "trial_expiry",
    credits_used: data.balance,
    balance_after: 0,
    tokens_consumed: 0,
  });
}
