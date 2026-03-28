"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useRef } from "react";

const shimmerCSS = `
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
`;

interface ProgressEvent {
  step: string;
  message: string;
  pct: number;
  alertsCreated?: number;
}

export default function SetupPage() {
  const router = useRouter();
  const [progress, setProgress] = useState<ProgressEvent>({
    step: "starting",
    message: "Preparing your dashboard...",
    pct: 0,
  });
  const [alertsCreated, setAlertsCreated] = useState(0);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    runFirstScan();
  }, []);

  async function runFirstScan() {
    try {
      const res = await fetch("/api/onboarding/first-scan", { method: "POST" });

      if (!res.ok) {
        setError("Failed to start scan. Redirecting to dashboard...");
        setTimeout(() => router.push("/dashboard"), 2000);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        router.push("/dashboard");
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        let eventType = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (eventType === "progress") {
                setProgress(data);
                if (data.alertsCreated !== undefined) {
                  setAlertsCreated(data.alertsCreated);
                }
              } else if (eventType === "complete") {
                setAlertsCreated(data.alertsCreated || 0);
                setDone(true);
              } else if (eventType === "error") {
                setError(data.message);
              }
            } catch {
              // Ignore parse errors
            }
          }
        }
      }

      // Auto-redirect when done
      if (!error) {
        setDone(true);
        setTimeout(() => router.push("/dashboard"), 1500);
      }
    } catch {
      setError("Connection lost. Redirecting to dashboard...");
      setTimeout(() => router.push("/dashboard"), 2000);
    }
  }

  const stepLabels: Record<string, string> = {
    starting: "Initializing...",
    fetching: "Scanning Reddit",
    filtering: "Analyzing relevance",
    scoring: "AI scoring posts",
    saving: "Preparing dashboard",
    done: "All set!",
  };

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#0A0A0A", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <style dangerouslySetInnerHTML={{ __html: shimmerCSS }} />

      <div style={{ width: "100%", maxWidth: "480px", padding: "0 16px", textAlign: "center" }}>
        {/* Logo */}
        <h1 style={{
          fontFamily: "'Satoshi', system-ui, sans-serif",
          fontSize: "28px",
          fontWeight: 700,
          color: "#E8651A",
          marginBottom: "40px",
        }}>
          Arete
        </h1>

        {/* Spinner or checkmark */}
        <div style={{ marginBottom: "24px" }}>
          {done ? (
            <div style={{
              width: "56px", height: "56px", margin: "0 auto",
              borderRadius: "50%", backgroundColor: "rgba(34, 197, 94, 0.15)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "28px", color: "#22C55E",
            }}>
              ✓
            </div>
          ) : (
            <div style={{
              width: "56px", height: "56px", margin: "0 auto",
              border: "3px solid #2A2A2A", borderTopColor: "#E8651A",
              borderRadius: "50%", animation: "spin 0.8s linear infinite",
            }} />
          )}
        </div>

        {/* Step label */}
        <h2 style={{
          fontFamily: "'Satoshi', system-ui, sans-serif",
          fontSize: "20px",
          fontWeight: 600,
          color: "#F5F5F3",
          marginBottom: "8px",
        }}>
          {done ? "Your dashboard is ready!" : stepLabels[progress.step] || "Working..."}
        </h2>

        {/* Detail message */}
        <p style={{
          fontSize: "14px",
          color: "#A3A3A0",
          marginBottom: "32px",
          minHeight: "20px",
        }}>
          {error || progress.message}
        </p>

        {/* Progress bar */}
        <div style={{
          width: "100%",
          height: "4px",
          backgroundColor: "#1C1C1C",
          borderRadius: "2px",
          overflow: "hidden",
          marginBottom: "16px",
        }}>
          <div style={{
            width: `${progress.pct}%`,
            height: "100%",
            backgroundColor: done ? "#22C55E" : "#E8651A",
            borderRadius: "2px",
            transition: "width 0.5s ease-out, background-color 0.3s ease",
          }} />
        </div>

        {/* Stats */}
        {alertsCreated > 0 && (
          <p style={{
            fontSize: "13px",
            color: done ? "#22C55E" : "#A3A3A0",
            animation: done ? undefined : "pulse 1.5s ease-in-out infinite",
          }}>
            {done
              ? `Found ${alertsCreated} relevant posts for your dashboard`
              : `${alertsCreated} alerts found so far...`
            }
          </p>
        )}
      </div>
    </div>
  );
}
