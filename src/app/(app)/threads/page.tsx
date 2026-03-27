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


  // Confirmation dialog state
  const [confirmDialog, setConfirmDialog] = useState<{
    show: boolean;
    url: string;
    loading: boolean;
    estimate: CreditEstimate | null;
  }>({ show: false, url: "", loading: false, estimate: null });

  useEffect(() => { fetchHistory(); }, []);

  // Auto-analyze from dashboard
  useEffect(() => {
    const url = searchParams.get("url");
    if (url && !autoAnalyzedRef.current) {
      autoAnalyzedRef.current = true;
      showConfirmation(url);
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

  /** Show confirmation dialog with dynamic credit estimate */
  async function showConfirmation(url: string) {
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
          setError("__402__");
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
        setError("__402__");
      }
    } catch {
      setError("Failed to send message");
    } finally {
      setChatLoading(false);
    }
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
        {error && error === "__402__" ? (
          <div style={{ margin: "16px", padding: "24px", backgroundColor: "#141414", border: "1px solid rgba(232, 101, 26, 0.3)", borderRadius: "12px", textAlign: "center" }}>
            <div style={{ fontSize: "18px", fontWeight: 700, color: "#F5F5F3", marginBottom: "8px" }}>You&apos;ve run out of credits</div>
            <p style={{ fontSize: "14px", color: "#A3A3A0", marginBottom: "20px" }}>Upgrade to Growth for 250 credits/month — $39/mo</p>
            <a href="/settings" style={{ display: "inline-block", padding: "10px 24px", fontSize: "14px", fontWeight: 600, borderRadius: "8px", backgroundColor: "#E8651A", color: "#FFF", textDecoration: "none" }}>
              Upgrade Plan
            </a>
          </div>
        ) : error ? (
          <div style={{ margin: "16px", padding: "12px 16px", backgroundColor: "rgba(239, 68, 68, 0.08)", border: "1px solid rgba(239, 68, 68, 0.25)", borderRadius: "8px", fontSize: "13px", color: "#EF4444" }}>
            {error}
          </div>
        ) : null}

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
                <a href={activeAnalysis.reddit_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: "12px", color: "#E8651A", textDecoration: "none", marginTop: "4px", display: "inline-block" }}>
                  View full thread on Reddit ↗
                </a>
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
              {messages.length === 0 && (
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

          </>
        )}
      </div>
    </div>
  );
}
