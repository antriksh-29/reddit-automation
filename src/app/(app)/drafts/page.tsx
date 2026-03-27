"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams } from "next/navigation";

/**
 * Draft Response — standalone comment drafting page.
 * Completely separate from Thread Analysis.
 * Ref: PRODUCT-SPEC.md §5.4
 */

interface CommentDraft {
  id: string;
  draft_text: string;
  tone: string;
  approval_state: string;
}

const spinCSS = `
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes shimmer-border {
  0% { border-color: rgba(232, 101, 26, 0.3); }
  50% { border-color: rgba(232, 101, 26, 0.8); }
  100% { border-color: rgba(232, 101, 26, 0.3); }
}
`;

function refreshCredits() {
  window.dispatchEvent(new CustomEvent("credits-updated"));
}

export default function DraftsPage() {
  const searchParams = useSearchParams();
  const alertId = searchParams.get("alert_id");

  const [drafts, setDrafts] = useState<CommentDraft[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [subredditRules, setSubredditRules] = useState<string>("");
  const [postTitle, setPostTitle] = useState<string>("");
  const [postUrl, setPostUrl] = useState<string>("");
  const [subredditName, setSubredditName] = useState<string>("");

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  // Per-draft states
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Review my draft state
  const [showReviewPanel, setShowReviewPanel] = useState(false);
  const [userDraftText, setUserDraftText] = useState("");
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewResult, setReviewResult] = useState<{
    overall_score: number;
    rule_violations: { rule: string; issue: string; severity: string }[];
    suggestions: { type: string; suggestion: string }[];
    improved_draft: string;
  } | null>(null);
  const [improvedCopied, setImprovedCopied] = useState(false);

  // Auto-resize refs
  const editRef = useRef<HTMLTextAreaElement>(null);
  const userDraftRef = useRef<HTMLTextAreaElement>(null);

  const autoResize = useCallback((ref: React.RefObject<HTMLTextAreaElement | null>) => {
    if (ref.current) {
      ref.current.style.height = "auto";
      ref.current.style.height = ref.current.scrollHeight + "px";
    }
  }, []);

  // Credit confirmation
  const [showConfirm, setShowConfirm] = useState(false);
  const [creditBalance, setCreditBalance] = useState<number | null>(null);

  useEffect(() => {
    if (alertId) {
      fetchAlertInfo();
      checkCreditsAndConfirm();
    }
  }, [alertId]);

  async function fetchAlertInfo() {
    try {
      const res = await fetch(`/api/alerts?id=${alertId}`);
      if (res.ok) {
        const data = await res.json();
        const alert = data.alerts?.[0] || data.alert;
        if (alert) {
          setPostTitle(alert.post_title || "");
          setPostUrl(alert.post_url || "");
          setSubredditName(alert.subreddit_name || "");
        }
      }
    } catch {
      // Non-blocking
    }
  }

  async function checkCreditsAndConfirm() {
    try {
      const res = await fetch("/api/credits/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "draft_generation" }),
      });
      const data = await res.json();
      setCreditBalance(data.balance);
      setShowConfirm(true);
    } catch {
      // If credit check fails, still allow (will fail at generation)
      setShowConfirm(true);
    }
  }

  async function generateDrafts() {
    setShowConfirm(false);
    setLoading(true);
    setError(null);
    setDrafts([]);

    try {
      const res = await fetch("/api/drafts/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alert_id: alertId }),
      });

      const data = await res.json();
      if (!res.ok) {
        if (res.status === 402) {
          setError(`Insufficient credits. Balance: ${data.balance?.toFixed(1)}`);
        } else {
          setError(data.error || "Failed to generate drafts");
        }
        return;
      }

      setDrafts(data.drafts || []);
      setSubredditRules(data.subreddit_rules || "");
      refreshCredits();
    } catch {
      setError("Failed to generate drafts. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function regenerateDraft(draftId: string) {
    setRegeneratingId(draftId);
    try {
      const res = await fetch("/api/drafts/generate", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft_id: draftId }),
      });

      const data = await res.json();
      if (res.ok && data.draft) {
        setDrafts((prev) => prev.map((d) => d.id === draftId ? data.draft : d));
        refreshCredits();
      } else if (res.status === 402) {
        setError(`Insufficient credits. Balance: ${data.balance?.toFixed(1)}`);
      }
    } catch {
      setError("Failed to regenerate draft");
    } finally {
      setRegeneratingId(null);
    }
  }

  async function reviewUserDraft() {
    if (!userDraftText.trim() || !alertId) return;
    setReviewLoading(true);
    setReviewResult(null);
    setError(null);

    try {
      const res = await fetch("/api/drafts/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alert_id: alertId, user_draft: userDraftText }),
      });

      const data = await res.json();
      if (!res.ok) {
        if (res.status === 402) {
          setError(`Insufficient credits. Balance: ${data.balance?.toFixed(1)}`);
        } else {
          setError(data.error || "Failed to review draft");
        }
        return;
      }

      setReviewResult(data.review);
      refreshCredits();
    } catch {
      setError("Failed to review draft. Please try again.");
    } finally {
      setReviewLoading(false);
    }
  }

  function copyDraft(draftId: string, text: string) {
    navigator.clipboard.writeText(text);
    setCopiedId(draftId);
    setTimeout(() => setCopiedId(null), 2000);
  }

  function startEditing(draft: CommentDraft) {
    setEditingId(draft.id);
    setEditText(draft.draft_text);
    // Trigger auto-resize after state update
    setTimeout(() => autoResize(editRef), 0);
  }

  function saveEdit(draftId: string) {
    setDrafts((prev) => prev.map((d) => d.id === draftId ? { ...d, draft_text: editText } : d));
    setEditingId(null);
    setEditText("");
  }

  if (!alertId) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh" }}>
        <div style={{ textAlign: "center", maxWidth: "400px" }}>
          <h2 style={{ fontFamily: "'Satoshi', system-ui, sans-serif", fontSize: "20px", fontWeight: 700, color: "#F5F5F3", marginBottom: "8px" }}>
            Draft Response
          </h2>
          <p style={{ fontSize: "14px", color: "#A3A3A0", lineHeight: 1.6 }}>
            Click &quot;Draft Response&quot; on any alert from the Dashboard to generate AI-powered comment drafts.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: "720px", margin: "0 auto" }}>
      <style dangerouslySetInnerHTML={{ __html: spinCSS }} />

      {/* Header */}
      <div style={{ marginBottom: "24px" }}>
        <h1 style={{ fontFamily: "'Satoshi', system-ui, sans-serif", fontSize: "22px", fontWeight: 700, color: "#F5F5F3", marginBottom: "6px" }}>
          Draft Response
        </h1>
        {postTitle && (
          <p style={{ fontSize: "14px", color: "#A3A3A0", lineHeight: 1.5 }}>
            {subredditName && <span style={{ color: "#E8651A", fontWeight: 500 }}>r/{subredditName}</span>}
            {subredditName && " · "}
            {postTitle}
          </p>
        )}
        {postUrl && (
          <a href={postUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: "12px", color: "#E8651A", textDecoration: "none", marginTop: "4px", display: "inline-block" }}>
            View original thread on Reddit ↗
          </a>
        )}
      </div>

      {/* Credit Confirmation Dialog */}
      {showConfirm && (
        <div style={{
          backgroundColor: "#1A1A1A", border: "1px solid #2A2A2A", borderRadius: "12px",
          padding: "24px", marginBottom: "24px",
        }}>
          <h3 style={{ fontSize: "16px", fontWeight: 600, color: "#F5F5F3", marginBottom: "16px" }}>
            Generate Comment Drafts
          </h3>

          <div style={{ backgroundColor: "#141414", border: "1px solid #2A2A2A", borderRadius: "8px", padding: "14px", marginBottom: "16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "10px" }}>
              <span style={{ fontSize: "14px", color: "#A3A3A0" }}>Estimated cost</span>
              <span style={{ fontSize: "16px", fontWeight: 700, color: "#E8651A" }}>2-4 credits</span>
            </div>
            <div style={{ height: "1px", backgroundColor: "#2A2A2A", marginBottom: "10px" }} />
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontSize: "14px", color: "#A3A3A0" }}>Your balance</span>
              <span style={{ fontSize: "16px", fontWeight: 700, color: creditBalance !== null && creditBalance < 2 ? "#EF4444" : "#22C55E" }}>
                {creditBalance !== null ? creditBalance.toFixed(1) : "—"} credits
              </span>
            </div>
          </div>

          {creditBalance !== null && creditBalance < 2 && (
            <div style={{ backgroundColor: "rgba(239, 68, 68, 0.08)", border: "1px solid rgba(239, 68, 68, 0.25)", borderRadius: "8px", padding: "12px", fontSize: "13px", color: "#EF4444", marginBottom: "16px" }}>
              You don&apos;t have enough credits for draft generation.
            </div>
          )}

          <div style={{ display: "flex", gap: "10px" }}>
            <button
              onClick={() => window.history.back()}
              style={{
                flex: 1, padding: "10px", fontSize: "14px", fontWeight: 500, borderRadius: "8px",
                border: "1px solid #2A2A2A", backgroundColor: "transparent", color: "#A3A3A0",
                cursor: "pointer", fontFamily: "'DM Sans', system-ui, sans-serif",
              }}
            >
              Cancel
            </button>
            <button
              onClick={generateDrafts}
              disabled={creditBalance !== null && creditBalance < 2}
              style={{
                flex: 1, padding: "10px", fontSize: "14px", fontWeight: 600, borderRadius: "8px",
                border: "none", backgroundColor: creditBalance !== null && creditBalance < 2 ? "#555" : "#E8651A",
                color: "#FFF", cursor: creditBalance !== null && creditBalance < 2 ? "not-allowed" : "pointer",
                fontFamily: "'DM Sans', system-ui, sans-serif",
                opacity: creditBalance !== null && creditBalance < 2 ? 0.5 : 1,
              }}
            >
              Generate Drafts
            </button>
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: "center", padding: "40px" }}>
          <div style={{ width: "28px", height: "28px", border: "3px solid #2A2A2A", borderTopColor: "#E8651A", borderRadius: "50%", animation: "spin 0.6s linear infinite", margin: "0 auto 16px" }} />
          <p style={{ fontSize: "14px", color: "#A3A3A0" }}>Generating drafts...</p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ backgroundColor: "rgba(239, 68, 68, 0.08)", border: "1px solid rgba(239, 68, 68, 0.25)", borderRadius: "8px", padding: "12px 16px", fontSize: "13px", color: "#EF4444", marginBottom: "20px" }}>
          {error}
        </div>
      )}

      {/* Subreddit Rules */}
      {subredditRules && !showConfirm && (
        <div style={{ backgroundColor: "rgba(245, 158, 11, 0.06)", border: "1px solid rgba(245, 158, 11, 0.2)", borderRadius: "10px", padding: "14px 16px", marginBottom: "20px" }}>
          <div style={{ fontSize: "12px", fontWeight: 600, color: "#F59E0B", marginBottom: "8px", textTransform: "uppercase" }}>
            Subreddit Rules
          </div>
          <div style={{ fontSize: "13px", color: "#C0C0BD", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
            {subredditRules.slice(0, 600)}
          </div>
        </div>
      )}

      {/* Drafts */}
      {/* ===== REVIEW MY DRAFT — toggle button ===== */}
      {!loading && !showConfirm && drafts.length > 0 && !showReviewPanel && (
        <div style={{ marginBottom: "20px" }}>
          <button
            onClick={() => setShowReviewPanel(true)}
            style={{
              width: "100%", padding: "14px", fontSize: "14px", fontWeight: 600,
              borderRadius: "8px", border: "1px solid rgba(232, 101, 26, 0.4)",
              backgroundColor: "rgba(232, 101, 26, 0.06)",
              color: "#E8651A", cursor: "pointer", fontFamily: "'DM Sans', system-ui, sans-serif",
              animation: "shimmer-border 2s ease-in-out infinite",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "rgba(232, 101, 26, 0.12)";
              e.currentTarget.style.borderColor = "#E8651A";
              e.currentTarget.style.animation = "none";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "rgba(232, 101, 26, 0.06)";
              e.currentTarget.style.borderColor = "rgba(232, 101, 26, 0.4)";
              e.currentTarget.style.animation = "shimmer-border 2s ease-in-out infinite";
            }}
          >
            Have your own draft? Get it reviewed by AI →
          </button>
        </div>
      )}

      {/* ===== REVIEW MY DRAFT — panel ===== */}
      {showReviewPanel && (
        <div style={{
          backgroundColor: "#1A1A1A", border: "1px solid #2A2A2A",
          borderRadius: "12px", padding: "20px", marginBottom: "20px",
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
            <h3 style={{ fontSize: "16px", fontWeight: 600, color: "#F5F5F3", fontFamily: "'Satoshi', system-ui, sans-serif" }}>
              Review My Draft
            </h3>
            <button
              onClick={() => { setShowReviewPanel(false); setReviewResult(null); setUserDraftText(""); }}
              style={{ background: "none", border: "none", color: "#6B6B68", cursor: "pointer", fontSize: "18px" }}
            >
              ✕
            </button>
          </div>

          <p style={{ fontSize: "13px", color: "#A3A3A0", marginBottom: "14px", lineHeight: 1.5 }}>
            Paste your comment draft below. Our AI will check it against subreddit rules, suggest improvements, and provide an enhanced version.
          </p>

          {/* User draft input */}
          <textarea
            ref={userDraftRef}
            value={userDraftText}
            onChange={(e) => { setUserDraftText(e.target.value); setTimeout(() => autoResize(userDraftRef), 0); }}
            placeholder="Paste your draft comment here..."
            style={{
              width: "100%", minHeight: "80px", backgroundColor: "#0A0A0A",
              border: "1px solid #2A2A2A", borderRadius: "8px", padding: "14px",
              fontSize: "14px", color: "#F5F5F3", outline: "none", resize: "none",
              overflow: "hidden",
              fontFamily: "'DM Sans', system-ui, sans-serif", lineHeight: 1.7,
              boxSizing: "border-box", marginBottom: "12px",
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = "#E8651A"; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = "#2A2A2A"; }}
          />

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: reviewResult ? "20px" : "0" }}>
            <span style={{ fontSize: "11px", color: "#555" }}>~2-4 credits</span>
            <button
              onClick={reviewUserDraft}
              disabled={!userDraftText.trim() || reviewLoading}
              style={{
                padding: "10px 24px", fontSize: "14px", fontWeight: 600, borderRadius: "8px",
                border: "none", backgroundColor: "#E8651A", color: "#FFF", cursor: "pointer",
                fontFamily: "'DM Sans', system-ui, sans-serif",
                opacity: !userDraftText.trim() || reviewLoading ? 0.5 : 1,
                display: "flex", alignItems: "center", gap: "8px",
              }}
            >
              {reviewLoading && (
                <span style={{ width: "14px", height: "14px", border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.6s linear infinite", display: "inline-block" }} />
              )}
              {reviewLoading ? "Reviewing" : "Review Draft"}
            </button>
          </div>

          {/* Review Results */}
          {reviewResult && (
            <div style={{ borderTop: "1px solid #2A2A2A", paddingTop: "20px" }}>

              {/* Score */}
              <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px" }}>
                <div style={{
                  width: "48px", height: "48px", borderRadius: "50%", display: "flex",
                  alignItems: "center", justifyContent: "center", fontSize: "18px", fontWeight: 700,
                  backgroundColor: reviewResult.overall_score >= 8 ? "rgba(34, 197, 94, 0.12)" : reviewResult.overall_score >= 5 ? "rgba(245, 158, 11, 0.12)" : "rgba(239, 68, 68, 0.12)",
                  color: reviewResult.overall_score >= 8 ? "#22C55E" : reviewResult.overall_score >= 5 ? "#F59E0B" : "#EF4444",
                  border: `2px solid ${reviewResult.overall_score >= 8 ? "#22C55E" : reviewResult.overall_score >= 5 ? "#F59E0B" : "#EF4444"}`,
                }}>
                  {reviewResult.overall_score}/10
                </div>
                <div>
                  <div style={{ fontSize: "14px", fontWeight: 600, color: "#F5F5F3" }}>
                    {reviewResult.overall_score >= 8 ? "Ready to post" : reviewResult.overall_score >= 5 ? "Needs some work" : "Needs significant changes"}
                  </div>
                  <div style={{ fontSize: "12px", color: "#A3A3A0" }}>Readiness score</div>
                </div>
              </div>

              {/* Rule Violations */}
              {reviewResult.rule_violations.length > 0 && (
                <div style={{ backgroundColor: "rgba(239, 68, 68, 0.06)", border: "1px solid rgba(239, 68, 68, 0.2)", borderRadius: "8px", padding: "14px", marginBottom: "14px" }}>
                  <div style={{ fontSize: "12px", fontWeight: 600, color: "#EF4444", marginBottom: "10px", textTransform: "uppercase" }}>Rule Violations</div>
                  {reviewResult.rule_violations.map((v, i) => (
                    <div key={i} style={{ display: "flex", gap: "8px", marginBottom: "8px", fontSize: "13px", lineHeight: 1.5 }}>
                      <span style={{ color: "#EF4444", flexShrink: 0 }}>•</span>
                      <div>
                        <span style={{ fontWeight: 500, color: "#F5F5F3" }}>{v.rule}</span>
                        <span style={{
                          fontSize: "10px", padding: "1px 5px", borderRadius: "3px", marginLeft: "6px",
                          backgroundColor: v.severity === "high" ? "rgba(239,68,68,0.12)" : v.severity === "medium" ? "rgba(245,158,11,0.12)" : "rgba(107,107,104,0.12)",
                          color: v.severity === "high" ? "#EF4444" : v.severity === "medium" ? "#F59E0B" : "#A3A3A0",
                        }}>
                          {v.severity}
                        </span>
                        <p style={{ color: "#C0C0BD", marginTop: "2px" }}>{v.issue}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Suggestions */}
              {reviewResult.suggestions.length > 0 && (
                <div style={{ backgroundColor: "rgba(96, 165, 250, 0.06)", border: "1px solid rgba(96, 165, 250, 0.2)", borderRadius: "8px", padding: "14px", marginBottom: "14px" }}>
                  <div style={{ fontSize: "12px", fontWeight: 600, color: "#60A5FA", marginBottom: "10px", textTransform: "uppercase" }}>Suggestions</div>
                  {reviewResult.suggestions.map((s, i) => (
                    <div key={i} style={{ display: "flex", gap: "8px", marginBottom: "8px", fontSize: "13px", lineHeight: 1.5 }}>
                      <span style={{ color: "#60A5FA", flexShrink: 0 }}>•</span>
                      <div>
                        <span style={{
                          fontSize: "10px", padding: "1px 5px", borderRadius: "3px",
                          backgroundColor: "rgba(96,165,250,0.12)", color: "#60A5FA", marginRight: "6px",
                        }}>
                          {s.type}
                        </span>
                        <span style={{ color: "#F5F5F3" }}>{s.suggestion}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Improved Draft */}
              {reviewResult.improved_draft && (
                <div style={{ backgroundColor: "#141414", border: "1px solid #2A2A2A", borderRadius: "8px", padding: "16px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
                    <div style={{ fontSize: "12px", fontWeight: 600, color: "#22C55E", textTransform: "uppercase" }}>Improved Version</div>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(reviewResult.improved_draft);
                        setImprovedCopied(true);
                        setTimeout(() => setImprovedCopied(false), 2000);
                      }}
                      style={{
                        padding: "4px 12px", fontSize: "11px", borderRadius: "4px",
                        border: "1px solid #2A2A2A",
                        backgroundColor: improvedCopied ? "rgba(34, 197, 94, 0.12)" : "transparent",
                        color: improvedCopied ? "#22C55E" : "#A3A3A0",
                        cursor: "pointer", fontFamily: "'DM Sans', system-ui, sans-serif",
                      }}
                    >
                      {improvedCopied ? "Copied!" : "Copy"}
                    </button>
                  </div>
                  <p style={{ fontSize: "14px", color: "#F5F5F3", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
                    {reviewResult.improved_draft}
                  </p>
                </div>
              )}

              {/* No violations */}
              {reviewResult.rule_violations.length === 0 && (
                <div style={{ backgroundColor: "rgba(34, 197, 94, 0.06)", border: "1px solid rgba(34, 197, 94, 0.2)", borderRadius: "8px", padding: "12px 14px", fontSize: "13px", color: "#22C55E", marginBottom: "14px" }}>
                  No rule violations detected. Your draft looks compliant with the subreddit rules.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ===== AI-GENERATED DRAFTS ===== */}
      {!loading && !showConfirm && drafts.map((draft) => (
        <div
          key={draft.id}
          style={{
            backgroundColor: "#1A1A1A", border: "1px solid #2A2A2A",
            borderRadius: "10px", padding: "18px", marginBottom: "14px",
          }}
        >
          <div style={{ fontSize: "12px", fontWeight: 600, color: "#E8651A", marginBottom: "12px", textTransform: "uppercase" }}>
            {draft.tone}
          </div>

          {editingId === draft.id ? (
            <>
              <textarea
                ref={editRef}
                value={editText}
                onChange={(e) => { setEditText(e.target.value); setTimeout(() => autoResize(editRef), 0); }}
                style={{
                  width: "100%", minHeight: "80px", backgroundColor: "#0A0A0A",
                  border: "1px solid #E8651A", borderRadius: "8px", padding: "14px",
                  fontSize: "14px", color: "#F5F5F3", outline: "none", resize: "none",
                  overflow: "hidden",
                  fontFamily: "'DM Sans', system-ui, sans-serif", lineHeight: 1.7,
                  boxSizing: "border-box",
                }}
              />
              <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
                <button
                  onClick={() => saveEdit(draft.id)}
                  style={{ padding: "8px 18px", fontSize: "13px", fontWeight: 600, borderRadius: "6px", border: "none", backgroundColor: "#E8651A", color: "#FFF", cursor: "pointer", fontFamily: "'DM Sans', system-ui, sans-serif" }}
                >
                  Save
                </button>
                <button
                  onClick={() => { setEditingId(null); setEditText(""); }}
                  style={{ padding: "8px 18px", fontSize: "13px", borderRadius: "6px", border: "1px solid #2A2A2A", backgroundColor: "transparent", color: "#A3A3A0", cursor: "pointer", fontFamily: "'DM Sans', system-ui, sans-serif" }}
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <p style={{ fontSize: "14px", color: "#F5F5F3", lineHeight: 1.7, whiteSpace: "pre-wrap", marginBottom: "14px" }}>
                {draft.draft_text}
              </p>

              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <button
                  onClick={() => copyDraft(draft.id, draft.draft_text)}
                  style={{
                    padding: "7px 16px", fontSize: "12px", fontWeight: 500, borderRadius: "6px",
                    border: "1px solid #2A2A2A",
                    backgroundColor: copiedId === draft.id ? "rgba(34, 197, 94, 0.12)" : "transparent",
                    color: copiedId === draft.id ? "#22C55E" : "#A3A3A0",
                    cursor: "pointer", fontFamily: "'DM Sans', system-ui, sans-serif", transition: "all 150ms",
                  }}
                >
                  {copiedId === draft.id ? "Copied!" : "Copy"}
                </button>
                <button
                  onClick={() => startEditing(draft)}
                  style={{ padding: "7px 16px", fontSize: "12px", fontWeight: 500, borderRadius: "6px", border: "1px solid #2A2A2A", backgroundColor: "transparent", color: "#A3A3A0", cursor: "pointer", fontFamily: "'DM Sans', system-ui, sans-serif" }}
                >
                  Edit
                </button>
                <button
                  onClick={() => regenerateDraft(draft.id)}
                  disabled={regeneratingId === draft.id}
                  style={{
                    padding: "7px 16px", fontSize: "12px", fontWeight: 500, borderRadius: "6px",
                    border: "1px solid #2A2A2A", backgroundColor: "transparent",
                    color: "#A3A3A0", cursor: "pointer", fontFamily: "'DM Sans', system-ui, sans-serif",
                    opacity: regeneratingId === draft.id ? 0.5 : 1,
                    display: "flex", alignItems: "center", gap: "6px",
                  }}
                >
                  {regeneratingId === draft.id && (
                    <span style={{ width: "12px", height: "12px", border: "2px solid #2A2A2A", borderTopColor: "#E8651A", borderRadius: "50%", animation: "spin 0.6s linear infinite", display: "inline-block" }} />
                  )}
                  Regenerate
                </button>
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
