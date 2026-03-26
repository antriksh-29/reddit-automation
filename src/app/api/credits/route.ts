import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("credit_balances")
    .select("balance, lifetime_used")
    .eq("user_id", user.id)
    .single();

  if (error || !data) {
    // No credit balance row yet (hasn't completed onboarding)
    return NextResponse.json({ balance: 0, lifetime_used: 0 });
  }

  return NextResponse.json({
    balance: Math.round(data.balance * 100) / 100,
    lifetime_used: Math.round(data.lifetime_used * 100) / 100,
  });
}
