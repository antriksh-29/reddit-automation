export interface CreditBalance {
  id: string;
  user_id: string;
  balance: number;
  lifetime_used: number;
  last_reset_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreditTransaction {
  id: string;
  user_id: string;
  action_type: string;
  credits_used: number;
  balance_after: number;
  tokens_consumed: number | null;
  model_used: string | null;
  reference_id: string | null;
  created_at: string;
}
