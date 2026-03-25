"use client";

import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export default function OnboardingPage() {
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#0A0A0A",
        padding: "16px",
        position: "relative",
      }}
    >
      {/* Sign out — top right */}
      <button
        onClick={handleSignOut}
        style={{
          position: "absolute",
          top: "20px",
          right: "20px",
          padding: "6px 14px",
          borderRadius: "6px",
          fontSize: "13px",
          fontWeight: 500,
          color: "#A3A3A0",
          backgroundColor: "transparent",
          border: "1px solid #2A2A2A",
          cursor: "pointer",
          fontFamily: "'DM Sans', system-ui, sans-serif",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = "#1C1C1C";
          e.currentTarget.style.color = "#F5F5F3";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = "transparent";
          e.currentTarget.style.color = "#A3A3A0";
        }}
      >
        Sign out
      </button>

      <div style={{ width: "100%", maxWidth: "640px", textAlign: "center" }}>
        <h1
          style={{
            fontFamily: "'Satoshi', system-ui, sans-serif",
            fontSize: "32px",
            fontWeight: 700,
            color: "#F5F5F3",
            marginBottom: "12px",
          }}
        >
          Welcome to Arete
        </h1>
        <p
          style={{
            fontSize: "15px",
            color: "#A3A3A0",
            lineHeight: 1.6,
          }}
        >
          Let&apos;s set up your business profile. This takes about 2 minutes.
        </p>
        {/* Full onboarding wizard built in Phase 2 */}
      </div>
    </div>
  );
}
