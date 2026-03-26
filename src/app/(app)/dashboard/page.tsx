"use client";

import { useState, useEffect, useRef, useCallback } from "react";

/**
 * Dashboard — alert feed with filters, sort, new/seen split.
 * Ref: PRODUCT-SPEC.md §5.2, DESIGN-SYSTEM.md
 */

interface Alert {
  id: string;
  post_title: string;
  post_body: string | null;
  post_author: string | null;
  post_url: string;
  post_created_at: string;
  upvotes: number;
  num_comments: number;
  priority_score: number;
  priority_level: string;
  category: string;
  is_seen: boolean;
  subreddit_name: string;
}

const CATEGORY_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  pain_point: { bg: "rgba(248, 113, 113, 0.12)", text: "#F87171", label: "Pain Point" },
  solution_request: { bg: "rgba(96, 165, 250, 0.12)", text: "#60A5FA", label: "Solution Request" },
  competitor_dissatisfaction: { bg: "rgba(251, 191, 36, 0.12)", text: "#FBBF24", label: "Competitor" },
  experience_sharing: { bg: "rgba(167, 139, 250, 0.12)", text: "#A78BFA", label: "Experience" },
  industry_discussion: { bg: "rgba(45, 212, 191, 0.12)", text: "#2DD4BF", label: "Industry" },
};

const PRIORITY_COLORS: Record<string, string> = {
  high: "#EF4444",
  medium: "#F59E0B",
  low: "#6B6B68",
};

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const mins = Math.floor((now - then) / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function DashboardPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [subreddits, setSubreddits] = useState<string[]>([]);

  // Filters
  const [view, setView] = useState("all");
  const [priority, setPriority] = useState("all");
  const [category, setCategory] = useState("all");
  const [subreddit, setSubreddit] = useState("all");
  const [sort, setSort] = useState("priority");

  // Dropdown states
  const [showFilter, setShowFilter] = useState(false);
  const [showSort, setShowSort] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  const sortRef = useRef<HTMLDivElement>(null);

  // Show more low-priority
  const [showAllLow, setShowAllLow] = useState(false);

  // Intersection observer for marking seen
  const observerRef = useRef<IntersectionObserver | null>(null);
  const seenQueueRef = useRef<Set<string>>(new Set());

  const fetchAlerts = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (view !== "all") params.set("view", view);
    if (priority !== "all") params.set("priority", priority);
    if (category !== "all") params.set("category", category);
    if (subreddit !== "all") params.set("subreddit", subreddit);
    params.set("sort", sort);
    params.set("limit", "100");

    const res = await fetch(`/api/alerts?${params}`);
    if (res.ok) {
      const data = await res.json();
      setAlerts(data.alerts);
    }
    setLoading(false);
  }, [view, priority, category, subreddit, sort]);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  useEffect(() => {
    fetch("/api/subreddits")
      .then((r) => r.json())
      .then((d) => setSubreddits((d.subreddits || []).map((s: { subreddit_name: string }) => s.subreddit_name)));
  }, []);

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) setShowFilter(false);
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) setShowSort(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Mark alerts as seen via intersection observer
  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const id = entry.target.getAttribute("data-alert-id");
            if (id) seenQueueRef.current.add(id);
          }
        });
      },
      { threshold: 0.5 }
    );
    return () => observerRef.current?.disconnect();
  }, []);

  // Flush seen queue periodically
  useEffect(() => {
    const interval = setInterval(async () => {
      if (seenQueueRef.current.size === 0) return;
      const ids = Array.from(seenQueueRef.current);
      seenQueueRef.current.clear();

      await fetch("/api/alerts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alert_ids: ids }),
      });
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const newAlerts = alerts.filter((a) => !a.is_seen);
  const seenAlerts = alerts.filter((a) => a.is_seen);

  const mediumHighNew = newAlerts.filter((a) => a.priority_level === "high" || a.priority_level === "medium");
  const lowNew = newAlerts.filter((a) => a.priority_level === "low");

  const activeFilters = [view, priority, category, subreddit].filter((f) => f !== "all").length;

  const dropdownStyle: React.CSSProperties = {
    position: "absolute",
    top: "100%",
    left: 0,
    marginTop: "4px",
    backgroundColor: "#1C1C1C",
    border: "1px solid #2A2A2A",
    borderRadius: "8px",
    padding: "8px",
    zIndex: 100,
    minWidth: "200px",
    boxShadow: "0 8px 30px rgba(0,0,0,0.5)",
  };

  const filterOptionStyle = (active: boolean): React.CSSProperties => ({
    display: "block",
    width: "100%",
    textAlign: "left" as const,
    padding: "8px 12px",
    borderRadius: "6px",
    fontSize: "13px",
    color: active ? "#F5F5F3" : "#A3A3A0",
    backgroundColor: active ? "#242424" : "transparent",
    border: "none",
    cursor: "pointer",
    fontFamily: "'DM Sans', system-ui, sans-serif",
  });

  function renderAlertCard(alert: Alert) {
    const cat = CATEGORY_COLORS[alert.category] || CATEGORY_COLORS.industry_discussion;
    const priorityColor = PRIORITY_COLORS[alert.priority_level] || "#6B6B68";

    return (
      <div
        key={alert.id}
        data-alert-id={alert.id}
        ref={(el) => {
          if (el && !alert.is_seen && observerRef.current) {
            observerRef.current.observe(el);
          }
        }}
        style={{
          padding: "16px",
          backgroundColor: "#141414",
          border: "1px solid #2A2A2A",
          borderRadius: "8px",
          opacity: alert.is_seen ? 0.6 : 1,
        }}
      >
        {/* Header row */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px", flexWrap: "wrap" }}>
          <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: priorityColor, flexShrink: 0 }} />
          <span style={{ fontSize: "12px", fontWeight: 600, color: priorityColor, textTransform: "uppercase" }}>
            {alert.priority_level}
          </span>
          <span style={{ fontSize: "12px", color: "#6B6B68" }}>·</span>
          <span style={{ fontSize: "12px", color: "#A3A3A0" }}>r/{alert.subreddit_name}</span>
          <span style={{ fontSize: "12px", color: "#6B6B68" }}>·</span>
          <span style={{ fontSize: "12px", color: "#6B6B68" }}>{timeAgo(alert.post_created_at)}</span>
        </div>

        {/* Title */}
        <h3 style={{ fontSize: "15px", fontWeight: 500, color: "#F5F5F3", marginBottom: "8px", lineHeight: 1.4 }}>
          {alert.post_title}
        </h3>

        {/* Category + stats */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
          <span style={{ fontSize: "11px", fontWeight: 600, padding: "3px 8px", borderRadius: "4px", backgroundColor: cat.bg, color: cat.text }}>
            {cat.label}
          </span>
          <span style={{ fontSize: "12px", color: "#6B6B68" }}>{alert.upvotes}↑</span>
          <span style={{ fontSize: "12px", color: "#6B6B68" }}>{alert.num_comments} comments</span>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
          <button style={{ padding: "6px 12px", fontSize: "12px", fontWeight: 500, borderRadius: "6px", border: "1px solid #2A2A2A", backgroundColor: "transparent", color: "#A3A3A0", cursor: "pointer", fontFamily: "'DM Sans', system-ui, sans-serif" }}>
            Analyze Thread
          </button>
          <button style={{ padding: "6px 12px", fontSize: "12px", fontWeight: 500, borderRadius: "6px", border: "1px solid #2A2A2A", backgroundColor: "transparent", color: "#A3A3A0", cursor: "pointer", fontFamily: "'DM Sans', system-ui, sans-serif" }}>
            Draft Response
          </button>
          <a
            href={alert.post_url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ padding: "6px 12px", fontSize: "12px", fontWeight: 500, borderRadius: "6px", border: "1px solid #2A2A2A", color: "#A3A3A0", textDecoration: "none", fontFamily: "'DM Sans', system-ui, sans-serif" }}
          >
            View on Reddit ↗
          </a>
        </div>
      </div>
    );
  }

  return (
    <div>
      <style
        dangerouslySetInnerHTML={{
          __html: `@keyframes spin { to { transform: rotate(360deg); } }`,
        }}
      />

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "24px" }}>
        <h1 style={{ fontFamily: "'Satoshi', system-ui, sans-serif", fontSize: "24px", fontWeight: 700, color: "#F5F5F3" }}>
          Dashboard
        </h1>

        <div style={{ display: "flex", gap: "8px" }}>
          {/* Filter dropdown */}
          <div ref={filterRef} style={{ position: "relative" }}>
            <button
              onClick={() => { setShowFilter(!showFilter); setShowSort(false); }}
              style={{
                padding: "8px 14px",
                fontSize: "13px",
                fontWeight: 500,
                borderRadius: "6px",
                border: "1px solid #2A2A2A",
                backgroundColor: activeFilters > 0 ? "rgba(232, 101, 26, 0.1)" : "transparent",
                color: activeFilters > 0 ? "#E8651A" : "#A3A3A0",
                cursor: "pointer",
                fontFamily: "'DM Sans', system-ui, sans-serif",
              }}
            >
              Filter by {activeFilters > 0 ? `(${activeFilters})` : ""}
            </button>

            {showFilter && (
              <div style={{ ...dropdownStyle, display: "flex", gap: "16px", minWidth: "500px" }}>
                {/* View */}
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "11px", fontWeight: 600, color: "#6B6B68", textTransform: "uppercase", padding: "4px 12px", marginBottom: "4px" }}>View</div>
                  {["all", "new", "seen"].map((v) => (
                    <button key={v} onClick={() => setView(v)} style={filterOptionStyle(view === v)}>{v === "all" ? "All" : v === "new" ? "New" : "Seen"}</button>
                  ))}
                </div>
                {/* Priority */}
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "11px", fontWeight: 600, color: "#6B6B68", textTransform: "uppercase", padding: "4px 12px", marginBottom: "4px" }}>Priority</div>
                  {["all", "high", "medium", "low"].map((v) => (
                    <button key={v} onClick={() => setPriority(v)} style={filterOptionStyle(priority === v)}>{v === "all" ? "All" : v.charAt(0).toUpperCase() + v.slice(1)}</button>
                  ))}
                </div>
                {/* Category */}
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "11px", fontWeight: 600, color: "#6B6B68", textTransform: "uppercase", padding: "4px 12px", marginBottom: "4px" }}>Category</div>
                  <button onClick={() => setCategory("all")} style={filterOptionStyle(category === "all")}>All</button>
                  {Object.entries(CATEGORY_COLORS).map(([key, val]) => (
                    <button key={key} onClick={() => setCategory(key)} style={filterOptionStyle(category === key)}>{val.label}</button>
                  ))}
                </div>
                {/* Subreddit */}
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "11px", fontWeight: 600, color: "#6B6B68", textTransform: "uppercase", padding: "4px 12px", marginBottom: "4px" }}>Subreddit</div>
                  <button onClick={() => setSubreddit("all")} style={filterOptionStyle(subreddit === "all")}>All</button>
                  {subreddits.map((s) => (
                    <button key={s} onClick={() => setSubreddit(s)} style={filterOptionStyle(subreddit === s)}>r/{s}</button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Sort dropdown */}
          <div ref={sortRef} style={{ position: "relative" }}>
            <button
              onClick={() => { setShowSort(!showSort); setShowFilter(false); }}
              style={{
                padding: "8px 14px",
                fontSize: "13px",
                fontWeight: 500,
                borderRadius: "6px",
                border: "1px solid #2A2A2A",
                backgroundColor: "transparent",
                color: "#A3A3A0",
                cursor: "pointer",
                fontFamily: "'DM Sans', system-ui, sans-serif",
              }}
            >
              Sort by: {sort === "priority" ? "Priority" : sort === "newest" ? "Newest" : "Comments"}
            </button>

            {showSort && (
              <div style={dropdownStyle}>
                {[
                  { key: "priority", label: "Priority" },
                  { key: "newest", label: "Newest" },
                  { key: "comments", label: "Most Comments" },
                ].map((s) => (
                  <button key={s.key} onClick={() => { setSort(s.key); setShowSort(false); }} style={filterOptionStyle(sort === s.key)}>{s.label}</button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ display: "flex", justifyContent: "center", padding: "60px 0" }}>
          <div style={{ width: "24px", height: "24px", border: "2px solid #2A2A2A", borderTopColor: "#E8651A", borderRadius: "50%", animation: "spin 0.6s linear infinite" }} />
        </div>
      )}

      {/* Empty state */}
      {!loading && alerts.length === 0 && (
        <div style={{ textAlign: "center", padding: "60px 20px" }}>
          <p style={{ fontSize: "15px", color: "#A3A3A0", marginBottom: "8px" }}>
            No alerts found.
          </p>
          <p style={{ fontSize: "13px", color: "#6B6B68" }}>
            {activeFilters > 0
              ? "Try adjusting your filters."
              : "We're scanning your subreddits every 15 minutes. Alerts will appear here."}
          </p>
        </div>
      )}

      {/* Alert feed */}
      {!loading && alerts.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          {/* New alerts — Medium + High */}
          {(view === "all" || view === "new") && mediumHighNew.length > 0 && (
            <div>
              <h2 style={{ fontSize: "14px", fontWeight: 600, color: "#A3A3A0", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "12px" }}>
                New Alerts ({mediumHighNew.length})
              </h2>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {mediumHighNew.map(renderAlertCard)}
              </div>
            </div>
          )}

          {/* New alerts — Low priority (collapsible) */}
          {(view === "all" || view === "new") && lowNew.length > 0 && (
            <div>
              <button
                onClick={() => setShowAllLow(!showAllLow)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  fontSize: "13px",
                  fontWeight: 500,
                  color: "#6B6B68",
                  backgroundColor: "transparent",
                  border: "none",
                  cursor: "pointer",
                  padding: "8px 0",
                  fontFamily: "'DM Sans', system-ui, sans-serif",
                }}
              >
                <span style={{ transform: showAllLow ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 150ms", display: "inline-block" }}>▸</span>
                {showAllLow ? "Hide" : "Show"} {lowNew.length} more alert{lowNew.length !== 1 ? "s" : ""} (lower priority)
              </button>
              {showAllLow && (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "8px" }}>
                  {lowNew.map(renderAlertCard)}
                </div>
              )}
            </div>
          )}

          {/* Seen alerts */}
          {(view === "all" || view === "seen") && seenAlerts.length > 0 && (
            <div>
              <h2 style={{ fontSize: "14px", fontWeight: 600, color: "#6B6B68", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "12px" }}>
                Seen ({seenAlerts.length})
              </h2>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {seenAlerts.map(renderAlertCard)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
