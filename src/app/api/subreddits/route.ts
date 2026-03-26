import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/** GET /api/subreddits — list user's monitored subreddits */
export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: business } = await supabase
    .from("businesses")
    .select("id")
    .eq("user_id", user.id)
    .single();

  if (!business) return NextResponse.json({ subreddits: [] });

  const { data } = await supabase
    .from("monitored_subreddits")
    .select("subreddit_name, status, last_scanned_at")
    .eq("business_id", business.id)
    .eq("is_active", true);

  return NextResponse.json({ subreddits: data || [] });
}
