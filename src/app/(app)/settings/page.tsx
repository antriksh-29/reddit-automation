"use client";

import { useState, useEffect, useRef, useCallback } from "react";

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
interface SubredditItem { id: string; subreddit_name: string; status: string; }
interface UserData { email: string; plan_tier: string; trial_started_at: string | null; trial_ends_at: string | null; }
interface CreditData { balance: number; lifetime_used: number; last_reset_at: string | null; }

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
  const [subreddits, setSubreddits] = useState<SubredditItem[]>([]);

  const [credits, setCredits] = useState<CreditData | null>(null);
  const [showFeatures, setShowFeatures] = useState(false);
  const [newCompetitor, setNewCompetitor] = useState("");
  const [newSubreddit, setNewSubreddit] = useState("");
  const [newKeyword, setNewKeyword] = useState("");
  const [validating, setValidating] = useState(false);
  const [addingCompetitor, setAddingCompetitor] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
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
      setCredits(data.credits);
    }
    setLoading(false);
  }

  // Auto-resize textareas on content change
  const autoResize = useCallback((ref: React.RefObject<HTMLTextAreaElement | null>) => {
    if (ref.current) {
      ref.current.style.height = "auto";
      ref.current.style.height = ref.current.scrollHeight + "px";
    }
  }, []);

  // Run auto-resize after initial data load
  useEffect(() => {
    // Small delay to ensure DOM is rendered
    const timer = setTimeout(() => {
      autoResize(descRef);
      autoResize(icpRef);
    }, 50);
    return () => clearTimeout(timer);
  }, [business, loading, autoResize]);

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

  // Optimistic add competitor — update UI immediately, API in background
  async function addCompetitor() {
    const name = newCompetitor.trim();
    if (!name || competitors.length >= 10) return;
    if (competitors.some(c => c.name.toLowerCase() === name.toLowerCase())) {
      setInlineError("This competitor is already added.");
      return;
    }

    setAddingCompetitor(true);
    setNewCompetitor("");
    setInlineError(null);

    // Optimistic: add to UI immediately with temp ID
    const tempId = `temp-${Date.now()}`;
    setCompetitors(prev => [...prev, { id: tempId, name }]);

    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ section: "add_competitor", name }),
    });

    if (res.ok) {
      // Replace temp with real data
      const data = await res.json();
      if (data.competitor) {
        setCompetitors(prev => prev.map(c => c.id === tempId ? { id: data.competitor.id, name } : c));
      } else {
        // Fetch to get real ID
        fetchSettings();
      }
    } else {
      // Rollback
      setCompetitors(prev => prev.filter(c => c.id !== tempId));
      setInlineError("Failed to add competitor.");
    }
    setAddingCompetitor(false);
  }

  // Optimistic remove competitor
  async function removeCompetitor(id: string) {
    setRemovingId(id);
    const removed = competitors.find(c => c.id === id);
    setCompetitors(prev => prev.filter(c => c.id !== id));

    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ section: "remove_competitor", competitor_id: id }),
    });

    if (!res.ok && removed) {
      // Rollback on failure
      setCompetitors(prev => [...prev, removed]);
    }
    setRemovingId(null);
  }

  // Add subreddit with validation
  async function addSubreddit() {
    const name = newSubreddit.trim().replace(/^r\//, "").toLowerCase();
    if (!name) return;

    const maxSubs = userData?.plan_tier === "growth" || userData?.plan_tier === "custom" ? 10 : 3;
    if (subreddits.length >= maxSubs) {
      setInlineError(`Maximum ${maxSubs} subreddits on your plan.`);
      return;
    }

    if (subreddits.some(s => s.subreddit_name.toLowerCase() === name)) {
      setInlineError("This subreddit is already added.");
      return;
    }

    setValidating(true);
    setInlineError(null);

    try {
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

      const subredditName = valData.subreddit.name;

      // Optimistic add
      const tempId = `temp-${Date.now()}`;
      setSubreddits(prev => [...prev, { id: tempId, subreddit_name: subredditName, status: "active" }]);
      setNewSubreddit("");

      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section: "add_subreddit", name: subredditName }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.subreddit) {
          setSubreddits(prev => prev.map(s => s.id === tempId ? { ...s, id: data.subreddit.id } : s));
        } else {
          fetchSettings();
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        setSubreddits(prev => prev.filter(s => s.id !== tempId));
        setInlineError(errData.error || "Failed to add subreddit.");
      }
    } catch {
      setInlineError("Could not validate subreddit. Please try again.");
    } finally {
      setValidating(false);
    }
  }

  // Optimistic remove subreddit
  async function removeSubreddit(id: string) {
    setRemovingId(id);
    const removed = subreddits.find(s => s.id === id);
    setSubreddits(prev => prev.filter(s => s.id !== id));

    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ section: "remove_subreddit", subreddit_id: id }),
    });

    if (!res.ok && removed) {
      setSubreddits(prev => [...prev, removed]);
    }
    setRemovingId(null);
  }

  function addKeyword() {
    if (!business || !newKeyword.trim()) return;
    const allKws = [...(business.keywords?.primary || []), ...(business.keywords?.discovery || [])];
    if (allKws.length >= 15) return;
    if (allKws.includes(newKeyword.trim())) return;
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

  const addBtnStyle: React.CSSProperties = {
    padding: "10px 16px", fontSize: "13px", borderRadius: "8px",
    border: "1px solid #2A2A2A", backgroundColor: "transparent",
    color: "#A3A3A0", cursor: "pointer", whiteSpace: "nowrap",
    fontFamily: "'DM Sans', system-ui, sans-serif",
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
                <textarea
                  ref={descRef}
                  value={business.description || ""}
                  onChange={(e) => { setBusiness({ ...business, description: e.target.value }); setTimeout(() => autoResize(descRef), 0); }}
                  style={{ ...inputStyle, resize: "vertical", overflow: "auto", minHeight: "100px" }}
                />
              </div>
              <div>
                <label style={labelStyle}>Target Audience / ICP</label>
                <textarea
                  ref={icpRef}
                  value={business.icp_description || ""}
                  onChange={(e) => { setBusiness({ ...business, icp_description: e.target.value }); setTimeout(() => autoResize(icpRef), 0); }}
                  style={{ ...inputStyle, resize: "vertical", overflow: "auto", minHeight: "100px" }}
                />
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
                  <button onClick={addKeyword} style={addBtnStyle}>+ Add</button>
                </div>
              )}
            </div>

            {/* Competitors */}
            <div style={{ marginBottom: "24px" }}>
              <label style={labelStyle}>Competitors ({competitors.length}/10)</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "8px" }}>
                {competitors.map((c) => (
                  <span key={c.id} style={{ ...tagStyle, opacity: removingId === c.id ? 0.4 : 1, transition: "opacity 150ms" }}>
                    {c.name}
                    <button
                      onClick={() => removeCompetitor(c.id)}
                      disabled={removingId === c.id}
                      style={{ background: "none", border: "none", color: "#6B6B68", cursor: "pointer", fontSize: "14px", padding: 0 }}
                    >×</button>
                  </span>
                ))}
              </div>
              {competitors.length < 10 && (
                <div style={{ display: "flex", gap: "8px" }}>
                  <input
                    value={newCompetitor}
                    onChange={(e) => setNewCompetitor(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addCompetitor()}
                    style={inputStyle}
                    placeholder="Add competitor..."
                    disabled={addingCompetitor}
                  />
                  <button onClick={addCompetitor} disabled={addingCompetitor} style={{ ...addBtnStyle, opacity: addingCompetitor ? 0.5 : 1 }}>
                    {addingCompetitor ? "Adding..." : "+ Add"}
                  </button>
                </div>
              )}
            </div>

            {/* Subreddits */}
            <div style={{ marginBottom: "24px" }}>
              <label style={labelStyle}>Subreddits ({subreddits.length}/{userData?.plan_tier === "growth" || userData?.plan_tier === "custom" ? 10 : 3})</label>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "8px" }}>
                {subreddits.map((s) => (
                  <div key={s.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", backgroundColor: "#141414", border: "1px solid #2A2A2A", borderRadius: "8px", opacity: removingId === s.id ? 0.4 : 1, transition: "opacity 150ms" }}>
                    <span style={{ fontSize: "14px", color: "#F5F5F3" }}>r/{s.subreddit_name}</span>
                    <button
                      onClick={() => removeSubreddit(s.id)}
                      disabled={removingId === s.id}
                      style={{ background: "none", border: "none", color: "#6B6B68", cursor: "pointer", fontSize: "16px" }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = "#EF4444"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = "#6B6B68"; }}
                    >×</button>
                  </div>
                ))}
              </div>
              {subreddits.length < (userData?.plan_tier === "growth" || userData?.plan_tier === "custom" ? 10 : 3) && (
                <div style={{ display: "flex", gap: "8px" }}>
                  <div style={{ position: "relative", flex: 1 }}>
                    <span style={{ position: "absolute", left: "14px", top: "50%", transform: "translateY(-50%)", color: "#6B6B68", fontSize: "14px" }}>r/</span>
                    <input
                      value={newSubreddit}
                      onChange={(e) => setNewSubreddit(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && addSubreddit()}
                      style={{ ...inputStyle, paddingLeft: "30px" }}
                      placeholder="subreddit name"
                      disabled={validating}
                    />
                    {validating && (
                      <div style={{ position: "absolute", right: "14px", top: "0", bottom: "0", display: "flex", alignItems: "center" }}>
                        <div style={{ width: "16px", height: "16px", border: "2px solid #2A2A2A", borderTopColor: "#E8651A", borderRadius: "50%", animation: "spin 0.6s linear infinite" }} />
                      </div>
                    )}
                  </div>
                  <button onClick={addSubreddit} disabled={validating} style={{ ...addBtnStyle, opacity: validating ? 0.5 : 1 }}>
                    {validating ? "Checking..." : "+ Add"}
                  </button>
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
        {activeTab === "Notifications" && (() => {
          const [emailEnabled, setEmailEnabled] = useState(true);
          const [threshold, setThreshold] = useState("high_medium");
          const [notifSaving, setNotifSaving] = useState(false);
          const [notifMsg, setNotifMsg] = useState<string | null>(null);

          async function saveNotifications() {
            setNotifSaving(true);
            setNotifMsg(null);
            const res = await fetch("/api/settings", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ section: "notifications", email_enabled: emailEnabled, alert_threshold: threshold }),
            });
            setNotifSaving(false);
            setNotifMsg(res.ok ? "Saved" : "Failed to save");
            setTimeout(() => setNotifMsg(null), 2000);
          }

          return (
            <div>
              <h2 style={{ fontFamily: "'Satoshi', system-ui, sans-serif", fontSize: "20px", fontWeight: 700, color: "#F5F5F3", marginBottom: "24px" }}>
                Notifications
              </h2>

              <div style={{ backgroundColor: "#141414", border: "1px solid #2A2A2A", borderRadius: "12px", padding: "20px", marginBottom: "16px" }}>
                {/* Email toggle */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
                  <div>
                    <div style={{ fontSize: "14px", fontWeight: 500, color: "#F5F5F3", marginBottom: "4px" }}>Email Alerts</div>
                    <div style={{ fontSize: "13px", color: "#A3A3A0" }}>Receive email notifications when relevant posts are found</div>
                  </div>
                  <button
                    onClick={() => setEmailEnabled(!emailEnabled)}
                    style={{
                      width: "44px", height: "24px", borderRadius: "12px", border: "none",
                      backgroundColor: emailEnabled ? "#E8651A" : "#2A2A2A",
                      cursor: "pointer", position: "relative", transition: "background-color 150ms",
                    }}
                  >
                    <span style={{
                      position: "absolute", top: "2px", width: "20px", height: "20px",
                      borderRadius: "50%", backgroundColor: "#FFF", transition: "left 150ms",
                      left: emailEnabled ? "22px" : "2px",
                    }} />
                  </button>
                </div>

                {/* Threshold */}
                {emailEnabled && (
                  <div>
                    <div style={{ fontSize: "14px", fontWeight: 500, color: "#F5F5F3", marginBottom: "8px" }}>Alert Threshold</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      {[
                        { key: "all", label: "All alerts", desc: "High + Medium + Low priority" },
                        { key: "high_medium", label: "High + Medium only", desc: "Recommended — filters out noise" },
                        { key: "high_only", label: "High priority only", desc: "Only the most important alerts" },
                      ].map((opt) => (
                        <button
                          key={opt.key}
                          onClick={() => setThreshold(opt.key)}
                          style={{
                            display: "flex", alignItems: "center", gap: "12px",
                            padding: "12px 14px", borderRadius: "8px",
                            border: `1px solid ${threshold === opt.key ? "#E8651A" : "#2A2A2A"}`,
                            backgroundColor: threshold === opt.key ? "rgba(232, 101, 26, 0.08)" : "transparent",
                            cursor: "pointer", textAlign: "left",
                          }}
                        >
                          <span style={{
                            width: "16px", height: "16px", borderRadius: "50%",
                            border: `2px solid ${threshold === opt.key ? "#E8651A" : "#555"}`,
                            backgroundColor: threshold === opt.key ? "#E8651A" : "transparent",
                            display: "inline-flex", alignItems: "center", justifyContent: "center",
                            flexShrink: 0,
                          }}>
                            {threshold === opt.key && <span style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: "#FFF" }} />}
                          </span>
                          <div>
                            <div style={{ fontSize: "14px", fontWeight: 500, color: "#F5F5F3" }}>{opt.label}</div>
                            <div style={{ fontSize: "12px", color: "#A3A3A0" }}>{opt.desc}</div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <button onClick={saveNotifications} disabled={notifSaving} style={{
                padding: "10px 24px", fontSize: "14px", fontWeight: 600, borderRadius: "8px",
                border: "none", backgroundColor: "#E8651A", color: "#FFF", cursor: "pointer",
                opacity: notifSaving ? 0.5 : 1, fontFamily: "'DM Sans', system-ui, sans-serif",
              }}>
                {notifSaving ? "Saving..." : "Save Preferences"}
              </button>
              {notifMsg && <span style={{ marginLeft: "12px", fontSize: "13px", color: notifMsg === "Saved" ? "#22C55E" : "#EF4444" }}>{notifMsg}</span>}
            </div>
          );
        })()}

        {/* Usage & Billing Tab */}
        {activeTab === "Usage & Billing" && (() => {
          const tier = userData?.plan_tier || "free";
          const isFree = tier === "free";
          const isGrowth = tier === "growth";

          const totalCredits = isFree ? 25 : isGrowth ? 250 : 500;
          const balance = credits?.balance ?? 0;
          const used = credits?.lifetime_used ?? 0;
          const consumedPercent = totalCredits > 0 ? Math.min(100, Math.round((used / totalCredits) * 100)) : 0;

          // Progress bar color based on consumption
          const barColor = consumedPercent >= 90 ? "#EF4444" : consumedPercent >= 70 ? "#F59E0B" : "#E8651A";

          // Format trial expiry with exact date + time in GMT
          function formatTrialExpiry(dateStr: string | null): string {
            if (!dateStr) return "—";
            const d = new Date(dateStr);
            return d.toLocaleString("en-US", {
              month: "short", day: "numeric", year: "numeric",
              hour: "numeric", minute: "2-digit", hour12: true, timeZone: "UTC",
            }) + " GMT";
          }

          return (
            <div>
              <h2 style={{ fontFamily: "'Satoshi', system-ui, sans-serif", fontSize: "20px", fontWeight: 700, color: "#F5F5F3", marginBottom: "24px" }}>
                Usage & Billing
              </h2>

              {/* Plan Type */}
              <div style={{ backgroundColor: "#141414", border: "1px solid #2A2A2A", borderRadius: "12px", padding: "20px", marginBottom: "16px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
                  <div>
                    <span style={{ fontSize: "13px", color: "#A3A3A0" }}>Current Plan</span>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "4px" }}>
                      <span style={{ fontSize: "22px", fontWeight: 700, color: "#F5F5F3", textTransform: "capitalize", fontFamily: "'Satoshi', system-ui, sans-serif" }}>
                        {tier}
                      </span>
                      {isFree && (
                        <span style={{ fontSize: "11px", fontWeight: 600, padding: "3px 8px", borderRadius: "4px", backgroundColor: "rgba(232, 101, 26, 0.12)", color: "#E8651A" }}>
                          Trial
                        </span>
                      )}
                      {isGrowth && (
                        <span style={{ fontSize: "11px", fontWeight: 600, padding: "3px 8px", borderRadius: "4px", backgroundColor: "rgba(34, 197, 94, 0.12)", color: "#22C55E" }}>
                          Active
                        </span>
                      )}
                    </div>
                  </div>
                  {isGrowth && (
                    <span style={{ fontSize: "22px", fontWeight: 700, color: "#F5F5F3", fontFamily: "'Satoshi', system-ui, sans-serif" }}>
                      $39<span style={{ fontSize: "14px", fontWeight: 400, color: "#A3A3A0" }}>/mo</span>
                    </span>
                  )}
                </div>

                {/* Expiry / Renewal date */}
                <div style={{ marginTop: "12px", paddingTop: "12px", borderTop: "1px solid #2A2A2A" }}>
                  {isFree && (
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px" }}>
                      <span style={{ color: "#A3A3A0" }}>Trial expires</span>
                      <span style={{
                        color: userData?.trial_ends_at && new Date(userData.trial_ends_at) < new Date() ? "#EF4444" : "#F5F5F3",
                        fontWeight: 500,
                      }}>
                        {userData?.trial_ends_at
                          ? formatTrialExpiry(userData.trial_ends_at) + (new Date(userData.trial_ends_at) < new Date() ? " (Expired)" : "")
                          : "Not activated"}
                      </span>
                    </div>
                  )}
                  {isGrowth && (
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px" }}>
                      <span style={{ color: "#A3A3A0" }}>Next renewal</span>
                      <span style={{ color: "#F5F5F3", fontWeight: 500 }}>
                        {credits?.last_reset_at
                          ? new Date(new Date(credits.last_reset_at).getTime() + 30 * 86400000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                          : "—"}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Credits Consumed */}
              <div style={{ backgroundColor: "#141414", border: "1px solid #2A2A2A", borderRadius: "12px", padding: "20px", marginBottom: "16px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
                  <span style={{ fontSize: "14px", fontWeight: 500, color: "#F5F5F3" }}>Credits Consumed</span>
                  <span style={{ fontSize: "13px", color: "#A3A3A0" }}>
                    {isFree ? "Lifetime allocation" : "Resets monthly"}
                  </span>
                </div>

                {/* Visual progress bar */}
                <div style={{ marginBottom: "16px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", marginBottom: "8px" }}>
                    <span style={{ color: "#A3A3A0" }}>
                      <span style={{ color: barColor, fontWeight: 700, fontSize: "20px" }}>{used.toFixed(1)}</span>
                      <span style={{ color: "#6B6B68" }}> / {totalCredits}</span>
                      <span style={{ color: "#6B6B68" }}> consumed</span>
                    </span>
                    <span style={{ color: "#6B6B68" }}>{consumedPercent}% used</span>
                  </div>

                  {/* Progress bar track */}
                  <div style={{ width: "100%", height: "10px", backgroundColor: "#2A2A2A", borderRadius: "5px", overflow: "hidden" }}>
                    <div
                      style={{
                        width: `${consumedPercent}%`,
                        height: "100%",
                        backgroundColor: barColor,
                        borderRadius: "5px",
                        transition: "width 300ms ease",
                        minWidth: consumedPercent > 0 ? "4px" : "0",
                      }}
                    />
                  </div>
                </div>

                {/* Low credits warning */}
                {consumedPercent >= 80 && balance > 0 && (
                  <div style={{ marginTop: "12px", padding: "10px 14px", backgroundColor: "rgba(245, 158, 11, 0.08)", border: "1px solid rgba(245, 158, 11, 0.25)", borderRadius: "8px", fontSize: "13px", color: "#F59E0B" }}>
                    Your credits are running low. Upgrade to Growth for 250 credits/month.
                  </div>
                )}
                {balance <= 0 && (
                  <div style={{ marginTop: "12px", padding: "10px 14px", backgroundColor: "rgba(239, 68, 68, 0.08)", border: "1px solid rgba(239, 68, 68, 0.25)", borderRadius: "8px", fontSize: "13px", color: "#EF4444" }}>
                    No credits remaining. Upgrade your plan to continue using Thread Analysis and Comment Drafting.
                  </div>
                )}
              </div>

              {/* Upgrade CTA */}
              {(isFree || (isGrowth && balance <= 0)) && (
                <button
                  onClick={() => window.location.href = "/pricing"}
                  style={{
                    width: "100%", padding: "14px", fontSize: "15px", fontWeight: 600,
                    borderRadius: "10px", border: "none", backgroundColor: "#E8651A",
                    color: "#FFF", cursor: "pointer", fontFamily: "'DM Sans', system-ui, sans-serif",
                    transition: "background-color 150ms",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#F57A33"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "#E8651A"; }}
                >
                  {isFree ? "Upgrade to Growth — $39/mo" : "Upgrade Plan"}
                </button>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
