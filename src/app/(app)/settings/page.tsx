"use client";

import { useState, useEffect, useRef } from "react";

/**
 * Settings — sidebar tabs: Business Profile, Notifications, Usage & Billing.
 * Ref: PRODUCT-SPEC.md §5.5, DESIGN-SYSTEM.md
 */

interface BusinessData {
  name: string;
  description: string;
  icp_description: string;
  keywords: { primary: string[]; discovery: string[] };
  website_url: string | null;
}

interface Competitor { id: string; name: string; }
interface Subreddit { id: string; subreddit_name: string; status: string; }
interface UserData { email: string; plan_tier: string; trial_ends_at: string | null; }

const TABS = ["Business Profile", "Notifications", "Usage & Billing"] as const;

const spinCSS = `@keyframes spin { to { transform: rotate(360deg); } }`;

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<string>(TABS[0]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const [userData, setUserData] = useState<UserData | null>(null);
  const [business, setBusiness] = useState<BusinessData | null>(null);
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [subreddits, setSubreddits] = useState<Subreddit[]>([]);

  const [newCompetitor, setNewCompetitor] = useState("");
  const [newSubreddit, setNewSubreddit] = useState("");
  const [newKeyword, setNewKeyword] = useState("");
  const [validating, setValidating] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);

  const descRef = useRef<HTMLTextAreaElement>(null);
  const icpRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { fetchSettings(); }, []);

  async function fetchSettings() {
    setLoading(true);
    const res = await fetch("/api/settings");
    if (res.ok) {
      const data = await res.json();
      setUserData(data.user);
      setBusiness(data.business);
      setCompetitors(data.competitors);
      setSubreddits(data.subreddits);
    }
    setLoading(false);
  }

  function autoResize(ref: React.RefObject<HTMLTextAreaElement | null>) {
    if (ref.current) {
      ref.current.style.height = "auto";
      ref.current.style.height = ref.current.scrollHeight + "px";
    }
  }

  useEffect(() => { autoResize(descRef); autoResize(icpRef); }, [business]);

  async function saveProfile() {
    if (!business) return;
    setSaving(true);
    setSaveMsg(null);
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ section: "profile", ...business }),
    });
    setSaving(false);
    setSaveMsg(res.ok ? "Saved" : "Failed to save");
    setTimeout(() => setSaveMsg(null), 2000);
  }

  async function addCompetitor() {
    const name = newCompetitor.trim();
    if (!name || competitors.length >= 10) return;
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ section: "add_competitor", name }),
    });
    if (res.ok) {
      setNewCompetitor("");
      fetchSettings();
    }
  }

  async function removeCompetitor(id: string) {
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ section: "remove_competitor", competitor_id: id }),
    });
    fetchSettings();
  }

  async function addSubreddit() {
    const name = newSubreddit.trim().replace(/^r\//, "").toLowerCase();
    if (!name) return;

    const maxSubs = userData?.plan_tier === "growth" || userData?.plan_tier === "custom" ? 10 : 3;
    if (subreddits.length >= maxSubs) {
      setInlineError(`Maximum ${maxSubs} subreddits on your plan.`);
      return;
    }

    setValidating(true);
    setInlineError(null);

    const valRes = await fetch("/api/subreddits/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const valData = await valRes.json();

    if (!valData.valid) {
      setInlineError(valData.reason);
      setValidating(false);
      return;
    }

    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ section: "add_subreddit", name: valData.subreddit.name }),
    });

    setValidating(false);
    if (res.ok) {
      setNewSubreddit("");
      setInlineError(null);
      fetchSettings();
    }
  }

  async function removeSubreddit(id: string) {
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ section: "remove_subreddit", subreddit_id: id }),
    });
    fetchSettings();
  }

  function addKeyword() {
    if (!business || !newKeyword.trim()) return;
    const allKws = [...(business.keywords?.primary || []), ...(business.keywords?.discovery || [])];
    if (allKws.length >= 15) return;
    setBusiness({
      ...business,
      keywords: {
        ...business.keywords,
        primary: [...(business.keywords?.primary || []), newKeyword.trim()],
      },
    });
    setNewKeyword("");
  }

  function removeKeyword(kw: string, type: "primary" | "discovery") {
    if (!business) return;
    setBusiness({
      ...business,
      keywords: {
        ...business.keywords,
        [type]: (business.keywords?.[type] || []).filter((k: string) => k !== kw),
      },
    });
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", backgroundColor: "#141414", border: "1px solid #2A2A2A",
    borderRadius: "8px", padding: "10px 14px", fontSize: "14px", color: "#F5F5F3",
    outline: "none", fontFamily: "'DM Sans', system-ui, sans-serif", boxSizing: "border-box",
  };

  const labelStyle: React.CSSProperties = {
    display: "block", fontSize: "13px", fontWeight: 500, color: "#A3A3A0", marginBottom: "6px",
  };

  const tagStyle: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: "6px",
    backgroundColor: "#1C1C1C", border: "1px solid #2A2A2A", borderRadius: "6px",
    padding: "4px 10px", fontSize: "13px", color: "#F5F5F3",
  };

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "60px" }}>
        <style dangerouslySetInnerHTML={{ __html: spinCSS }} />
        <div style={{ width: "24px", height: "24px", border: "2px solid #2A2A2A", borderTopColor: "#E8651A", borderRadius: "50%", animation: "spin 0.6s linear infinite" }} />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", gap: 0, minHeight: "calc(100vh - 120px)" }}>
      <style dangerouslySetInnerHTML={{ __html: spinCSS }} />

      {/* Sidebar */}
      <div style={{ width: "220px", flexShrink: 0, borderRight: "1px solid #2A2A2A", paddingTop: "8px" }}>
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              display: "block", width: "100%", textAlign: "left",
              padding: "10px 16px", fontSize: "14px", fontWeight: 500,
              borderRadius: "6px", border: "none", cursor: "pointer",
              backgroundColor: activeTab === tab ? "#1C1C1C" : "transparent",
              color: activeTab === tab ? "#F5F5F3" : "#A3A3A0",
              fontFamily: "'DM Sans', system-ui, sans-serif",
              marginBottom: "2px",
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, padding: "24px 32px", maxWidth: "640px" }}>
        {/* Business Profile Tab */}
        {activeTab === "Business Profile" && business && (
          <div>
            <h2 style={{ fontFamily: "'Satoshi', system-ui, sans-serif", fontSize: "20px", fontWeight: 700, color: "#F5F5F3", marginBottom: "24px" }}>
              Business Profile
            </h2>

            <div style={{ display: "flex", flexDirection: "column", gap: "16px", marginBottom: "24px" }}>
              <div>
                <label style={labelStyle}>Business Name</label>
                <input value={business.name} onChange={(e) => setBusiness({ ...business, name: e.target.value })} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Description</label>
                <textarea ref={descRef} value={business.description || ""} onChange={(e) => { setBusiness({ ...business, description: e.target.value }); autoResize(descRef); }} style={{ ...inputStyle, resize: "none", overflow: "hidden", minHeight: "60px" }} />
              </div>
              <div>
                <label style={labelStyle}>Target Audience / ICP</label>
                <textarea ref={icpRef} value={business.icp_description || ""} onChange={(e) => { setBusiness({ ...business, icp_description: e.target.value }); autoResize(icpRef); }} style={{ ...inputStyle, resize: "none", overflow: "hidden", minHeight: "60px" }} />
              </div>
            </div>

            {/* Keywords */}
            <div style={{ marginBottom: "24px" }}>
              <label style={labelStyle}>Keywords ({((business.keywords?.primary?.length || 0) + (business.keywords?.discovery?.length || 0))}/15)</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "8px" }}>
                {(business.keywords?.primary || []).map((kw: string) => (
                  <span key={kw} style={tagStyle}>{kw}<button onClick={() => removeKeyword(kw, "primary")} style={{ background: "none", border: "none", color: "#6B6B68", cursor: "pointer", fontSize: "14px", padding: 0 }}>×</button></span>
                ))}
                {(business.keywords?.discovery || []).map((kw: string) => (
                  <span key={kw} style={{ ...tagStyle, borderColor: "#1C1C1C" }}>{kw}<button onClick={() => removeKeyword(kw, "discovery")} style={{ background: "none", border: "none", color: "#6B6B68", cursor: "pointer", fontSize: "14px", padding: 0 }}>×</button></span>
                ))}
              </div>
              {((business.keywords?.primary?.length || 0) + (business.keywords?.discovery?.length || 0)) < 15 && (
                <div style={{ display: "flex", gap: "8px" }}>
                  <input value={newKeyword} onChange={(e) => setNewKeyword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addKeyword()} style={inputStyle} placeholder="Add keyword..." />
                  <button onClick={addKeyword} style={{ padding: "10px 16px", fontSize: "13px", borderRadius: "8px", border: "1px solid #2A2A2A", backgroundColor: "transparent", color: "#A3A3A0", cursor: "pointer", whiteSpace: "nowrap", fontFamily: "'DM Sans', system-ui, sans-serif" }}>+ Add</button>
                </div>
              )}
            </div>

            {/* Competitors */}
            <div style={{ marginBottom: "24px" }}>
              <label style={labelStyle}>Competitors ({competitors.length}/10)</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "8px" }}>
                {competitors.map((c) => (
                  <span key={c.id} style={tagStyle}>{c.name}<button onClick={() => removeCompetitor(c.id)} style={{ background: "none", border: "none", color: "#6B6B68", cursor: "pointer", fontSize: "14px", padding: 0 }}>×</button></span>
                ))}
              </div>
              {competitors.length < 10 && (
                <div style={{ display: "flex", gap: "8px" }}>
                  <input value={newCompetitor} onChange={(e) => setNewCompetitor(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addCompetitor()} style={inputStyle} placeholder="Add competitor..." />
                  <button onClick={addCompetitor} style={{ padding: "10px 16px", fontSize: "13px", borderRadius: "8px", border: "1px solid #2A2A2A", backgroundColor: "transparent", color: "#A3A3A0", cursor: "pointer", whiteSpace: "nowrap", fontFamily: "'DM Sans', system-ui, sans-serif" }}>+ Add</button>
                </div>
              )}
            </div>

            {/* Subreddits */}
            <div style={{ marginBottom: "24px" }}>
              <label style={labelStyle}>Subreddits ({subreddits.length}/{userData?.plan_tier === "growth" || userData?.plan_tier === "custom" ? 10 : 3})</label>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "8px" }}>
                {subreddits.map((s) => (
                  <div key={s.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", backgroundColor: "#141414", border: "1px solid #2A2A2A", borderRadius: "8px" }}>
                    <span style={{ fontSize: "14px", color: "#F5F5F3" }}>r/{s.subreddit_name}</span>
                    <button onClick={() => removeSubreddit(s.id)} style={{ background: "none", border: "none", color: "#6B6B68", cursor: "pointer", fontSize: "16px" }}>×</button>
                  </div>
                ))}
              </div>
              {subreddits.length < (userData?.plan_tier === "growth" || userData?.plan_tier === "custom" ? 10 : 3) && (
                <div style={{ display: "flex", gap: "8px" }}>
                  <div style={{ position: "relative", flex: 1 }}>
                    <span style={{ position: "absolute", left: "14px", top: "50%", transform: "translateY(-50%)", color: "#6B6B68", fontSize: "14px" }}>r/</span>
                    <input value={newSubreddit} onChange={(e) => setNewSubreddit(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addSubreddit()} style={{ ...inputStyle, paddingLeft: "30px" }} placeholder="subreddit name" disabled={validating} />
                  </div>
                  <button onClick={addSubreddit} disabled={validating} style={{ padding: "10px 16px", fontSize: "13px", borderRadius: "8px", border: "1px solid #2A2A2A", backgroundColor: "transparent", color: "#A3A3A0", cursor: "pointer", whiteSpace: "nowrap", opacity: validating ? 0.5 : 1, fontFamily: "'DM Sans', system-ui, sans-serif" }}>+ Add</button>
                </div>
              )}
              {inlineError && (
                <div style={{ marginTop: "8px", padding: "8px 12px", backgroundColor: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: "8px", fontSize: "13px", color: "#EF4444" }}>{inlineError}</div>
              )}
            </div>

            {/* Save */}
            <button onClick={saveProfile} disabled={saving} style={{ padding: "10px 24px", fontSize: "14px", fontWeight: 600, borderRadius: "8px", border: "none", backgroundColor: "#E8651A", color: "#FFF", cursor: "pointer", opacity: saving ? 0.5 : 1, fontFamily: "'DM Sans', system-ui, sans-serif" }}>
              {saving ? (
                <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ width: "14px", height: "14px", border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.6s linear infinite", display: "inline-block" }} />
                  Saving
                </span>
              ) : "Save Changes"}
            </button>
            {saveMsg && <span style={{ marginLeft: "12px", fontSize: "13px", color: saveMsg === "Saved" ? "#22C55E" : "#EF4444" }}>{saveMsg}</span>}
          </div>
        )}

        {/* Notifications Tab */}
        {activeTab === "Notifications" && (
          <div>
            <h2 style={{ fontFamily: "'Satoshi', system-ui, sans-serif", fontSize: "20px", fontWeight: 700, color: "#F5F5F3", marginBottom: "24px" }}>
              Notifications
            </h2>
            <div style={{ backgroundColor: "#141414", border: "1px solid #2A2A2A", borderRadius: "8px", padding: "16px" }}>
              <p style={{ fontSize: "14px", color: "#A3A3A0" }}>
                Email notifications for high-priority alerts will be available once email service (Amazon SES) is configured.
              </p>
            </div>
          </div>
        )}

        {/* Usage & Billing Tab */}
        {activeTab === "Usage & Billing" && (
          <div>
            <h2 style={{ fontFamily: "'Satoshi', system-ui, sans-serif", fontSize: "20px", fontWeight: 700, color: "#F5F5F3", marginBottom: "24px" }}>
              Usage & Billing
            </h2>
            <div style={{ backgroundColor: "#141414", border: "1px solid #2A2A2A", borderRadius: "8px", padding: "16px" }}>
              <div style={{ marginBottom: "12px" }}>
                <span style={{ fontSize: "13px", color: "#A3A3A0" }}>Plan: </span>
                <span style={{ fontSize: "14px", fontWeight: 600, color: "#F5F5F3", textTransform: "capitalize" }}>{userData?.plan_tier || "free"}</span>
              </div>
              {userData?.trial_ends_at && (
                <div style={{ marginBottom: "12px" }}>
                  <span style={{ fontSize: "13px", color: "#A3A3A0" }}>Trial ends: </span>
                  <span style={{ fontSize: "14px", color: "#F5F5F3" }}>{new Date(userData.trial_ends_at).toLocaleDateString()}</span>
                </div>
              )}
              <p style={{ fontSize: "13px", color: "#6B6B68", marginTop: "16px" }}>
                Detailed usage analytics and billing management coming soon.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
