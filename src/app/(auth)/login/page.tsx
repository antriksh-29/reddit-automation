"use client";

import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  async function handleGoogleLogin() {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/api/auth/callback?next=/dashboard`,
      },
    });
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: "#0C0C0C",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "48px 24px",
      }}
    >
      <div style={{ width: "100%", maxWidth: "560px" }}>
        {/* Heading */}
        <h1
          style={{
            fontFamily: "'Satoshi', system-ui, sans-serif",
            fontSize: "58px",
            fontWeight: 700,
            color: "#E8651A",
            marginBottom: "16px",
            letterSpacing: "-1px",
          }}
        >
          Arete
        </h1>

        {/* Subheading */}
        <p
          style={{
            fontFamily: "'DM Sans', system-ui, sans-serif",
            fontSize: "20px",
            lineHeight: 1.5,
            color: "#EDEDEB",
            marginBottom: "44px",
            maxWidth: "540px",
          }}
        >
          Turn Reddit into your indirect sales and word-of-mouth channel.
          {" "}Never miss a conversation where you can be genuinely helpful.
        </p>

        {/* Features */}
        <div style={{ marginBottom: "44px", display: "flex", flexDirection: "column", gap: "20px" }}>
          {[
            {
              title: "Real-time alerts",
              desc: "Get notified when someone posts about a pain point you solve, a competitor frustration, or a buying signal.",
            },
            {
              title: "Subreddit discovery",
              desc: "Find communities where potential customers discuss problems you solve — no more manual scrolling.",
            },
            {
              title: "Draft reviewer",
              desc: "Check your drafts against subreddit rules and generate human-like responses that won\u2019t get you banned.",
            },
          ].map((f) => (
            <p
              key={f.title}
              style={{
                fontFamily: "'DM Sans', system-ui, sans-serif",
                fontSize: "16px",
                lineHeight: 1.6,
                color: "#D0D0CD",
                margin: 0,
              }}
            >
              <span style={{ color: "#E8651A", fontWeight: 600 }}>{f.title}</span>
              {" — "}
              {f.desc}
            </p>
          ))}
        </div>

        {/* Divider */}
        <div style={{ height: "1px", backgroundColor: "#1E1E1E", marginBottom: "28px" }} />

        {/* Google Sign In */}
        <button
          onClick={handleGoogleLogin}
          type="button"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            backgroundColor: "#151515",
            border: "1px solid #2A2A2A",
            borderRadius: "8px",
            padding: "14px 28px",
            fontSize: "16px",
            fontWeight: 500,
            color: "#F5F5F3",
            cursor: "pointer",
            fontFamily: "'DM Sans', system-ui, sans-serif",
            transition: "all 150ms ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = "#1C1C1C";
            e.currentTarget.style.borderColor = "#E8651A";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = "#151515";
            e.currentTarget.style.borderColor = "#2A2A2A";
          }}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
            <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z" fill="#4285F4"/>
            <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z" fill="#34A853"/>
            <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.997 8.997 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z" fill="#FBBC05"/>
            <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 6.29C4.672 4.163 6.656 2.58 9 2.58Z" fill="#EA4335"/>
          </svg>
          Continue with Google
        </button>

        <p
          style={{
            fontFamily: "'DM Sans', system-ui, sans-serif",
            fontSize: "13px",
            color: "#555",
            marginTop: "20px",
            lineHeight: 1.5,
          }}
        >
          By continuing, you agree to our Terms of Service and Privacy Policy.
        </p>
      </div>
    </div>
  );
}
