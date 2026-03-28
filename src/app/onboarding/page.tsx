"use client";

import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useState, useEffect, useRef } from "react";

// Shared styles
const inputStyle: React.CSSProperties = {
  width: "100%",
  backgroundColor: "#141414",
  border: "1px solid #2A2A2A",
  borderRadius: "8px",
  padding: "10px 14px",
  fontSize: "14px",
  color: "#F5F5F3",
  outline: "none",
  fontFamily: "'DM Sans', system-ui, sans-serif",
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "13px",
  fontWeight: 500,
  color: "#A3A3A0",
  marginBottom: "6px",
};

const btnPrimary: React.CSSProperties = {
  backgroundColor: "#E8651A",
  border: "none",
  borderRadius: "8px",
  padding: "12px 24px",
  fontSize: "14px",
  fontWeight: 600,
  color: "#FFFFFF",
  cursor: "pointer",
  fontFamily: "'DM Sans', system-ui, sans-serif",
};

const btnSecondary: React.CSSProperties = {
  backgroundColor: "transparent",
  border: "1px solid #2A2A2A",
  borderRadius: "8px",
  padding: "12px 24px",
  fontSize: "14px",
  fontWeight: 500,
  color: "#A3A3A0",
  cursor: "pointer",
  fontFamily: "'DM Sans', system-ui, sans-serif",
};

const tagStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  backgroundColor: "#1C1C1C",
  border: "1px solid #2A2A2A",
  borderRadius: "6px",
  padding: "4px 10px",
  fontSize: "13px",
  color: "#F5F5F3",
};

const shimmerCSS = `
@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
.shimmer-box {
  background: linear-gradient(90deg, #141414 25%, #1C1C1C 50%, #141414 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s ease-in-out infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
`;

const MAX_SUBREDDITS_FREE = 3;
const MAX_KEYWORDS = 15;
const MAX_COMPETITORS = 10;

interface Discovery {
  subreddits: { name: string; type: string; reason: string }[];
  keywords: { primary: string[]; discovery: string[] };
}

/** Auto-resizing textarea */
function AutoTextarea({
  value,
  onChange,
  placeholder,
  style: extraStyle,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.style.height = "auto";
      ref.current.style.height = ref.current.scrollHeight + "px";
    }
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={1}
      style={{
        ...inputStyle,
        resize: "none",
        overflow: "hidden",
        minHeight: "42px",
        ...extraStyle,
      }}
      onFocus={(e) => (e.currentTarget.style.borderColor = "#E8651A")}
      onBlur={(e) => (e.currentTarget.style.borderColor = "#2A2A2A")}
    />
  );
}

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);

  // Per-section inline errors
  const [urlError, setUrlError] = useState<string | null>(null);
  const [keywordError, setKeywordError] = useState<string | null>(null);
  const [competitorError, setCompetitorError] = useState<string | null>(null);
  const [subredditError, setSubredditError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // Step 1
  const [url, setUrl] = useState("");
  const [skipped, setSkipped] = useState(false);

  // Step 2 — editable fields
  const [businessName, setBusinessName] = useState("");
  const [description, setDescription] = useState("");
  const [icpDescription, setIcpDescription] = useState("");
  const [competitors, setCompetitors] = useState<string[]>([]);
  const [newCompetitor, setNewCompetitor] = useState("");
  const [primaryKeywords, setPrimaryKeywords] = useState<string[]>([]);
  const [discoveryKeywords, setDiscoveryKeywords] = useState<string[]>([]);
  const [newKeyword, setNewKeyword] = useState("");
  const [subreddits, setSubreddits] = useState<{ name: string; reason: string }[]>([]);
  const [newSubreddit, setNewSubreddit] = useState("");
  const [validatingSubreddit, setValidatingSubreddit] = useState(false);
  const [discoveryLoading, setDiscoveryLoading] = useState(false);

  const totalKeywords = primaryKeywords.length + discoveryKeywords.length;

  function clearAllErrors() {
    setUrlError(null);
    setKeywordError(null);
    setCompetitorError(null);
    setSubredditError(null);
    setFormError(null);
  }

  // Step 1: Analyze URL
  async function handleAnalyze() {
    setLoading(true);
    setUrlError(null);

    try {
      const res = await fetch("/api/onboarding/analyze-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      const a = data.analysis;
      setBusinessName(a.business_name || "");
      setDescription(a.description || "");
      setIcpDescription(a.icp_description || "");
      setCompetitors((a.competitors || []).slice(0, MAX_COMPETITORS));
      setSkipped(false);

      setStep(2);
      clearAllErrors();
      runDiscovery(a.description, a.icp_description, a.competitors);
    } catch (err) {
      setUrlError(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setLoading(false);
    }
  }

  function handleSkip() {
    setSkipped(true);
    setStep(2);
  }

  // Agent 2: Discover subreddits + keywords
  async function runDiscovery(desc: string, icp: string, comps: string[]) {
    setDiscoveryLoading(true);
    try {
      const res = await fetch("/api/onboarding/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: desc, icp_description: icp, competitors: comps }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      const d: Discovery = data.discovery;
      // Cap subreddits to free plan limit
      setSubreddits((d.subreddits || []).slice(0, MAX_SUBREDDITS_FREE).map((s) => ({ name: s.name, reason: s.reason })));
      // Cap total keywords to MAX_KEYWORDS
      const pKeywords = (d.keywords?.primary || []).slice(0, MAX_KEYWORDS);
      const remaining = MAX_KEYWORDS - pKeywords.length;
      const dKeywords = (d.keywords?.discovery || []).slice(0, remaining);
      setPrimaryKeywords(pKeywords);
      setDiscoveryKeywords(dKeywords);
    } catch {
      // Non-blocking
    } finally {
      setDiscoveryLoading(false);
    }
  }

  // Skip flow: trigger discovery
  function handleFetchRecommendations() {
    if (!description.trim() || !icpDescription.trim()) {
      setFormError("Please fill in the description and target audience first.");
      return;
    }
    setFormError(null);
    runDiscovery(description, icpDescription, competitors);
  }

  function addCompetitor() {
    const name = newCompetitor.trim();
    if (!name) return;
    if (competitors.length >= MAX_COMPETITORS) {
      setCompetitorError(`Maximum ${MAX_COMPETITORS} competitors allowed.`);
      return;
    }
    if (competitors.includes(name)) {
      setCompetitorError("This competitor is already added.");
      return;
    }
    setCompetitors([...competitors, name]);
    setNewCompetitor("");
    setCompetitorError(null);
  }

  // User-added keywords always go to primary
  function addKeyword() {
    const kw = newKeyword.trim();
    if (!kw) return;
    if (totalKeywords >= MAX_KEYWORDS) {
      setKeywordError(`Maximum ${MAX_KEYWORDS} keywords allowed.`);
      return;
    }
    if (primaryKeywords.includes(kw) || discoveryKeywords.includes(kw)) {
      setKeywordError("This keyword is already added.");
      return;
    }
    setPrimaryKeywords([...primaryKeywords, kw]);
    setNewKeyword("");
    setKeywordError(null);
  }

  // Add subreddit — validates via our API which proxies to Railway worker
  // (Reddit blocks Vercel IPs, Railway IPs work fine)
  async function addSubreddit() {
    const name = newSubreddit.trim().replace(/^r\//, "").toLowerCase();
    if (!name) return;
    if (!/^[a-zA-Z0-9_]+$/.test(name)) {
      setSubredditError("Invalid name. Only letters, numbers, and underscores.");
      return;
    }
    if (subreddits.length >= MAX_SUBREDDITS_FREE) {
      setSubredditError(`Maximum ${MAX_SUBREDDITS_FREE} subreddits on the free plan.`);
      return;
    }
    if (subreddits.some((s) => s.name.toLowerCase() === name)) {
      setSubredditError("This subreddit is already added.");
      return;
    }

    setValidatingSubreddit(true);
    setSubredditError(null);

    try {
      const res = await fetch("/api/subreddits/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });

      const data = await res.json();
      if (!data.valid) {
        setSubredditError(data.reason);
        return;
      }

      setSubreddits([...subreddits, { name: data.subreddit.name, reason: "Manually added" }]);
      setNewSubreddit("");
      setSubredditError(null);
    } catch {
      setSubredditError("Could not validate subreddit. Please try again.");
    } finally {
      setValidatingSubreddit(false);
    }
  }

  async function handleComplete() {
    clearAllErrors();
    let hasError = false;

    if (!businessName.trim() || !description.trim()) {
      setFormError("Business name and description are required.");
      hasError = true;
    }
    if (totalKeywords === 0) {
      setKeywordError("Please add at least one keyword.");
      hasError = true;
    }
    if (competitors.length === 0) {
      setCompetitorError("Please add at least one competitor.");
      hasError = true;
    }
    if (subreddits.length === 0) {
      setSubredditError("Please add at least one subreddit.");
      hasError = true;
    }
    if (hasError) return;

    setLoading(true);

    try {
      const res = await fetch("/api/onboarding/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_name: businessName,
          website_url: url || null,
          description,
          icp_description: icpDescription,
          brand_voice: null,
          keywords: { primary: primaryKeywords, discovery: discoveryKeywords },
          competitors: competitors.map((c) => ({ name: c, source: "auto_suggested" })),
          subreddits: subreddits.map((s) => ({ name: s.name, source: "auto_suggested" })),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      router.push("/onboarding/setup");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to complete onboarding");
    } finally {
      setLoading(false);
    }
  }

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  const hasDiscoveryResults = subreddits.length > 0 || primaryKeywords.length > 0;
  const showSkipCoreOnly = skipped && !hasDiscoveryResults && !discoveryLoading;

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#0A0A0A", position: "relative" }}>
      <style dangerouslySetInnerHTML={{ __html: shimmerCSS }} />

      <button onClick={handleSignOut} style={{ ...btnSecondary, position: "absolute", top: "20px", right: "20px", padding: "6px 14px", fontSize: "13px" }}>
        Sign out
      </button>

      <div style={{ maxWidth: "640px", margin: "0 auto", padding: "60px 16px" }}>
        {/* Step indicator */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "40px" }}>
          <div style={{ width: "28px", height: "28px", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px", fontWeight: 600, backgroundColor: step === 1 ? "#E8651A" : "#1C1C1C", color: step === 1 ? "#FFF" : "#A3A3A0" }}>1</div>
          <div style={{ flex: 1, height: "2px", backgroundColor: step >= 2 ? "#E8651A" : "#2A2A2A" }} />
          <div style={{ width: "28px", height: "28px", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px", fontWeight: 600, backgroundColor: step === 2 ? "#E8651A" : "#1C1C1C", color: step === 2 ? "#FFF" : "#A3A3A0" }}>2</div>
        </div>

        {/* Global errors removed — all errors are inline per section */}

        {/* STEP 1 */}
        {step === 1 && (
          <div>
            <h1 style={{ fontFamily: "'Satoshi', system-ui, sans-serif", fontSize: "28px", fontWeight: 700, color: "#F5F5F3", marginBottom: "8px" }}>
              Enter your website URL
            </h1>
            <p style={{ fontSize: "15px", color: "#A3A3A0", marginBottom: "32px", lineHeight: 1.6 }}>
              We&apos;ll analyze your website to understand your business and suggest relevant subreddits and keywords.
            </p>

            <div style={{ marginBottom: "24px" }}>
              <label htmlFor="url" style={labelStyle}>Website URL</label>
              <div style={{ position: "relative" }}>
                <input
                  id="url"
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://example.com"
                  disabled={loading}
                  style={{ ...inputStyle, opacity: loading ? 0.6 : 1 }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = "#E8651A")}
                  onBlur={(e) => (e.currentTarget.style.borderColor = "#2A2A2A")}
                  onKeyDown={(e) => e.key === "Enter" && url && !loading && handleAnalyze()}
                />
                {loading && (
                  <div style={{ position: "absolute", right: "14px", top: "0", bottom: "0", display: "flex", alignItems: "center" }}>
                    <div style={{ width: "18px", height: "18px", border: "2px solid #2A2A2A", borderTopColor: "#E8651A", borderRadius: "50%", animation: "spin 0.6s linear infinite" }} />
                  </div>
                )}
              </div>
            </div>

            {urlError && (
              <div style={{ backgroundColor: "rgba(239, 68, 68, 0.08)", border: "1px solid rgba(239, 68, 68, 0.25)", borderRadius: "8px", padding: "10px 14px", fontSize: "13px", color: "#EF4444", marginBottom: "16px" }}>
                {urlError}
              </div>
            )}

            <div style={{ display: "flex", gap: "12px" }}>
              <button onClick={handleAnalyze} disabled={!url || loading} style={{ ...btnPrimary, opacity: !url || loading ? 0.5 : 1 }}>
                Analyze →
              </button>
              <button onClick={handleSkip} disabled={loading} style={{ ...btnSecondary, opacity: loading ? 0.5 : 1 }}>
                Skip — I&apos;ll enter manually
              </button>
            </div>
          </div>
        )}

        {/* STEP 2 */}
        {step === 2 && (
          <div>
            <h1 style={{ fontFamily: "'Satoshi', system-ui, sans-serif", fontSize: "28px", fontWeight: 700, color: "#F5F5F3", marginBottom: "8px" }}>
              {showSkipCoreOnly ? "Tell us about your business" : "Set up your profile"}
            </h1>
            <p style={{ fontSize: "15px", color: "#A3A3A0", marginBottom: "32px", lineHeight: 1.6 }}>
              {showSkipCoreOnly
                ? "Fill in the basics and we'll suggest keywords, competitors, and subreddits."
                : "Review and edit the details below. Everything is editable."}
            </p>

            {/* Business Profile */}
            <div style={{ marginBottom: "32px" }}>
              <h2 style={{ fontSize: "16px", fontWeight: 600, color: "#F5F5F3", marginBottom: "16px" }}>Business Profile</h2>

              <div style={{ marginBottom: "16px" }}>
                <label style={labelStyle}>Business Name *</label>
                <input value={businessName} onChange={(e) => setBusinessName(e.target.value)} style={inputStyle} placeholder="Your business name" />
              </div>

              <div style={{ marginBottom: "16px" }}>
                <label style={labelStyle}>Description *</label>
                <AutoTextarea value={description} onChange={setDescription} placeholder="What does your business do?" />
              </div>

              <div style={{ marginBottom: "16px" }}>
                <label style={labelStyle}>Target Audience / ICP *</label>
                <AutoTextarea value={icpDescription} onChange={setIcpDescription} placeholder="Who is your ideal customer?" />
              </div>
            </div>

            {/* Form-level error (business profile) */}
            {formError && (
              <div style={{ backgroundColor: "rgba(239, 68, 68, 0.08)", border: "1px solid rgba(239, 68, 68, 0.25)", borderRadius: "8px", padding: "10px 14px", fontSize: "13px", color: "#EF4444", marginBottom: "24px" }}>
                {formError}
              </div>
            )}

            {/* Skip flow: Analyze button */}
            {showSkipCoreOnly && (
              <div style={{ marginBottom: "32px" }}>
                <button onClick={handleFetchRecommendations} style={{ ...btnPrimary, width: "100%" }}>
                  Analyze →
                </button>
                <p style={{ fontSize: "12px", color: "#6B6B68", marginTop: "8px", textAlign: "center" }}>
                  Our AI will suggest keywords, competitors, and subreddits based on your business profile.
                </p>
              </div>
            )}

            {/* Discovery loading shimmer */}
            {discoveryLoading && (
              <div style={{ marginBottom: "32px" }}>
                <p style={{ fontSize: "14px", color: "#A3A3A0", marginBottom: "16px", display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ display: "inline-block", width: "16px", height: "16px", border: "2px solid #2A2A2A", borderTopColor: "#E8651A", borderRadius: "50%", animation: "spin 0.6s linear infinite" }} />
                  AI is discovering keywords, competitors, and subreddits...
                </p>
                <div className="shimmer-box" style={{ height: "48px", borderRadius: "8px", marginBottom: "8px" }} />
                <div className="shimmer-box" style={{ height: "48px", borderRadius: "8px", marginBottom: "8px" }} />
                <div className="shimmer-box" style={{ height: "48px", borderRadius: "8px" }} />
              </div>
            )}

            {/* Keywords */}
            {!showSkipCoreOnly && !discoveryLoading && (
              <div style={{ marginBottom: "32px" }}>
                <h2 style={{ fontSize: "16px", fontWeight: 600, color: "#F5F5F3", marginBottom: "4px" }}>Keywords</h2>
                <p style={{ fontSize: "13px", color: "#6B6B68", marginBottom: "16px" }}>{totalKeywords}/{MAX_KEYWORDS} keywords</p>

                {primaryKeywords.length > 0 && (
                  <div style={{ marginBottom: "12px" }}>
                    <span style={{ fontSize: "12px", color: "#6B6B68", textTransform: "uppercase", letterSpacing: "0.05em" }}>Primary</span>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "6px" }}>
                      {primaryKeywords.map((kw) => (
                        <span key={kw} style={tagStyle}>
                          {kw}
                          <button onClick={() => setPrimaryKeywords(primaryKeywords.filter((k) => k !== kw))} style={{ background: "none", border: "none", color: "#6B6B68", cursor: "pointer", fontSize: "14px", padding: 0 }}>×</button>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {discoveryKeywords.length > 0 && (
                  <div style={{ marginBottom: "12px" }}>
                    <span style={{ fontSize: "12px", color: "#6B6B68", textTransform: "uppercase", letterSpacing: "0.05em" }}>Discovery</span>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "6px" }}>
                      {discoveryKeywords.map((kw) => (
                        <span key={kw} style={tagStyle}>
                          {kw}
                          <button onClick={() => setDiscoveryKeywords(discoveryKeywords.filter((k) => k !== kw))} style={{ background: "none", border: "none", color: "#6B6B68", cursor: "pointer", fontSize: "14px", padding: 0 }}>×</button>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {totalKeywords >= MAX_KEYWORDS ? (
                  <div style={{ marginTop: "8px", padding: "10px 14px", backgroundColor: "rgba(239, 68, 68, 0.08)", border: "1px solid rgba(239, 68, 68, 0.25)", borderRadius: "8px", fontSize: "13px", color: "#EF4444" }}>
                    Keywords limit reached
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                    <input
                      value={newKeyword}
                      onChange={(e) => setNewKeyword(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && addKeyword()}
                      style={inputStyle}
                      placeholder="Add a keyword..."
                    />
                    <button onClick={addKeyword} style={{ ...btnSecondary, padding: "10px 16px", whiteSpace: "nowrap" }}>+ Add</button>
                  </div>
                )}
                {keywordError && (
                  <div style={{ backgroundColor: "rgba(239, 68, 68, 0.08)", border: "1px solid rgba(239, 68, 68, 0.25)", borderRadius: "8px", padding: "10px 14px", fontSize: "13px", color: "#EF4444", marginTop: "8px" }}>
                    {keywordError}
                  </div>
                )}
              </div>
            )}

            {/* Competitors */}
            {!showSkipCoreOnly && !discoveryLoading && (
              <div style={{ marginBottom: "32px" }}>
                <h2 style={{ fontSize: "16px", fontWeight: 600, color: "#F5F5F3", marginBottom: "4px" }}>Competitors</h2>
                <p style={{ fontSize: "13px", color: "#6B6B68", marginBottom: "16px" }}>{competitors.length}/{MAX_COMPETITORS} competitors</p>

                {competitors.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "12px" }}>
                    {competitors.map((c) => (
                      <span key={c} style={tagStyle}>
                        {c}
                        <button onClick={() => setCompetitors(competitors.filter((x) => x !== c))} style={{ background: "none", border: "none", color: "#6B6B68", cursor: "pointer", fontSize: "14px", padding: 0 }}>×</button>
                      </span>
                    ))}
                  </div>
                )}

                {competitors.length >= MAX_COMPETITORS ? (
                  <div style={{ padding: "10px 14px", backgroundColor: "rgba(239, 68, 68, 0.08)", border: "1px solid rgba(239, 68, 68, 0.25)", borderRadius: "8px", fontSize: "13px", color: "#EF4444" }}>
                    Competitors limit reached
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: "8px" }}>
                    <input
                      value={newCompetitor}
                      onChange={(e) => setNewCompetitor(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && addCompetitor()}
                      style={inputStyle}
                      placeholder="Add a competitor..."
                    />
                    <button onClick={addCompetitor} style={{ ...btnSecondary, padding: "10px 16px", whiteSpace: "nowrap" }}>+ Add</button>
                  </div>
                )}
                {competitorError && (
                  <div style={{ backgroundColor: "rgba(239, 68, 68, 0.08)", border: "1px solid rgba(239, 68, 68, 0.25)", borderRadius: "8px", padding: "10px 14px", fontSize: "13px", color: "#EF4444", marginTop: "8px" }}>
                    {competitorError}
                  </div>
                )}
              </div>
            )}

            {/* Subreddits */}
            {!showSkipCoreOnly && !discoveryLoading && (
              <div style={{ marginBottom: "32px" }}>
                <h2 style={{ fontSize: "16px", fontWeight: 600, color: "#F5F5F3", marginBottom: "4px" }}>Subreddits to Monitor</h2>
                <p style={{ fontSize: "13px", color: "#6B6B68", marginBottom: "16px" }}>
                  {subreddits.length}/{MAX_SUBREDDITS_FREE} subreddits (free plan).
                  {subreddits.length >= MAX_SUBREDDITS_FREE && " Upgrade to Growth for up to 10."}
                </p>

                {subreddits.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "16px" }}>
                    {subreddits.map((s) => (
                      <div
                        key={s.name}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "12px",
                          padding: "10px 14px",
                          backgroundColor: "#141414",
                          border: "1px solid #2A2A2A",
                          borderRadius: "8px",
                        }}
                      >
                        <div style={{ flex: 1 }}>
                          <span style={{ fontSize: "14px", fontWeight: 500, color: "#F5F5F3" }}>r/{s.name}</span>
                          <p style={{ fontSize: "12px", color: "#A3A3A0", marginTop: "2px" }}>{s.reason}</p>
                        </div>
                        <button
                          onClick={() => setSubreddits(subreddits.filter((x) => x.name !== s.name))}
                          style={{ background: "none", border: "none", color: "#6B6B68", cursor: "pointer", fontSize: "18px", padding: "4px", lineHeight: 1 }}
                          onMouseEnter={(e) => (e.currentTarget.style.color = "#EF4444")}
                          onMouseLeave={(e) => (e.currentTarget.style.color = "#6B6B68")}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {subreddits.length >= MAX_SUBREDDITS_FREE ? (
                  <div style={{ padding: "10px 14px", backgroundColor: "rgba(239, 68, 68, 0.08)", border: "1px solid rgba(239, 68, 68, 0.25)", borderRadius: "8px", fontSize: "13px", color: "#EF4444" }}>
                    Subreddit limit reached. Only {MAX_SUBREDDITS_FREE} subreddits can be added in free plan.
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: "8px" }}>
                    <div style={{ position: "relative", flex: 1 }}>
                      <span style={{ position: "absolute", left: "14px", top: "50%", transform: "translateY(-50%)", color: "#6B6B68", fontSize: "14px" }}>r/</span>
                      <input
                        value={newSubreddit}
                        onChange={(e) => setNewSubreddit(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && addSubreddit()}
                        style={{ ...inputStyle, paddingLeft: "30px" }}
                        placeholder="subreddit name"
                        disabled={validatingSubreddit}
                      />
                      {validatingSubreddit && (
                        <div style={{ position: "absolute", right: "14px", top: "0", bottom: "0", display: "flex", alignItems: "center" }}>
                          <div style={{ width: "16px", height: "16px", border: "2px solid #2A2A2A", borderTopColor: "#E8651A", borderRadius: "50%", animation: "spin 0.6s linear infinite" }} />
                        </div>
                      )}
                    </div>
                    <button onClick={addSubreddit} disabled={validatingSubreddit} style={{ ...btnSecondary, padding: "10px 16px", whiteSpace: "nowrap", opacity: validatingSubreddit ? 0.4 : 1 }}>
                      + Add
                    </button>
                  </div>
                )}
                {subredditError && (
                  <div style={{ backgroundColor: "rgba(239, 68, 68, 0.08)", border: "1px solid rgba(239, 68, 68, 0.25)", borderRadius: "8px", padding: "10px 14px", fontSize: "13px", color: "#EF4444", marginTop: "8px" }}>
                    {subredditError}
                  </div>
                )}
              </div>
            )}

            {/* Actions */}
            <div style={{ display: "flex", gap: "12px", paddingTop: "16px", borderTop: "1px solid #2A2A2A" }}>
              <button onClick={() => { setStep(1); setSkipped(false); clearAllErrors(); }} style={btnSecondary}>← Back</button>
              {!showSkipCoreOnly && (
                <button onClick={handleComplete} disabled={loading} style={{ ...btnPrimary, marginLeft: "auto", opacity: loading ? 0.5 : 1 }}>
                  {loading ? (
                    <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
                      <span style={{ display: "inline-block", width: "16px", height: "16px", border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.6s linear infinite" }} />
                      Setting up
                    </span>
                  ) : "Start Monitoring →"}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
