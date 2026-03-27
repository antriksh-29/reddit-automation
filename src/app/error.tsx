"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "#0A0A0A", padding: "16px" }}>
      <div style={{ textAlign: "center", maxWidth: "400px" }}>
        <div style={{ fontSize: "48px", marginBottom: "16px" }}>⚠️</div>
        <h1 style={{ fontSize: "20px", fontWeight: 600, color: "#F5F5F3", marginBottom: "8px" }}>Something went wrong</h1>
        <p style={{ fontSize: "14px", color: "#A3A3A0", marginBottom: "24px", lineHeight: 1.6 }}>
          {error.message || "An unexpected error occurred. Please try again."}
        </p>
        <div style={{ display: "flex", gap: "12px", justifyContent: "center" }}>
          <button
            onClick={reset}
            style={{
              padding: "10px 24px", fontSize: "14px", fontWeight: 600,
              borderRadius: "8px", backgroundColor: "#E8651A", color: "#FFF",
              border: "none", cursor: "pointer",
            }}
          >
            Try again
          </button>
          <a
            href="/dashboard"
            style={{
              padding: "10px 24px", fontSize: "14px", fontWeight: 500,
              borderRadius: "8px", backgroundColor: "transparent", color: "#A3A3A0",
              border: "1px solid #2A2A2A", textDecoration: "none", display: "inline-flex", alignItems: "center",
            }}
          >
            Go to Dashboard
          </a>
        </div>
      </div>
    </div>
  );
}
