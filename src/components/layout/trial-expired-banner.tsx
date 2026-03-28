"use client";

/**
 * Trial Expired Banner — shown when free plan user's trial has ended.
 * Blocks access to thread analysis and draft generation (API returns 402).
 * Dashboard is still accessible (read-only, no new scans).
 */
export function TrialExpiredBanner() {
  return (
    <div
      style={{
        backgroundColor: "rgba(239, 68, 68, 0.08)",
        border: "1px solid rgba(239, 68, 68, 0.25)",
        borderRadius: "10px",
        padding: "16px 20px",
        marginBottom: "20px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "16px",
      }}
    >
      <div>
        <div style={{ fontSize: "14px", fontWeight: 600, color: "#EF4444", marginBottom: "4px" }}>
          Your free trial has expired
        </div>
        <div style={{ fontSize: "13px", color: "#A3A3A0", lineHeight: 1.5 }}>
          Upgrade to Growth to continue scanning subreddits, analyzing threads, and drafting responses.
        </div>
      </div>
      <a
        href="/settings"
        style={{
          padding: "8px 20px",
          fontSize: "13px",
          fontWeight: 600,
          borderRadius: "6px",
          backgroundColor: "#E8651A",
          color: "#FFF",
          textDecoration: "none",
          whiteSpace: "nowrap",
          flexShrink: 0,
        }}
      >
        Upgrade to Growth — $39/mo
      </a>
    </div>
  );
}
