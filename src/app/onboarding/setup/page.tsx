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
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    runFirstScan();

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (progressRef.current) clearInterval(progressRef.current);
    };
  }, []);

  async function runFirstScan() {
    // Start progress animation immediately
    let elapsed = 0;
    progressRef.current = setInterval(() => {
      elapsed += 1;
      if (elapsed < 5) {
        setMessage("Starting analysis of your subreddits...");
        setPct(10);
      } else if (elapsed < 15) {
        setMessage("Fetching posts from Reddit...");
        setPct(25);
      } else if (elapsed < 25) {
        setMessage("Running AI analysis on discovered posts...");
        setPct(50);
      } else if (elapsed < 40) {
        setMessage("Scoring and prioritizing posts for you...");
        setPct(70);
      } else if (elapsed < 55) {
        setMessage("Almost done — finalizing your alerts...");
        setPct(85);
      } else {
        setMessage("Taking a bit longer than expected. Hang tight...");
        setPct(90);
      }
    }, 1000);

    // Also start polling for alerts as a backup
    // (in case the API call completes but response doesn't reach us)
    let pollCount = 0;
    pollRef.current = setInterval(async () => {
      pollCount++;
      if (pollCount < 5) return; // Don't poll for the first 15 seconds
      try {
        const res = await fetch("/api/alerts?limit=5&sort=priority");
        if (res.ok) {
          const data = await res.json();
          const count = data.alerts?.length || 0;
          if (count > 0) {
            finish(count);
          }
        }
      } catch {
        // ignore
      }
    }, 3000);

    // Main path: call the API and wait for response
    try {
      const res = await fetch("/api/onboarding/first-scan", { method: "POST" });

      if (res.ok) {
        const data = await res.json();
        if (data.alertsCreated > 0) {
          finish(data.alertsCreated);
          return;
        }
      }

      // API returned but no alerts — poll will pick them up if worker is still running
      // Or it genuinely found 0 relevant posts
      // Wait 10 more seconds for poll to catch late alerts
      setTimeout(() => {
        if (!done) {
          finish(0);
        }
      }, 10000);
    } catch {
      // API call failed (timeout or network) — rely on polling
      // Worker may still be running in the background
      setTimeout(() => {
        if (!done) {
          finish(0);
        }
      }, 15000);
    }
  }

  function finish(count: number) {
    if (done) return; // Prevent double-finish
    if (progressRef.current) clearInterval(progressRef.current);
    if (pollRef.current) clearInterval(pollRef.current);

    setAlertsFound(count);
    setPct(100);
    setMessage(count > 0 ? `Found ${count}+ relevant posts for you!` : "Your dashboard is ready!");
    setDone(true);
  }

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#0A0A0A", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}>
      <style dangerouslySetInnerHTML={{ __html: shimmerCSS }} />

      <div style={{ maxWidth: "480px", width: "100%", textAlign: "center" }}>
        <h1 style={{ fontFamily: "'Satoshi', system-ui, sans-serif", fontSize: "28px", fontWeight: 700, color: "#E8651A", marginBottom: "32px" }}>
          Arete
        </h1>

        <div style={{ marginBottom: "24px" }}>
          {!done ? (
            <div style={{ width: "48px", height: "48px", border: "3px solid #2A2A2A", borderTopColor: "#E8651A", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto" }} />
          ) : (
            <div style={{ width: "48px", height: "48px", borderRadius: "50%", backgroundColor: "rgba(34, 197, 94, 0.15)", border: "2px solid #22C55E", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto", fontSize: "22px" }}>
              ✓
            </div>
          )}
        </div>

        <p style={{
          fontSize: "16px",
          fontWeight: 500,
          color: done ? "#22C55E" : "#F5F5F3",
          marginBottom: "8px",
          animation: done ? "none" : "pulse 2s ease-in-out infinite",
        }}>
          {message}
        </p>

        <div style={{ width: "100%", height: "4px", backgroundColor: "#2A2A2A", borderRadius: "2px", marginBottom: "24px", overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${pct}%`, backgroundColor: done ? "#22C55E" : "#E8651A", borderRadius: "2px", transition: "width 0.5s ease" }} />
        </div>

        {alertsFound > 0 && (
          <p style={{ fontSize: "14px", color: "#A3A3A0", marginBottom: "24px" }}>
            {alertsFound}+ posts matched your business profile
          </p>
        )}

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
      </div>
    </div>
  );
}
