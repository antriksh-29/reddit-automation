import { createServerSupabaseClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { TrialExpiredBanner } from "@/components/layout/trial-expired-banner";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Check if user has completed onboarding (has a business)
  const { data: business } = await supabase
    .from("businesses")
    .select("id")
    .eq("user_id", user.id)
    .single();

  if (!business) {
    redirect("/onboarding");
  }

  // Check trial status for free plan users
  const { data: userData } = await supabase
    .from("users")
    .select("plan_tier, trial_ends_at")
    .eq("id", user.id)
    .single();

  const isTrialExpired =
    userData?.plan_tier === "free" &&
    userData?.trial_ends_at &&
    new Date(userData.trial_ends_at) < new Date();

  return (
    <AppShell>
      {isTrialExpired && <TrialExpiredBanner />}
      {children}
    </AppShell>
  );
}
