"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useRef } from "react";

const shimmerCSS = `
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
`;

export default function SetupPage() {
  const router = useRouter();
  const [alertsFound, setAlertsFound] = useState(0);
  const [done, setDone] = useState(false);
  const [message, setMessage] = useState("Preparing your dashboard...");
  const [pct, setPct] = useState(5);
  const started = useRef(false);
  const pollCount = useRef(0);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    kickoff();
  }, []);

  async function kickoff() {
    // Step 1: Fire-and-forget — tell worker to start scanning
    setMessage("Starting analysis of your subreddits...");
    setPct(10);

    try {
      await fetch("/api/onboarding/first-scan", { method: "POST" });
    } catch {
      // Ignore — worker may already be scanning
    }

    // Step 2: Show progress messages while polling
    setMessage("Fetching posts from Reddit...");
    setPct(20);

    // Step 3: Poll /api/alerts every 3 seconds until alerts appear
    const pollInterval = setInterval(async () => {
      pollCount.current++;

      // Update progress message based on time elapsed
      const elapsed = pollCount.current * 3;
      if (elapsed < 10) {
        setMessage("Scanning your subreddits for relevant posts...");
        setPct(30);
      } else if (elapsed < 20) {
        setMessage("Running AI analysis on discovered posts...");
        setPct(50);
      } else if (elapsed < 35) {
        setMessage("Scoring and prioritizing posts for you...");
        setPct(70);
      } else if (elapsed < 60) {
        setMessage("Almost done — finalizing your alerts...");
        setPct(85);
      } else {
        setMessage("Taking a bit longer than expected. Hang tight...");
        setPct(90);
      }

      try {
        const res = await fetch("/api/alerts?limit=5&sort=priority");
        if (res.ok) {
          const data = await res.json();
          const count = data.alerts?.length || 0;
          if (count > 0) {
            setAlertsFound(count);
            setPct(100);
            setMessage(`Found ${count}+ relevant posts for you!`);
            setDone(true);
            clearInterval(pollInterval);
          }
        }
      } catch {
        // Ignore poll errors
      }

      // Safety: stop polling after 2 minutes and redirect anyway
      if (pollCount.current > 40) {
        clearInterval(pollInterval);
        setDone(true);
        setMessage("Your dashboard is ready!");
      }
    }, 3000);

    return () => clearInterval(pollInterval);
  }

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#0A0A0A", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}>
      <style dangerouslySetInnerHTML={{ __html: shimmerCSS }} />

      <div style={{ maxWidth: "480px", width: "100%", textAlign: "center" }}>
        {/* Logo */}
        <h1 style={{ fontFamily: "'Satoshi', system-ui, sans-serif", fontSize: "28px", fontWeight: 700, color: "#E8651A", marginBottom: "32px" }}>
          Arete
        </h1>

        {/* Spinner or checkmark */}
        <div style={{ marginBottom: "24px" }}>
          {!done ? (
            <div style={{ width: "48px", height: "48px", border: "3px solid #2A2A2A", borderTopColor: "#E8651A", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto" }} />
          ) : (
            <div style={{ width: "48px", height: "48px", borderRadius: "50%", backgroundColor: "rgba(34, 197, 94, 0.15)", border: "2px solid #22C55E", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto", fontSize: "22px" }}>
              ✓
            </div>
          )}
        </div>

        {/* Message */}
        <p style={{
          fontSize: "16px",
          fontWeight: 500,
          color: done ? "#22C55E" : "#F5F5F3",
          marginBottom: "8px",
          animation: done ? "none" : "pulse 2s ease-in-out infinite",
        }}>
          {message}
        </p>

        {/* Progress bar */}
        <div style={{ width: "100%", height: "4px", backgroundColor: "#2A2A2A", borderRadius: "2px", marginBottom: "24px", overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${pct}%`, backgroundColor: done ? "#22C55E" : "#E8651A", borderRadius: "2px", transition: "width 0.5s ease" }} />
        </div>

        {/* Alerts count */}
        {alertsFound > 0 && (
          <p style={{ fontSize: "14px", color: "#A3A3A0", marginBottom: "24px" }}>
            {alertsFound}+ posts matched your business profile
          </p>
        )}

        {/* Go to Dashboard button */}
        {done && (
          <button
            onClick={() => router.push("/dashboard")}
            style={{
              backgroundColor: "#E8651A",
              border: "none",
              borderRadius: "8px",
              padding: "14px 32px",
              fontSize: "15px",
              fontWeight: 600,
              color: "#FFFFFF",
              cursor: "pointer",
              fontFamily: "'DM Sans', system-ui, sans-serif",
            }}
          >
            Go to Dashboard →
          </button>
        )}

        {/* Skip link (after 15 seconds) */}
        {!done && pollCount.current > 5 && (
          <button
            onClick={() => router.push("/dashboard")}
            style={{
              backgroundColor: "transparent",
              border: "none",
              fontSize: "13px",
              color: "#6B6B68",
              cursor: "pointer",
              marginTop: "16px",
              fontFamily: "'DM Sans', system-ui, sans-serif",
            }}
          >
            Skip — I&apos;ll check the dashboard later
          </button>
        )}
      </div>
    </div>
  );
}
