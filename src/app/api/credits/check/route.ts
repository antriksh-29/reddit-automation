import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { checkCredits } from "@/lib/credits/manager";
import { CREDIT_ESTIMATES, type CreditAction } from "@/lib/credits/pricing";

/**
 * POST /api/credits/check — Pre-check credits before an action.
 * Body: { action: "thread_analysis" | "thread_chat" | "draft_generation" | "draft_regeneration" }
 * Returns: { hasEnough, balance, estimatedMin, estimatedMax, label }
 */
export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { action } = await request.json();
  if (!action || !CREDIT_ESTIMATES[action as CreditAction]) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  const result = await checkCredits(user.id, action as CreditAction);
  const estimate = CREDIT_ESTIMATES[action as CreditAction];

  return NextResponse.json({
    ...result,
    label: estimate.label,
  });
}
