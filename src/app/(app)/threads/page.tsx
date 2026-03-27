"use client";

import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";

/**
 * Thread Analysis — Chat interface with sidebar history.
 * Ref: PRODUCT-SPEC.md §5.3, DESIGN-SYSTEM.md
 */

interface ThreadSummary {
  id: string;
  thread_title: string;
  reddit_url: string;
  created_at: string;
}

interface ThreadAnalysis {
  id: string;
  thread_title: string;
  reddit_url: string;
  summary: string;
  pain_points: string[];
  key_insights: string[];
  buying_signals: { user: string; signal: string }[];
  competitive_landscape: { competitor: string; sentiment: string; context: string }[];
  comment_count: number;
  created_at: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

interface CommentDraft {
  id: string;
  draft_text: string;
  tone: string;
  approval_state: string;
}

interface CreditEstimate {
  estimatedCredits: number;
  cached: boolean;
  balance: number;
  hasEnough: boolean;
  message?: string;
  breakdown?: {
    postTitle?: string;
    commentCount?: number;
    fetchedComments?: number;
    totalTokens?: number;
  };
}

const SUGGESTED_QUESTIONS = [
  "What opportunities exist for us in this thread?",
  "Which commenters are potential customers?",
  "What specific features are users asking for?",
  "How should we position against the competitors mentioned?",
];

const spinCSS = `@keyframes spin { to { transform: rotate(360deg); } }`;

function stripMarkdown(text: string): string {
  return text
    .replace(/#{1,6}\s*/g, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^[-*]\s+/gm, "• ")
    .replace(/^>\s*/gm, "")
    .trim();
}

function refreshCredits() {
  window.dispatchEvent(new CustomEvent("credits-updated"));
}

function validateRedditUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return "Please enter a URL.";
  if (!trimmed.includes("reddit.com")) return "Please enter a valid Reddit URL (e.g., https://www.reddit.com/r/...).";
  if (!trimmed.match(/reddit\.com\/r\/\w+\/comments\/\w+/)) return "This doesn't look like a Reddit post URL. Make sure it links to a specific post, not a subreddit.";
  return null;
}

export default function ThreadsPage() {
  const [history, setHistory] = useState<ThreadSummary[]>([]);
  const [activeAnalysis, setActiveAnalysis] = useState<ThreadAnalysis | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showNewAnalysis, setShowNewAnalysis] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);
  const searchParams = useSearchParams();
  const autoAnalyzedRef = useRef(false);

  // Draft state
  const [showDrafts, setShowDrafts] = useState(false);
  const [drafts, setDrafts] = useState<CommentDraft[]>([]);
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftRules, setDraftRules] = useState<string>("");
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [alertIdForDraft, setAlertIdForDraft] = useState<string | null>(null);

  // Confirmation dialog state
  const [confirmDialog, setConfirmDialog] = useState<{
    show: boolean;
    url: string;
    loading: boolean;
    estimate: CreditEstimate | null;
  }>({ show: false, url: "", loading: false, estimate: null });

  useEffect(() => { fetchHistory(); }, []);

  // Auto-analyze from dashboard — show confirmation dialog first
  useEffect(() => {
    const url = searchParams.get("url");
    const isDraft = searchParams.get("draft") === "true";
    const alertId = searchParams.get("alert_id");
    if (url && !autoAnalyzedRef.current) {
      autoAnalyzedRef.current = true;
      if (alertId) setAlertIdForDraft(alertId);
      if (isDraft) {
        // Will auto-open drafts after analysis completes
        showConfirmation(url, true);
      } else {
        showConfirmation(url);
      }
    }
  }, [searchParams]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, chatLoading]);

  async function fetchHistory() {
    const res = await fetch("/api/threads");
    if (res.ok) {
      const data = await res.json();
      setHistory(data.threads);
    }
  }

  const [pendingDraftMode, setPendingDraftMode] = useState(false);

  /** Show confirmation dialog with dynamic credit estimate */
  async function showConfirmation(url: string, autoDraft = false) {
    if (autoDraft) setPendingDraftMode(true);
    const validationError = validateRedditUrl(url);
    if (validationError) {
      setError(validationError);
      return;
    }

    setConfirmDialog({ show: true, url, loading: true, estimate: null });
    setError(null);

    try {
      const res = await fetch("/api/threads/estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reddit_url: url }),
      });

      const data = await res.json();
      if (res.ok) {
        setConfirmDialog({ show: true, url, loading: false, estimate: data });
      } else {
        console.error("Estimate API error:", res.status, data);
        setConfirmDialog({ show: false, url: "", loading: false, estimate: null });
        setError(data.error || "Could not estimate credits");
      }
    } catch {
      setConfirmDialog({ show: false, url: "", loading: false, estimate: null });
      setError("Failed to estimate credits. Please try again.");
    }
  }

  function dismissConfirmation() {
    setConfirmDialog({ show: false, url: "", loading: false, estimate: null });
  }

  function confirmAndAnalyze() {
    const url = confirmDialog.url;
    dismissConfirmation();
    analyzeThread(url);
  }

  async function analyzeThread(url: string) {
    setAnalyzing(true);
    setError(null);
    setMessages([]);
    setActiveAnalysis(null);
    setShowNewAnalysis(false);

    try {
      const res = await fetch("/api/threads/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reddit_url: url }),
      });

      const data = await res.json();
      if (!res.ok) {
        if (res.status === 402) {
          setError(`Insufficient credits. Balance: ${data.balance}, Required: ${data.required}`);
        } else {
          setError(data.error || "Analysis failed");
        }
        return;
      }

      setActiveAnalysis(data.analysis);
      setMessages(data.messages || []);
      setUrlInput("");

      if (!data.cached) refreshCredits();
      fetchHistory();

      // Auto-open drafts if came from "Draft Response" button
      if (pendingDraftMode && alertIdForDraft) {
        setPendingDraftMode(false);
        generateDrafts(alertIdForDraft);
      }
    } catch {
      setError("Failed to analyze thread. Please try again.");
    } finally {
      setAnalyzing(false);
    }
  }

  async function loadExisting(threadId: string) {
    setAnalyzing(true);
    setError(null);
    setShowNewAnalysis(false);

    try {
      const thread = history.find((t) => t.id === threadId);
      if (!thread) return;

      const res = await fetch("/api/threads/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reddit_url: thread.reddit_url }),
      });

      const data = await res.json();
      if (res.ok) {
        setActiveAnalysis(data.analysis);
        setMessages(data.messages || []);
      }
    } catch {
      setError("Failed to load analysis");
    } finally {
      setAnalyzing(false);
    }
  }

  async function sendChat(msg?: string) {
    const text = msg || chatInput.trim();
    if (!text || !activeAnalysis) return;

    setChatInput("");
    setChatLoading(true);

    const userMsg: ChatMessage = {
      id: `temp-${Date.now()}`,
      role: "user",
      content: text,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const res = await fetch("/api/threads/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thread_analysis_id: activeAnalysis.id, message: text }),
      });

      const data = await res.json();
      if (res.ok) {
        const assistantMsg: ChatMessage = {
          id: `resp-${Date.now()}`,
          role: "assistant",
          content: stripMarkdown(data.response),
          created_at: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, assistantMsg]);
        refreshCredits();
      } else if (res.status === 402) {
        setError(`Insufficient credits. Balance: ${data.balance}`);
      }
    } catch {
      setError("Failed to send message");
    } finally {
      setChatLoading(false);
    }
  }

  // === DRAFT FUNCTIONS ===

  async function generateDrafts(alertId: string) {
    setShowDrafts(true);
    setDraftLoading(true);
    setDrafts([]);
    setDraftRules("");

    try {
      const res = await fetch("/api/drafts/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alert_id: alertId }),
      });

      const data = await res.json();
      if (!res.ok) {
        if (res.status === 402) {
          setError(`Insufficient credits for draft generation. Balance: ${data.balance}`);
        } else {
          setError(data.error || "Failed to generate drafts");
        }
        setShowDrafts(false);
        return;
      }

      setDrafts(data.drafts || []);
      setDraftRules(data.subreddit_rules || "");
      refreshCredits();
    } catch {
      setError("Failed to generate drafts. Please try again.");
      setShowDrafts(false);
    } finally {
      setDraftLoading(false);
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
        setError(`Insufficient credits. Balance: ${data.balance}`);
      }
    } catch {
      setError("Failed to regenerate draft");
    } finally {
      setRegeneratingId(null);
    }
  }

  function copyDraft(draftId: string, text: string) {
    navigator.clipboard.writeText(text);
    setCopiedId(draftId);
    setTimeout(() => setCopiedId(null), 2000);
  }

  function startEditing(draft: CommentDraft) {
    setEditingDraftId(draft.id);
    setEditText(draft.draft_text);
  }

  function saveEdit(draftId: string) {
    setDrafts((prev) => prev.map((d) => d.id === draftId ? { ...d, draft_text: editText } : d));
    setEditingDraftId(null);
    setEditText("");
    // Persist to DB (non-blocking)
    fetch("/api/drafts/generate", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draft_id: draftId, text: editText }),
    }).catch(() => {});
  }

  function groupByDate(items: ThreadSummary[]): Record<string, ThreadSummary[]> {
    const groups: Record<string, ThreadSummary[]> = {};
    const now = new Date();
    for (const item of items) {
      const date = new Date(item.created_at);
      const diffDays = Math.floor((now.getTime() - date.getTime()) / 86400000);
      let label: string;
      if (diffDays === 0) label = "Today";
      else if (diffDays === 1) label = "Yesterday";
      else if (diffDays < 7) label = "This Week";
      else label = "Earlier";
      if (!groups[label]) groups[label] = [];
      groups[label].push(item);
    }
    return groups;
  }

  function handleNewAnalysis() {
    setActiveAnalysis(null);
    setMessages([]);
    setError(null);
    setShowNewAnalysis(true);
    setUrlInput("");
  }

  function handleNewAnalysisSubmit() {
    if (!urlInput.trim()) return;
    showConfirmation(urlInput.trim());
  }

  const groupedHistory = groupByDate(history);

  return (
    <div style={{ display: "flex", height: "calc(100vh - 80px)", gap: 0 }}>
      <style dangerouslySetInnerHTML={{ __html: spinCSS }} />

      {/* ===== CONFIRMATION DIALOG (overlay) ===== */}
      {confirmDialog.show && (
        <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}>
          <div style={{ backgroundColor: "#1A1A1A", border: "1px solid #2A2A2A", borderRadius: "12px", padding: "28px", width: "100%", maxWidth: "420px", boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }}>
            {confirmDialog.loading ? (
              <div style={{ textAlign: "center", padding: "20px 0" }}>
                <div style={{ width: "28px", height: "28px", border: "3px solid #2A2A2A", borderTopColor: "#E8651A", borderRadius: "50%", animation: "spin 0.6s linear infinite", margin: "0 auto 16px" }} />
                <p style={{ fontSize: "14px", color: "#A3A3A0" }}>Estimating credits...</p>
              </div>
            ) : confirmDialog.estimate ? (
              <>
                <h3 style={{ fontFamily: "'Satoshi', system-ui, sans-serif", fontSize: "18px", fontWeight: 700, color: "#F5F5F3", marginBottom: "16px" }}>
                  Confirm Thread Analysis
                </h3>

                {confirmDialog.estimate.cached ? (
                  <>
                    <div style={{ backgroundColor: "rgba(34, 197, 94, 0.08)", border: "1px solid rgba(34, 197, 94, 0.25)", borderRadius: "8px", padding: "12px 14px", fontSize: "13px", color: "#22C55E", marginBottom: "20px", lineHeight: 1.5 }}>
                      This thread was already analyzed. No credits will be used.
                    </div>
                    <button
                      onClick={confirmAndAnalyze}
                      style={{
                        width: "100%", padding: "10px", fontSize: "14px", fontWeight: 600,
                        borderRadius: "8px", border: "none", backgroundColor: "#E8651A",
                        color: "#FFF", cursor: "pointer", fontFamily: "'DM Sans', system-ui, sans-serif",
                      }}
                    >
                      View Analysis
                    </button>
                  </>
                ) : (
                  <>
                    <div style={{ backgroundColor: "#141414", border: "1px solid #2A2A2A", borderRadius: "8px", padding: "14px", marginBottom: "20px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                        <span style={{ fontSize: "14px", color: "#A3A3A0" }}>Estimated cost</span>
                        <span style={{ fontSize: "18px", fontWeight: 700, color: "#E8651A" }}>
                          {confirmDialog.estimate.estimatedCredits} credits
                        </span>
                      </div>

                      <div style={{ height: "1px", backgroundColor: "#2A2A2A", margin: "0 0 12px" }} />

                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: "14px", color: "#A3A3A0" }}>Your balance</span>
                        <span style={{ fontSize: "18px", fontWeight: 700, color: confirmDialog.estimate.hasEnough !== false ? "#22C55E" : "#EF4444" }}>
                          {confirmDialog.estimate.balance?.toFixed(1) || "0.0"} credits
                        </span>
                      </div>
                    </div>

                    {confirmDialog.estimate.hasEnough === false && (
                      <div style={{ backgroundColor: "rgba(239, 68, 68, 0.08)", border: "1px solid rgba(239, 68, 68, 0.25)", borderRadius: "8px", padding: "12px 14px", fontSize: "13px", color: "#EF4444", marginBottom: "16px", lineHeight: 1.5 }}>
                        You don&apos;t have enough credits for this analysis. Please upgrade your plan to get more credits.
                      </div>
                    )}

                    <div style={{ display: "flex", gap: "10px" }}>
                      <button
                        onClick={dismissConfirmation}
                        style={{
                          flex: 1, padding: "10px", fontSize: "14px", fontWeight: 500,
                          borderRadius: "8px", border: "1px solid #2A2A2A", backgroundColor: "transparent",
                          color: "#A3A3A0", cursor: "pointer", fontFamily: "'DM Sans', system-ui, sans-serif",
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={confirmAndAnalyze}
                        disabled={confirmDialog.estimate.hasEnough === false}
                        style={{
                          flex: 1, padding: "10px", fontSize: "14px", fontWeight: 600,
                          borderRadius: "8px", border: "none",
                          backgroundColor: confirmDialog.estimate.hasEnough !== false ? "#E8651A" : "#555",
                          color: "#FFF", cursor: confirmDialog.estimate.hasEnough !== false ? "pointer" : "not-allowed",
                          fontFamily: "'DM Sans', system-ui, sans-serif",
                          opacity: confirmDialog.estimate.hasEnough !== false ? 1 : 0.5,
                        }}
                      >
                        {confirmDialog.estimate.hasEnough !== false
                          ? `Analyze (${confirmDialog.estimate.estimatedCredits} credits)`
                          : "Insufficient credits"}
                      </button>
                    </div>
                  </>
                )}
              </>
            ) : null}
          </div>
        </div>
      )}

      {/* ===== SIDEBAR ===== */}
      <div style={{ width: "280px", flexShrink: 0, borderRight: "1px solid #2A2A2A", display: "flex", flexDirection: "column", backgroundColor: "#0A0A0A" }}>
        <div style={{ padding: "16px", borderBottom: "1px solid #2A2A2A" }}>
          <button
            onClick={handleNewAnalysis}
            style={{
              width: "100%", padding: "10px", fontSize: "13px", fontWeight: 600,
              borderRadius: "8px", border: "none", backgroundColor: "#E8651A",
              color: "#FFFFFF", cursor: "pointer", fontFamily: "'DM Sans', system-ui, sans-serif",
            }}
          >
            + New Analysis
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "8px" }}>
          {Object.entries(groupedHistory).map(([label, items]) => (
            <div key={label} style={{ marginBottom: "16px" }}>
              <div style={{ fontSize: "11px", fontWeight: 600, color: "#6B6B68", textTransform: "uppercase", padding: "4px 8px", marginBottom: "4px" }}>{label}</div>
              {items.map((t) => (
                <button
                  key={t.id}
                  onClick={() => loadExisting(t.id)}
                  style={{
                    display: "block", width: "100%", textAlign: "left", padding: "8px",
                    borderRadius: "6px", border: "none",
                    backgroundColor: activeAnalysis?.id === t.id ? "#1C1C1C" : "transparent",
                    color: activeAnalysis?.id === t.id ? "#F5F5F3" : "#A3A3A0",
                    cursor: "pointer", fontSize: "13px", fontFamily: "'DM Sans', system-ui, sans-serif",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}
                >
                  {t.thread_title?.slice(0, 40) || "Untitled"}
                </button>
              ))}
            </div>
          ))}
          {history.length === 0 && (
            <p style={{ fontSize: "12px", color: "#6B6B68", textAlign: "center", padding: "20px 8px" }}>
              No analyses yet. Click &quot;+ New Analysis&quot; to get started.
            </p>
          )}
        </div>
      </div>

      {/* ===== MAIN CONTENT ===== */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {/* Loading */}
        {analyzing && (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ width: "32px", height: "32px", border: "3px solid #2A2A2A", borderTopColor: "#E8651A", borderRadius: "50%", animation: "spin 0.6s linear infinite", margin: "0 auto 16px" }} />
              <p style={{ fontSize: "14px", color: "#A3A3A0" }}>Analyzing thread...</p>
            </div>
          </div>
        )}

        {/* New Analysis — URL input */}
        {!analyzing && !activeAnalysis && showNewAnalysis && (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ width: "100%", maxWidth: "520px", textAlign: "center" }}>
              <h2 style={{ fontFamily: "'Satoshi', system-ui, sans-serif", fontSize: "22px", fontWeight: 700, color: "#F5F5F3", marginBottom: "8px" }}>
                Analyze a Reddit Thread
              </h2>
              <p style={{ fontSize: "14px", color: "#A3A3A0", marginBottom: "24px", lineHeight: 1.6 }}>
                Paste a Reddit thread URL to get AI-powered insights — pain points, buying signals, competitive landscape.
              </p>

              <div style={{ backgroundColor: "#141414", border: "1px solid #2A2A2A", borderRadius: "12px", padding: "24px", textAlign: "left" }}>
                <label style={{ display: "block", fontSize: "13px", fontWeight: 500, color: "#A3A3A0", marginBottom: "8px" }}>
                  Reddit Thread URL
                </label>
                <input
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && urlInput && handleNewAnalysisSubmit()}
                  placeholder="https://www.reddit.com/r/..."
                  autoFocus
                  style={{
                    width: "100%", backgroundColor: "#0A0A0A", border: "1px solid #2A2A2A",
                    borderRadius: "8px", padding: "12px 14px", fontSize: "14px", color: "#F5F5F3",
                    outline: "none", fontFamily: "'DM Sans', system-ui, sans-serif", boxSizing: "border-box",
                    marginBottom: "16px",
                  }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = "#E8651A")}
                  onBlur={(e) => (e.currentTarget.style.borderColor = "#2A2A2A")}
                />
                <button
                  onClick={handleNewAnalysisSubmit}
                  disabled={!urlInput}
                  style={{
                    width: "100%", padding: "12px", fontSize: "14px", fontWeight: 600,
                    borderRadius: "8px", border: "none", backgroundColor: "#E8651A",
                    color: "#FFF", cursor: "pointer", opacity: !urlInput ? 0.5 : 1,
                    fontFamily: "'DM Sans', system-ui, sans-serif",
                  }}
                >
                  Analyze Thread
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Empty state */}
        {!analyzing && !activeAnalysis && !showNewAnalysis && (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ textAlign: "center", maxWidth: "400px" }}>
              <h2 style={{ fontFamily: "'Satoshi', system-ui, sans-serif", fontSize: "20px", fontWeight: 700, color: "#F5F5F3", marginBottom: "8px" }}>
                Thread Analysis
              </h2>
              <p style={{ fontSize: "14px", color: "#A3A3A0", lineHeight: 1.6 }}>
                Click &quot;+ New Analysis&quot; in the sidebar or &quot;Analyze Thread&quot; on any dashboard alert to get AI-powered insights.
              </p>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{ margin: "16px", padding: "12px 16px", backgroundColor: "rgba(239, 68, 68, 0.08)", border: "1px solid rgba(239, 68, 68, 0.25)", borderRadius: "8px", fontSize: "13px", color: "#EF4444" }}>
            {error}
          </div>
        )}

        {/* ===== ANALYSIS + CHAT ===== */}
        {!analyzing && activeAnalysis && (
          <>
            <div style={{ flex: 1, overflowY: "auto", padding: "24px" }}>
              {/* Thread header */}
              <div style={{ marginBottom: "24px", paddingBottom: "16px", borderBottom: "1px solid #2A2A2A" }}>
                <h2 style={{ fontFamily: "'Satoshi', system-ui, sans-serif", fontSize: "18px", fontWeight: 700, color: "#F5F5F3", marginBottom: "8px", lineHeight: 1.4 }}>
                  {activeAnalysis.thread_title}
                </h2>
                <div style={{ display: "flex", gap: "12px", fontSize: "12px", color: "#6B6B68" }}>
                  <span>{activeAnalysis.comment_count} comments analyzed</span>
                </div>
                <div style={{ display: "flex", gap: "12px", marginTop: "8px", alignItems: "center" }}>
                  <a href={activeAnalysis.reddit_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: "12px", color: "#E8651A", textDecoration: "none" }}>
                    View full thread on Reddit ↗
                  </a>
                  {alertIdForDraft && !showDrafts && (
                    <button
                      onClick={() => generateDrafts(alertIdForDraft)}
                      style={{
                        padding: "6px 14px", fontSize: "12px", fontWeight: 600, borderRadius: "6px",
                        border: "none", backgroundColor: "#E8651A", color: "#FFF", cursor: "pointer",
                        fontFamily: "'DM Sans', system-ui, sans-serif",
                      }}
                    >
                      Draft Response
                    </button>
                  )}
                </div>
              </div>

              {/* AI Analysis — left-aligned */}
              <div style={{ marginBottom: "24px", maxWidth: "85%" }}>
                <div style={{ fontSize: "11px", fontWeight: 600, color: "#E8651A", marginBottom: "8px", textTransform: "uppercase" }}>Arete AI</div>

                {/* Summary */}
                <div style={{ backgroundColor: "#141414", border: "1px solid #2A2A2A", borderRadius: "12px", borderLeft: "3px solid #E8651A", padding: "16px", marginBottom: "12px" }}>
                  <h3 style={{ fontSize: "13px", fontWeight: 600, color: "#A3A3A0", textTransform: "uppercase", marginBottom: "8px" }}>Summary</h3>
                  <p style={{ fontSize: "14px", color: "#F5F5F3", lineHeight: 1.7 }}>{activeAnalysis.summary}</p>
                </div>

                {/* Pain Points */}
                {activeAnalysis.pain_points?.length > 0 && (
                  <div style={{ backgroundColor: "#141414", border: "1px solid #2A2A2A", borderRadius: "12px", borderLeft: "3px solid #F87171", padding: "16px", marginBottom: "12px" }}>
                    <h3 style={{ fontSize: "13px", fontWeight: 600, color: "#F87171", textTransform: "uppercase", marginBottom: "10px" }}>Pain Points</h3>
                    {activeAnalysis.pain_points.map((p, i) => (
                      <div key={i} style={{ display: "flex", gap: "8px", marginBottom: "8px", fontSize: "14px", color: "#F5F5F3", lineHeight: 1.6 }}>
                        <span style={{ color: "#F87171", flexShrink: 0 }}>•</span>
                        <span>{p}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Key Insights */}
                {activeAnalysis.key_insights?.length > 0 && (
                  <div style={{ backgroundColor: "#141414", border: "1px solid #2A2A2A", borderRadius: "12px", borderLeft: "3px solid #60A5FA", padding: "16px", marginBottom: "12px" }}>
                    <h3 style={{ fontSize: "13px", fontWeight: 600, color: "#60A5FA", textTransform: "uppercase", marginBottom: "10px" }}>Key Insights</h3>
                    {activeAnalysis.key_insights.map((ins, i) => (
                      <div key={i} style={{ display: "flex", gap: "8px", marginBottom: "8px", fontSize: "14px", color: "#F5F5F3", lineHeight: 1.6 }}>
                        <span style={{ color: "#60A5FA", flexShrink: 0 }}>•</span>
                        <span>{ins}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Buying Signals */}
                {activeAnalysis.buying_signals?.length > 0 && (
                  <div style={{ backgroundColor: "#141414", border: "1px solid #2A2A2A", borderRadius: "12px", borderLeft: "3px solid #22C55E", padding: "16px", marginBottom: "12px" }}>
                    <h3 style={{ fontSize: "13px", fontWeight: 600, color: "#22C55E", textTransform: "uppercase", marginBottom: "10px" }}>Buying Intent Signals</h3>
                    {activeAnalysis.buying_signals.map((b, i) => (
                      <div key={i} style={{ display: "flex", gap: "8px", marginBottom: "8px", fontSize: "14px", color: "#F5F5F3", lineHeight: 1.6 }}>
                        <span style={{ color: "#22C55E", flexShrink: 0 }}>•</span>
                        <span><span style={{ color: "#E8651A", fontWeight: 500 }}>{b.user}</span>: {b.signal}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Competitive Landscape */}
                {activeAnalysis.competitive_landscape?.length > 0 && (
                  <div style={{ backgroundColor: "#141414", border: "1px solid #2A2A2A", borderRadius: "12px", borderLeft: "3px solid #FBBF24", padding: "16px", marginBottom: "12px" }}>
                    <h3 style={{ fontSize: "13px", fontWeight: 600, color: "#FBBF24", textTransform: "uppercase", marginBottom: "10px" }}>Competitive Landscape</h3>
                    {activeAnalysis.competitive_landscape.map((c, i) => (
                      <div key={i} style={{ display: "flex", gap: "8px", marginBottom: "10px", fontSize: "14px", color: "#F5F5F3", lineHeight: 1.6 }}>
                        <span style={{ color: "#FBBF24", flexShrink: 0 }}>•</span>
                        <div>
                          <span style={{ fontWeight: 500 }}>{c.competitor}</span>
                          <span style={{ fontSize: "11px", padding: "2px 6px", borderRadius: "4px", marginLeft: "6px", backgroundColor: c.sentiment === "negative" ? "rgba(239,68,68,0.12)" : c.sentiment === "positive" ? "rgba(34,197,94,0.12)" : "rgba(107,107,104,0.12)", color: c.sentiment === "negative" ? "#EF4444" : c.sentiment === "positive" ? "#22C55E" : "#A3A3A0" }}>
                            {c.sentiment}
                          </span>
                          <p style={{ fontSize: "13px", color: "#A3A3A0", marginTop: "2px" }}>{c.context}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Chat messages — user right, AI left */}
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  style={{
                    display: "flex",
                    justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
                    marginBottom: "16px",
                  }}
                >
                  <div
                    style={{
                      maxWidth: "75%",
                      padding: "12px 16px",
                      borderRadius: msg.role === "user" ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
                      backgroundColor: msg.role === "user" ? "#E8651A" : "#141414",
                      border: msg.role === "user" ? "none" : "1px solid #2A2A2A",
                      borderLeft: msg.role === "assistant" ? "3px solid #E8651A" : "none",
                    }}
                  >
                    {msg.role === "assistant" && (
                      <div style={{ fontSize: "11px", fontWeight: 600, color: "#E8651A", marginBottom: "6px", textTransform: "uppercase" }}>
                        Arete AI
                      </div>
                    )}
                    <div style={{ fontSize: "14px", color: msg.role === "user" ? "#FFFFFF" : "#F5F5F3", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
                      {msg.content}
                    </div>
                  </div>
                </div>
              ))}

              {/* Chat loading */}
              {chatLoading && (
                <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: "16px" }}>
                  <div style={{ maxWidth: "75%", padding: "12px 16px", borderRadius: "12px 12px 12px 2px", backgroundColor: "#141414", border: "1px solid #2A2A2A", borderLeft: "3px solid #E8651A" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <div style={{ width: "14px", height: "14px", border: "2px solid #2A2A2A", borderTopColor: "#E8651A", borderRadius: "50%", animation: "spin 0.6s linear infinite" }} />
                      <span style={{ fontSize: "13px", color: "#A3A3A0" }}>Thinking...</span>
                    </div>
                  </div>
                </div>
              )}

              <div ref={chatEndRef} />
            </div>

            {/* ===== CHAT INPUT + SUGGESTED QUESTIONS BELOW ===== */}
            <div style={{ borderTop: "1px solid #2A2A2A", backgroundColor: "#0A0A0A" }}>
              <div style={{ padding: "12px 24px 8px" }}>
                <div style={{ fontSize: "11px", color: "#555", marginBottom: "6px", textAlign: "right" }}>
                  ~1-2 credits per message
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <input
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendChat()}
                    placeholder="Ask a follow-up question about this thread..."
                    disabled={chatLoading}
                    style={{
                      flex: 1, backgroundColor: "#141414", border: "1px solid #2A2A2A",
                      borderRadius: "8px", padding: "10px 14px", fontSize: "14px", color: "#F5F5F3",
                      outline: "none", fontFamily: "'DM Sans', system-ui, sans-serif",
                    }}
                  />
                  <button
                    onClick={() => sendChat()}
                    disabled={!chatInput.trim() || chatLoading}
                    style={{
                      padding: "10px 20px", fontSize: "14px", fontWeight: 600, borderRadius: "8px",
                      border: "none", backgroundColor: "#E8651A", color: "#FFF", cursor: "pointer",
                      opacity: !chatInput.trim() || chatLoading ? 0.5 : 1,
                      fontFamily: "'DM Sans', system-ui, sans-serif",
                    }}
                  >
                    Send
                  </button>
                </div>
              </div>

              {/* Suggested questions — BELOW the chat input */}
              {messages.length === 0 && !showDrafts && (
                <div style={{ padding: "4px 24px 14px", display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {SUGGESTED_QUESTIONS.map((q) => (
                    <button
                      key={q}
                      onClick={() => sendChat(q)}
                      disabled={chatLoading}
                      style={{
                        padding: "6px 12px", fontSize: "12px", borderRadius: "16px",
                        border: "1px solid rgba(232, 101, 26, 0.35)", backgroundColor: "rgba(232, 101, 26, 0.08)",
                        color: "#E8651A", cursor: "pointer", fontFamily: "'DM Sans', system-ui, sans-serif",
                        transition: "all 150ms",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(232, 101, 26, 0.18)"; e.currentTarget.style.borderColor = "rgba(232, 101, 26, 0.5)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "rgba(232, 101, 26, 0.08)"; e.currentTarget.style.borderColor = "rgba(232, 101, 26, 0.35)"; }}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* ===== DRAFT PANEL (slides up from bottom) ===== */}
            {showDrafts && (
              <div style={{
                borderTop: "1px solid #2A2A2A",
                backgroundColor: "#111",
                maxHeight: "60vh",
                overflowY: "auto",
                padding: "20px 24px",
              }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
                  <h3 style={{ fontFamily: "'Satoshi', system-ui, sans-serif", fontSize: "16px", fontWeight: 700, color: "#F5F5F3" }}>
                    Draft Responses
                  </h3>
                  <button
                    onClick={() => setShowDrafts(false)}
                    style={{ background: "none", border: "none", color: "#6B6B68", cursor: "pointer", fontSize: "18px" }}
                  >
                    ✕
                  </button>
                </div>

                {/* Subreddit rules */}
                {draftRules && (
                  <div style={{ backgroundColor: "rgba(245, 158, 11, 0.06)", border: "1px solid rgba(245, 158, 11, 0.2)", borderRadius: "8px", padding: "12px 14px", marginBottom: "16px" }}>
                    <div style={{ fontSize: "12px", fontWeight: 600, color: "#F59E0B", marginBottom: "6px" }}>Subreddit Rules</div>
                    <div style={{ fontSize: "12px", color: "#C0C0BD", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                      {draftRules.slice(0, 500)}
                    </div>
                  </div>
                )}

                {/* Loading */}
                {draftLoading && (
                  <div style={{ textAlign: "center", padding: "30px" }}>
                    <div style={{ width: "24px", height: "24px", border: "2px solid #2A2A2A", borderTopColor: "#E8651A", borderRadius: "50%", animation: "spin 0.6s linear infinite", margin: "0 auto 12px" }} />
                    <p style={{ fontSize: "13px", color: "#A3A3A0" }}>Generating drafts...</p>
                  </div>
                )}

                {/* Drafts */}
                {!draftLoading && drafts.map((draft) => (
                  <div
                    key={draft.id}
                    style={{
                      backgroundColor: "#1A1A1A",
                      border: "1px solid #2A2A2A",
                      borderRadius: "10px",
                      padding: "16px",
                      marginBottom: "12px",
                    }}
                  >
                    <div style={{ fontSize: "12px", fontWeight: 600, color: "#E8651A", marginBottom: "10px", textTransform: "uppercase" }}>
                      {draft.tone}
                    </div>

                    {editingDraftId === draft.id ? (
                      <>
                        <textarea
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          style={{
                            width: "100%", minHeight: "120px", backgroundColor: "#0A0A0A",
                            border: "1px solid #E8651A", borderRadius: "8px", padding: "12px",
                            fontSize: "14px", color: "#F5F5F3", outline: "none", resize: "vertical",
                            fontFamily: "'DM Sans', system-ui, sans-serif", lineHeight: 1.7,
                            boxSizing: "border-box",
                          }}
                        />
                        <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
                          <button
                            onClick={() => saveEdit(draft.id)}
                            style={{ padding: "6px 14px", fontSize: "12px", fontWeight: 600, borderRadius: "6px", border: "none", backgroundColor: "#E8651A", color: "#FFF", cursor: "pointer", fontFamily: "'DM Sans', system-ui, sans-serif" }}
                          >
                            Save
                          </button>
                          <button
                            onClick={() => { setEditingDraftId(null); setEditText(""); }}
                            style={{ padding: "6px 14px", fontSize: "12px", borderRadius: "6px", border: "1px solid #2A2A2A", backgroundColor: "transparent", color: "#A3A3A0", cursor: "pointer", fontFamily: "'DM Sans', system-ui, sans-serif" }}
                          >
                            Cancel
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <p style={{ fontSize: "14px", color: "#F5F5F3", lineHeight: 1.7, whiteSpace: "pre-wrap", marginBottom: "12px" }}>
                          {draft.draft_text}
                        </p>

                        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                          <button
                            onClick={() => copyDraft(draft.id, draft.draft_text)}
                            style={{
                              padding: "6px 14px", fontSize: "12px", fontWeight: 500, borderRadius: "6px",
                              border: "1px solid #2A2A2A", backgroundColor: copiedId === draft.id ? "rgba(34, 197, 94, 0.12)" : "transparent",
                              color: copiedId === draft.id ? "#22C55E" : "#A3A3A0", cursor: "pointer",
                              fontFamily: "'DM Sans', system-ui, sans-serif", transition: "all 150ms",
                            }}
                          >
                            {copiedId === draft.id ? "Copied!" : "Copy"}
                          </button>
                          <button
                            onClick={() => startEditing(draft)}
                            style={{ padding: "6px 14px", fontSize: "12px", fontWeight: 500, borderRadius: "6px", border: "1px solid #2A2A2A", backgroundColor: "transparent", color: "#A3A3A0", cursor: "pointer", fontFamily: "'DM Sans', system-ui, sans-serif" }}
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => regenerateDraft(draft.id)}
                            disabled={regeneratingId === draft.id}
                            style={{
                              padding: "6px 14px", fontSize: "12px", fontWeight: 500, borderRadius: "6px",
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

                {/* No drafts yet — show generate button */}
                {!draftLoading && drafts.length === 0 && alertIdForDraft && (
                  <div style={{ textAlign: "center", padding: "20px" }}>
                    <p style={{ fontSize: "14px", color: "#A3A3A0", marginBottom: "12px" }}>No drafts generated yet.</p>
                    <button
                      onClick={() => generateDrafts(alertIdForDraft)}
                      style={{ padding: "10px 24px", fontSize: "14px", fontWeight: 600, borderRadius: "8px", border: "none", backgroundColor: "#E8651A", color: "#FFF", cursor: "pointer", fontFamily: "'DM Sans', system-ui, sans-serif" }}
                    >
                      Generate Drafts
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
