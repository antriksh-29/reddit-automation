import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/**
 * GET /api/threads — List all thread analyses for the user (sidebar history).
 * Ref: PRODUCT-SPEC.md §5.3 (Sidebar history)
 */
export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: business } = await supabase
    .from("businesses")
    .select("id")
    .eq("user_id", user.id)
    .single();

  if (!business) return NextResponse.json({ threads: [] });

  const { data } = await supabase
    .from("thread_analyses")
    .select("id, thread_title, reddit_url, sentiment, analysis_status, created_at")
    .eq("business_id", business.id)
    .eq("analysis_status", "complete")
    .order("created_at", { ascending: false })
    .limit(50);

  return NextResponse.json({ threads: data || [] });
}
