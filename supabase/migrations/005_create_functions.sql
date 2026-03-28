-- Migration 005: Database functions
-- Ref: TECH-SPEC.md §14 (atomic credit deduction)

-- Atomic credit deduction: prevents double-spend via concurrent requests
-- Returns the new balance, or NULL if insufficient credits
CREATE OR REPLACE FUNCTION deduct_credits(p_user_id UUID, p_credits FLOAT)
RETURNS FLOAT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  new_balance FLOAT;
BEGIN
  UPDATE credit_balances
  SET balance = balance - p_credits,
      lifetime_used = lifetime_used + p_credits,
      updated_at = NOW()
  WHERE user_id = p_user_id
    AND balance >= p_credits
  RETURNING balance INTO new_balance;

  RETURN new_balance;  -- NULL if no row matched (insufficient balance)
END;
$$;
