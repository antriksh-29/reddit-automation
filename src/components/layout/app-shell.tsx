"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useEffect, useState } from "react";

const NAV_ITEMS = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Thread Analysis", href: "/threads" },
  { label: "Settings", href: "/settings" },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [credits, setCredits] = useState<number | null>(null);

  useEffect(() => {
    fetchCredits();
  }, [pathname]); // Re-fetch on navigation

  // Listen for credit-deduction events from thread analysis / chat
  useEffect(() => {
    function handleCreditUpdate() { fetchCredits(); }
    window.addEventListener("credits-updated", handleCreditUpdate);
    return () => window.removeEventListener("credits-updated", handleCreditUpdate);
  }, []);

  async function fetchCredits() {
    try {
      const res = await fetch("/api/credits");
      if (res.ok) {
        const data = await res.json();
        setCredits(data.balance);
      }
    } catch {
      // Non-blocking — badge just stays at previous value
    }
  }

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  const shimmerCSS = `
@keyframes credit-shimmer {
  0% { background-position: -200% center; }
  100% { background-position: 200% center; }
}`;

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", backgroundColor: "#0A0A0A" }}>
      <style dangerouslySetInnerHTML={{ __html: shimmerCSS }} />
      {/* Top Navigation */}
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 50,
          borderBottom: "1px solid #2A2A2A",
          backgroundColor: "rgba(26, 26, 26, 0.9)",
          backdropFilter: "blur(12px)",
        }}
      >
        <div
          style={{
            maxWidth: "1280px",
            margin: "0 auto",
            display: "flex",
            height: "56px",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 16px",
          }}
        >
          {/* Left: Logo + Nav */}
          <div style={{ display: "flex", alignItems: "center", gap: "32px" }}>
            <Link
              href="/dashboard"
              style={{
                fontFamily: "'Satoshi', system-ui, sans-serif",
                fontSize: "18px",
                fontWeight: 700,
                color: "#F5F5F3",
                textDecoration: "none",
              }}
            >
              Arete
            </Link>

            <nav style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              {NAV_ITEMS.map((item) => {
                const isActive = pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    style={{
                      padding: "6px 12px",
                      borderRadius: "6px",
                      fontSize: "14px",
                      fontWeight: 500,
                      textDecoration: "none",
                      color: isActive ? "#F5F5F3" : "#A3A3A0",
                      backgroundColor: isActive ? "#1C1C1C" : "transparent",
                      fontFamily: "'DM Sans', system-ui, sans-serif",
                    }}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>

          {/* Right: Credits + Sign Out */}
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            {/* Credit badge — live balance with shimmer */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                background: credits !== null && credits <= 5
                  ? "#EF4444"
                  : "linear-gradient(90deg, #C4550F 0%, #D4742A 25%, #C4550F 50%, #D4742A 75%, #C4550F 100%)",
                backgroundSize: "200% 100%",
                animation: credits !== null && credits > 5 ? "credit-shimmer 4s linear infinite" : "none",
                borderRadius: "6px",
                padding: "6px 14px",
                fontSize: "13px",
              }}
            >
              <span style={{ color: "rgba(255,255,255,0.85)", fontWeight: 500 }}>Credits:</span>
              <span style={{ fontWeight: 700, color: "#FFFFFF" }}>
                {credits !== null ? credits.toFixed(1) : "—"}
              </span>
            </div>

            {/* Sign Out */}
            <button
              onClick={handleSignOut}
              style={{
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
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main
        style={{
          maxWidth: "1280px",
          margin: "0 auto",
          width: "100%",
          flex: 1,
          padding: "24px 16px",
        }}
      >
        {children}
      </main>
    </div>
  );
}
