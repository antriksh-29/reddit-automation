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
  sentiment: string;
  comment_count: number;
  created_at: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

const SUGGESTED_QUESTIONS = [
  "What opportunities exist for us in this thread?",
  "Which commenters are potential customers?",
  "What specific features are users asking for?",
  "How should we position against the competitors mentioned?",
];

const spinCSS = `@keyframes spin { to { transform: rotate(360deg); } }`;

export default function ThreadsPage() {
  const [history, setHistory] = useState<ThreadSummary[]>([]);
  const [activeAnalysis, setActiveAnalysis] = useState<ThreadAnalysis | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const searchParams = useSearchParams();
  const autoAnalyzedRef = useRef(false);

  useEffect(() => {
    fetchHistory();
  }, []);

  // Auto-analyze if URL param is passed (from dashboard)
  useEffect(() => {
    const url = searchParams.get("url");
    if (url && !autoAnalyzedRef.current) {
      autoAnalyzedRef.current = true;
      analyzeThread(url);
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

  async function analyzeThread(url: string, alertId?: string) {
    setAnalyzing(true);
    setError(null);
    setMessages([]);
    setActiveAnalysis(null);

    try {
      const res = await fetch("/api/threads/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reddit_url: url, alert_id: alertId }),
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
      fetchHistory(); // Refresh sidebar
    } catch {
      setError("Failed to analyze thread. Please try again.");
    } finally {
      setAnalyzing(false);
    }
  }

  async function loadExisting(threadId: string) {
    setAnalyzing(true);
    setError(null);

    try {
      // Find the thread in history to get the URL
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

    // Optimistically add user message
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
          content: data.response,
          created_at: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, assistantMsg]);
      } else if (res.status === 402) {
        setError(`Insufficient credits. Balance: ${data.balance}`);
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

  const groupedHistory = groupByDate(history);

  return (
    <div style={{ display: "flex", height: "calc(100vh - 80px)", gap: 0 }}>
      <style dangerouslySetInnerHTML={{ __html: spinCSS }} />

      {/* Sidebar */}
      <div
        style={{
          width: "280px",
          flexShrink: 0,
          borderRight: "1px solid #2A2A2A",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "#0A0A0A",
        }}
      >
        {/* New analysis + URL input */}
        <div style={{ padding: "16px", borderBottom: "1px solid #2A2A2A" }}>
          <button
            onClick={() => { setActiveAnalysis(null); setMessages([]); setError(null); }}
            style={{
              width: "100%",
              padding: "10px",
              fontSize: "13px",
              fontWeight: 600,
              borderRadius: "8px",
              border: "1px solid #2A2A2A",
              backgroundColor: "#141414",
              color: "#F5F5F3",
              cursor: "pointer",
              fontFamily: "'DM Sans', system-ui, sans-serif",
              marginBottom: "12px",
            }}
          >
            + New Analysis
          </button>

          <div style={{ position: "relative" }}>
            <input
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && urlInput && !analyzing && analyzeThread(urlInput)}
              placeholder="Paste Reddit URL..."
              disabled={analyzing}
              style={{
                width: "100%",
                backgroundColor: "#141414",
                border: "1px solid #2A2A2A",
                borderRadius: "8px",
                padding: "8px 12px",
                fontSize: "12px",
                color: "#F5F5F3",
                outline: "none",
                fontFamily: "'DM Sans', system-ui, sans-serif",
                boxSizing: "border-box",
              }}
            />
          </div>
          {urlInput && (
            <button
              onClick={() => analyzeThread(urlInput)}
              disabled={analyzing}
              style={{
                width: "100%",
                marginTop: "8px",
                padding: "8px",
                fontSize: "12px",
                fontWeight: 600,
                borderRadius: "6px",
                border: "none",
                backgroundColor: "#E8651A",
                color: "#FFF",
                cursor: "pointer",
                opacity: analyzing ? 0.5 : 1,
                fontFamily: "'DM Sans', system-ui, sans-serif",
              }}
            >
              {analyzing ? "Analyzing..." : "Analyze"}
            </button>
          )}
        </div>

        {/* History */}
        <div style={{ flex: 1, overflowY: "auto", padding: "8px" }}>
          {Object.entries(groupedHistory).map(([label, items]) => (
            <div key={label} style={{ marginBottom: "16px" }}>
              <div style={{ fontSize: "11px", fontWeight: 600, color: "#6B6B68", textTransform: "uppercase", padding: "4px 8px", marginBottom: "4px" }}>
                {label}
              </div>
              {items.map((t) => (
                <button
                  key={t.id}
                  onClick={() => loadExisting(t.id)}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "8px",
                    borderRadius: "6px",
                    border: "none",
                    backgroundColor: activeAnalysis?.id === t.id ? "#1C1C1C" : "transparent",
                    color: activeAnalysis?.id === t.id ? "#F5F5F3" : "#A3A3A0",
                    cursor: "pointer",
                    fontSize: "13px",
                    fontFamily: "'DM Sans', system-ui, sans-serif",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {t.thread_title?.slice(0, 40) || "Untitled"}
                </button>
              ))}
            </div>
          ))}

          {history.length === 0 && (
            <p style={{ fontSize: "12px", color: "#6B6B68", textAlign: "center", padding: "20px 8px" }}>
              No analyses yet. Paste a Reddit URL or click "Analyze Thread" on any alert.
            </p>
          )}
        </div>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Loading state */}
        {analyzing && (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ width: "32px", height: "32px", border: "3px solid #2A2A2A", borderTopColor: "#E8651A", borderRadius: "50%", animation: "spin 0.6s linear infinite", margin: "0 auto 16px" }} />
              <p style={{ fontSize: "14px", color: "#A3A3A0" }}>Analyzing thread...</p>
            </div>
          </div>
        )}

        {/* Empty state */}
        {!analyzing && !activeAnalysis && (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ textAlign: "center", maxWidth: "400px" }}>
              <h2 style={{ fontFamily: "'Satoshi', system-ui, sans-serif", fontSize: "20px", fontWeight: 700, color: "#F5F5F3", marginBottom: "8px" }}>
                Thread Analysis
              </h2>
              <p style={{ fontSize: "14px", color: "#A3A3A0", lineHeight: 1.6 }}>
                Paste a Reddit URL in the sidebar or click &quot;Analyze Thread&quot; on any dashboard alert to get AI-powered insights.
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

        {/* Analysis + Chat */}
        {!analyzing && activeAnalysis && (
          <>
            {/* Scrollable content */}
            <div style={{ flex: 1, overflowY: "auto", padding: "24px" }}>
              {/* Thread header */}
              <div style={{ marginBottom: "24px", paddingBottom: "16px", borderBottom: "1px solid #2A2A2A" }}>
                <h2 style={{ fontFamily: "'Satoshi', system-ui, sans-serif", fontSize: "18px", fontWeight: 700, color: "#F5F5F3", marginBottom: "8px", lineHeight: 1.4 }}>
                  {activeAnalysis.thread_title}
                </h2>
                <div style={{ display: "flex", gap: "12px", fontSize: "12px", color: "#6B6B68" }}>
                  <span>{activeAnalysis.comment_count} comments analyzed</span>
                  <span>·</span>
                  <span>Sentiment: {activeAnalysis.sentiment}</span>
                </div>
                <a href={activeAnalysis.reddit_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: "12px", color: "#E8651A", textDecoration: "none", marginTop: "4px", display: "inline-block" }}>
                  View full thread on Reddit ↗
                </a>
              </div>

              {/* AI Analysis sections */}
              <div style={{ display: "flex", flexDirection: "column", gap: "20px", marginBottom: "24px" }}>
                {/* Summary */}
                <div style={{ backgroundColor: "#141414", border: "1px solid #2A2A2A", borderRadius: "8px", padding: "16px" }}>
                  <h3 style={{ fontSize: "13px", fontWeight: 600, color: "#A3A3A0", textTransform: "uppercase", marginBottom: "8px" }}>Summary</h3>
                  <p style={{ fontSize: "14px", color: "#F5F5F3", lineHeight: 1.6 }}>{activeAnalysis.summary}</p>
                </div>

                {/* Pain Points */}
                {activeAnalysis.pain_points?.length > 0 && (
                  <div style={{ backgroundColor: "#141414", border: "1px solid #2A2A2A", borderRadius: "8px", padding: "16px" }}>
                    <h3 style={{ fontSize: "13px", fontWeight: 600, color: "#F87171", textTransform: "uppercase", marginBottom: "8px" }}>Pain Points</h3>
                    <ul style={{ margin: 0, paddingLeft: "20px", display: "flex", flexDirection: "column", gap: "6px" }}>
                      {activeAnalysis.pain_points.map((p, i) => (
                        <li key={i} style={{ fontSize: "14px", color: "#F5F5F3", lineHeight: 1.5 }}>{p}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Key Insights */}
                {activeAnalysis.key_insights?.length > 0 && (
                  <div style={{ backgroundColor: "#141414", border: "1px solid #2A2A2A", borderRadius: "8px", padding: "16px" }}>
                    <h3 style={{ fontSize: "13px", fontWeight: 600, color: "#60A5FA", textTransform: "uppercase", marginBottom: "8px" }}>Key Insights</h3>
                    <ul style={{ margin: 0, paddingLeft: "20px", display: "flex", flexDirection: "column", gap: "6px" }}>
                      {activeAnalysis.key_insights.map((ins, i) => (
                        <li key={i} style={{ fontSize: "14px", color: "#F5F5F3", lineHeight: 1.5 }}>{ins}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Buying Signals */}
                {activeAnalysis.buying_signals?.length > 0 && (
                  <div style={{ backgroundColor: "#141414", border: "1px solid #2A2A2A", borderRadius: "8px", padding: "16px" }}>
                    <h3 style={{ fontSize: "13px", fontWeight: 600, color: "#22C55E", textTransform: "uppercase", marginBottom: "8px" }}>Buying Intent Signals</h3>
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      {activeAnalysis.buying_signals.map((b, i) => (
                        <div key={i} style={{ fontSize: "14px", color: "#F5F5F3", lineHeight: 1.5 }}>
                          <span style={{ color: "#E8651A", fontWeight: 500 }}>{b.user}</span>: {b.signal}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Competitive Landscape */}
                {activeAnalysis.competitive_landscape?.length > 0 && (
                  <div style={{ backgroundColor: "#141414", border: "1px solid #2A2A2A", borderRadius: "8px", padding: "16px" }}>
                    <h3 style={{ fontSize: "13px", fontWeight: 600, color: "#FBBF24", textTransform: "uppercase", marginBottom: "8px" }}>Competitive Landscape</h3>
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      {activeAnalysis.competitive_landscape.map((c, i) => (
                        <div key={i} style={{ fontSize: "14px", color: "#F5F5F3", lineHeight: 1.5 }}>
                          <span style={{ fontWeight: 500 }}>{c.competitor}</span>
                          <span style={{ fontSize: "11px", padding: "2px 6px", borderRadius: "4px", marginLeft: "6px", backgroundColor: c.sentiment === "negative" ? "rgba(239,68,68,0.12)" : c.sentiment === "positive" ? "rgba(34,197,94,0.12)" : "rgba(107,107,104,0.12)", color: c.sentiment === "negative" ? "#EF4444" : c.sentiment === "positive" ? "#22C55E" : "#A3A3A0" }}>
                            {c.sentiment}
                          </span>
                          <p style={{ fontSize: "13px", color: "#A3A3A0", marginTop: "2px" }}>{c.context}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Suggested questions */}
              {messages.length === 0 && (
                <div style={{ marginBottom: "20px" }}>
                  <p style={{ fontSize: "12px", color: "#6B6B68", marginBottom: "8px" }}>Suggested follow-ups:</p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                    {SUGGESTED_QUESTIONS.map((q) => (
                      <button
                        key={q}
                        onClick={() => sendChat(q)}
                        disabled={chatLoading}
                        style={{
                          padding: "8px 12px",
                          fontSize: "12px",
                          borderRadius: "6px",
                          border: "1px solid #2A2A2A",
                          backgroundColor: "#141414",
                          color: "#A3A3A0",
                          cursor: "pointer",
                          fontFamily: "'DM Sans', system-ui, sans-serif",
                        }}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Chat messages */}
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  style={{
                    marginBottom: "16px",
                    padding: "12px 16px",
                    borderRadius: "8px",
                    backgroundColor: msg.role === "user" ? "#1C1C1C" : "#141414",
                    borderLeft: msg.role === "assistant" ? "3px solid #E8651A" : "none",
                  }}
                >
                  <div style={{ fontSize: "11px", fontWeight: 600, color: msg.role === "user" ? "#A3A3A0" : "#E8651A", marginBottom: "6px", textTransform: "uppercase" }}>
                    {msg.role === "user" ? "You" : "Arete AI"}
                  </div>
                  <div style={{ fontSize: "14px", color: "#F5F5F3", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                    {msg.content}
                  </div>
                </div>
              ))}

              {/* Chat loading */}
              {chatLoading && (
                <div style={{ marginBottom: "16px", padding: "12px 16px", borderRadius: "8px", backgroundColor: "#141414", borderLeft: "3px solid #E8651A" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <div style={{ width: "14px", height: "14px", border: "2px solid #2A2A2A", borderTopColor: "#E8651A", borderRadius: "50%", animation: "spin 0.6s linear infinite" }} />
                    <span style={{ fontSize: "13px", color: "#A3A3A0" }}>Thinking...</span>
                  </div>
                </div>
              )}

              <div ref={chatEndRef} />
            </div>

            {/* Chat input */}
            <div style={{ padding: "16px 24px", borderTop: "1px solid #2A2A2A", backgroundColor: "#0A0A0A" }}>
              <div style={{ display: "flex", gap: "8px" }}>
                <input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendChat()}
                  placeholder="Ask a follow-up question about this thread..."
                  disabled={chatLoading}
                  style={{
                    flex: 1,
                    backgroundColor: "#141414",
                    border: "1px solid #2A2A2A",
                    borderRadius: "8px",
                    padding: "10px 14px",
                    fontSize: "14px",
                    color: "#F5F5F3",
                    outline: "none",
                    fontFamily: "'DM Sans', system-ui, sans-serif",
                  }}
                />
                <button
                  onClick={() => sendChat()}
                  disabled={!chatInput.trim() || chatLoading}
                  style={{
                    padding: "10px 20px",
                    fontSize: "14px",
                    fontWeight: 600,
                    borderRadius: "8px",
                    border: "none",
                    backgroundColor: "#E8651A",
                    color: "#FFF",
                    cursor: "pointer",
                    opacity: !chatInput.trim() || chatLoading ? 0.5 : 1,
                    fontFamily: "'DM Sans', system-ui, sans-serif",
                  }}
                >
                  Send
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
