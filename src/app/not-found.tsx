import Link from "next/link";

export default function NotFound() {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "#0A0A0A", padding: "16px" }}>
      <div style={{ textAlign: "center", maxWidth: "400px" }}>
        <div style={{ fontSize: "64px", fontWeight: 700, color: "#E8651A", fontFamily: "'Satoshi', system-ui, sans-serif", marginBottom: "8px" }}>404</div>
        <h1 style={{ fontSize: "20px", fontWeight: 600, color: "#F5F5F3", marginBottom: "8px" }}>Page not found</h1>
        <p style={{ fontSize: "14px", color: "#A3A3A0", marginBottom: "24px", lineHeight: 1.6 }}>
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <Link
          href="/dashboard"
          style={{
            display: "inline-block", padding: "10px 24px", fontSize: "14px", fontWeight: 600,
            borderRadius: "8px", backgroundColor: "#E8651A", color: "#FFF", textDecoration: "none",
          }}
        >
          Go to Dashboard
        </Link>
      </div>
    </div>
  );
}
