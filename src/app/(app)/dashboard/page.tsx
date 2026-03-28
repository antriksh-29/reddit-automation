"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";

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
  const router = useRouter();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [subreddits, setSubreddits] = useState<string[]>([]);

  // Filters — multi-select (empty set = all)
  const [viewFilter, setViewFilter] = useState<Set<string>>(new Set());
  const [priorityFilter, setPriorityFilter] = useState<Set<string>>(new Set());
  const [categoryFilter, setCategoryFilter] = useState<Set<string>>(new Set());
  const [subredditFilter, setSubredditFilter] = useState<Set<string>>(new Set());
  const [dateFilter, setDateFilter] = useState<string>("");
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

  const [allAlerts, setAllAlerts] = useState<Alert[]>([]);

  // Fetch all alerts once, filter client-side for multi-select
  const fetchAlerts = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set("sort", sort);
    params.set("limit", "200");

    const res = await fetch(`/api/alerts?${params}`);
    if (res.ok) {
      const data = await res.json();
      setAllAlerts(data.alerts);
    }
    setLoading(false);
  }, [sort]);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  // Client-side multi-select filtering
  useEffect(() => {
    let filtered = [...allAlerts];
    if (viewFilter.size > 0) {
      filtered = filtered.filter((a) => {
        if (viewFilter.has("new") && !a.is_seen) return true;
        if (viewFilter.has("seen") && a.is_seen) return true;
        return false;
      });
    }
    if (priorityFilter.size > 0) {
      filtered = filtered.filter((a) => priorityFilter.has(a.priority_level));
    }
    if (categoryFilter.size > 0) {
      filtered = filtered.filter((a) => categoryFilter.has(a.category));
    }
    if (subredditFilter.size > 0) {
      filtered = filtered.filter((a) => subredditFilter.has(a.subreddit_name));
    }
    if (dateFilter) {
      const now = new Date();
      let cutoff: Date;
      switch (dateFilter) {
        case "today": cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate()); break;
        case "yesterday": cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1); break;
        case "week": cutoff = new Date(now.getTime() - 7 * 86400000); break;
        case "month": cutoff = new Date(now.getTime() - 30 * 86400000); break;
        default: cutoff = new Date(0);
      }
      filtered = filtered.filter((a) => new Date(a.post_created_at) >= cutoff);
    }
    setAlerts(filtered);
  }, [allAlerts, viewFilter, priorityFilter, categoryFilter, subredditFilter, dateFilter]);

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

  const activeFilters = viewFilter.size + priorityFilter.size + categoryFilter.size + subredditFilter.size + (dateFilter ? 1 : 0);

  // Toggle a value in a Set (multi-select)
  function toggleFilter(setter: React.Dispatch<React.SetStateAction<Set<string>>>, value: string) {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  // Hover-based sub-menu tracking
  const [hoveredFilter, setHoveredFilter] = useState<string | null>(null);

  const dropdownStyle: React.CSSProperties = {
    position: "absolute",
    top: "100%",
    right: 0,
    marginTop: "4px",
    backgroundColor: "#1C1C1C",
    border: "1px solid #2A2A2A",
    borderRadius: "8px",
    padding: "4px",
    zIndex: 100,
    minWidth: "180px",
    boxShadow: "0 8px 30px rgba(0,0,0,0.5)",
  };

  const subMenuStyle: React.CSSProperties = {
    position: "absolute",
    left: "100%",
    top: 0,
    marginLeft: "4px",
    backgroundColor: "#1C1C1C",
    border: "1px solid #2A2A2A",
    borderRadius: "8px",
    padding: "4px",
    minWidth: "160px",
    boxShadow: "0 8px 30px rgba(0,0,0,0.5)",
  };

  const filterRowStyle = (hovered: boolean): React.CSSProperties => ({
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
    padding: "8px 12px",
    borderRadius: "6px",
    fontSize: "13px",
    color: "#A3A3A0",
    backgroundColor: hovered ? "#242424" : "transparent",
    border: "none",
    cursor: "pointer",
    fontFamily: "'DM Sans', system-ui, sans-serif",
    position: "relative" as const,
  });

  const checkOptionStyle = (active: boolean): React.CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: "8px",
    width: "100%",
    padding: "7px 12px",
    borderRadius: "6px",
    fontSize: "13px",
    color: active ? "#F5F5F3" : "#A3A3A0",
    backgroundColor: active ? "rgba(232, 101, 26, 0.1)" : "transparent",
    border: "none",
    cursor: "pointer",
    fontFamily: "'DM Sans', system-ui, sans-serif",
    textAlign: "left" as const,
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
          padding: "18px",
          backgroundColor: alert.is_seen ? "#1E1E1E" : "#262626",
          border: `1px solid ${alert.priority_level === "high" ? "rgba(239, 68, 68, 0.35)" : alert.priority_level === "medium" ? "rgba(245, 158, 11, 0.25)" : "#444"}`,
          borderRadius: "10px",
          borderLeft: `3px solid ${priorityColor}`,
          opacity: alert.is_seen ? 0.65 : 1,
          transition: "background-color 150ms, border-color 150ms",
        }}
        onMouseEnter={(e) => { if (!alert.is_seen) e.currentTarget.style.backgroundColor = "#2E2E2E"; }}
        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = alert.is_seen ? "#1E1E1E" : "#262626"; }}
      >
        {/* Header row */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px", flexWrap: "wrap" }}>
          <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: priorityColor, flexShrink: 0, boxShadow: alert.priority_level === "high" ? "0 0 6px rgba(239,68,68,0.4)" : "none" }} />
          <span style={{ fontSize: "11px", fontWeight: 700, color: priorityColor, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            {alert.priority_level}
          </span>
          <span style={{ fontSize: "12px", color: "#777" }}>·</span>
          <span style={{ fontSize: "12px", color: "#FFFFFF", fontWeight: 500 }}>r/{alert.subreddit_name}</span>
          <span style={{ fontSize: "12px", color: "#777" }}>·</span>
          <span style={{ fontSize: "12px", color: "#E0E0DD" }}>{timeAgo(alert.post_created_at)}</span>
        </div>

        {/* Title */}
        <h3 style={{ fontSize: "15px", fontWeight: 600, color: "#FFFFFF", marginBottom: "10px", lineHeight: 1.5 }}>
          {alert.post_title}
        </h3>

        {/* Category + stats */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
          <span style={{ fontSize: "11px", fontWeight: 600, padding: "4px 10px", borderRadius: "5px", backgroundColor: cat.bg, color: cat.text, letterSpacing: "0.02em" }}>
            {cat.label}
          </span>
          <span style={{ fontSize: "12px", color: "#E8E8E5" }}>{alert.upvotes} ↑</span>
          <span style={{ fontSize: "12px", color: "#E8E8E5" }}>{alert.num_comments} comments</span>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: "8px", marginTop: "14px" }}>
          <button
            onClick={() => router.push(`/threads?url=${encodeURIComponent(alert.post_url)}`)}
            style={{ padding: "7px 14px", fontSize: "12px", fontWeight: 600, borderRadius: "6px", border: "1px solid #555", backgroundColor: "#333", color: "#FFFFFF", cursor: "pointer", fontFamily: "'DM Sans', system-ui, sans-serif", transition: "all 150ms" }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#E8651A"; e.currentTarget.style.color = "#FFF"; e.currentTarget.style.borderColor = "#E8651A"; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "#333"; e.currentTarget.style.color = "#FFFFFF"; e.currentTarget.style.borderColor = "#555"; }}
          >
            Analyze Thread
          </button>
          <button
            onClick={() => router.push(`/drafts?alert_id=${alert.id}`)}
            style={{ padding: "7px 14px", fontSize: "12px", fontWeight: 600, borderRadius: "6px", border: "1px solid #555", backgroundColor: "#333", color: "#FFFFFF", cursor: "pointer", fontFamily: "'DM Sans', system-ui, sans-serif", transition: "all 150ms" }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#444"; e.currentTarget.style.color = "#FFF"; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "#333"; e.currentTarget.style.color = "#FFFFFF"; }}
          >
            Draft Response
          </button>
          <a
            href={alert.post_url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ padding: "7px 14px", fontSize: "12px", fontWeight: 500, borderRadius: "6px", border: "1px solid #555", backgroundColor: "#333", color: "#DDD", textDecoration: "none", fontFamily: "'DM Sans', system-ui, sans-serif" }}
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
              <div style={dropdownStyle} onMouseLeave={() => setHoveredFilter(null)}>
                {/* View */}
                <div
                  style={{ position: "relative" }}
                  onMouseEnter={() => setHoveredFilter("view")}
                >
                  <div style={filterRowStyle(hoveredFilter === "view")}>
                    <span>View {viewFilter.size > 0 && <span style={{ color: "#E8651A" }}>({viewFilter.size})</span>}</span>
                    <span style={{ fontSize: "10px", color: "#6B6B68" }}>▸</span>
                  </div>
                  {hoveredFilter === "view" && (
                    <div style={subMenuStyle}>
                      {[{ key: "new", label: "New" }, { key: "seen", label: "Seen" }].map((v) => (
                        <button key={v.key} onClick={() => toggleFilter(setViewFilter, v.key)} style={checkOptionStyle(viewFilter.has(v.key))}>
                          <span style={{ width: "14px", height: "14px", borderRadius: "3px", border: viewFilter.has(v.key) ? "none" : "1px solid #6B6B68", backgroundColor: viewFilter.has(v.key) ? "#E8651A" : "transparent", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "10px", color: "#FFF", flexShrink: 0 }}>{viewFilter.has(v.key) ? "✓" : ""}</span>
                          {v.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Priority */}
                <div
                  style={{ position: "relative" }}
                  onMouseEnter={() => setHoveredFilter("priority")}
                >
                  <div style={filterRowStyle(hoveredFilter === "priority")}>
                    <span>Priority {priorityFilter.size > 0 && <span style={{ color: "#E8651A" }}>({priorityFilter.size})</span>}</span>
                    <span style={{ fontSize: "10px", color: "#6B6B68" }}>▸</span>
                  </div>
                  {hoveredFilter === "priority" && (
                    <div style={subMenuStyle}>
                      {[{ key: "high", label: "High" }, { key: "medium", label: "Medium" }, { key: "low", label: "Low" }].map((v) => (
                        <button key={v.key} onClick={() => toggleFilter(setPriorityFilter, v.key)} style={checkOptionStyle(priorityFilter.has(v.key))}>
                          <span style={{ width: "14px", height: "14px", borderRadius: "3px", border: priorityFilter.has(v.key) ? "none" : "1px solid #6B6B68", backgroundColor: priorityFilter.has(v.key) ? "#E8651A" : "transparent", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "10px", color: "#FFF", flexShrink: 0 }}>{priorityFilter.has(v.key) ? "✓" : ""}</span>
                          <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: PRIORITY_COLORS[v.key], flexShrink: 0 }} />
                          {v.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Category */}
                <div
                  style={{ position: "relative" }}
                  onMouseEnter={() => setHoveredFilter("category")}
                >
                  <div style={filterRowStyle(hoveredFilter === "category")}>
                    <span>Category {categoryFilter.size > 0 && <span style={{ color: "#E8651A" }}>({categoryFilter.size})</span>}</span>
                    <span style={{ fontSize: "10px", color: "#6B6B68" }}>▸</span>
                  </div>
                  {hoveredFilter === "category" && (
                    <div style={subMenuStyle}>
                      {Object.entries(CATEGORY_COLORS).map(([key, val]) => (
                        <button key={key} onClick={() => toggleFilter(setCategoryFilter, key)} style={checkOptionStyle(categoryFilter.has(key))}>
                          <span style={{ width: "14px", height: "14px", borderRadius: "3px", border: categoryFilter.has(key) ? "none" : "1px solid #6B6B68", backgroundColor: categoryFilter.has(key) ? "#E8651A" : "transparent", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "10px", color: "#FFF", flexShrink: 0 }}>{categoryFilter.has(key) ? "✓" : ""}</span>
                          <span style={{ width: "8px", height: "8px", borderRadius: "4px", backgroundColor: val.text, flexShrink: 0 }} />
                          {val.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Subreddit */}
                <div
                  style={{ position: "relative" }}
                  onMouseEnter={() => setHoveredFilter("subreddit")}
                >
                  <div style={filterRowStyle(hoveredFilter === "subreddit")}>
                    <span>Subreddit {subredditFilter.size > 0 && <span style={{ color: "#E8651A" }}>({subredditFilter.size})</span>}</span>
                    <span style={{ fontSize: "10px", color: "#6B6B68" }}>▸</span>
                  </div>
                  {hoveredFilter === "subreddit" && (
                    <div style={subMenuStyle}>
                      {subreddits.map((s) => (
                        <button key={s} onClick={() => toggleFilter(setSubredditFilter, s)} style={checkOptionStyle(subredditFilter.has(s))}>
                          <span style={{ width: "14px", height: "14px", borderRadius: "3px", border: subredditFilter.has(s) ? "none" : "1px solid #6B6B68", backgroundColor: subredditFilter.has(s) ? "#E8651A" : "transparent", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "10px", color: "#FFF", flexShrink: 0 }}>{subredditFilter.has(s) ? "✓" : ""}</span>
                          r/{s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Date Range */}
                <div
                  style={{ position: "relative" }}
                  onMouseEnter={() => setHoveredFilter("date")}
                >
                  <div style={filterRowStyle(hoveredFilter === "date")}>
                    <span>Date Range {dateFilter && <span style={{ color: "#E8651A" }}>(1)</span>}</span>
                    <span style={{ fontSize: "10px", color: "#6B6B68" }}>▸</span>
                  </div>
                  {hoveredFilter === "date" && (
                    <div style={subMenuStyle}>
                      {[
                        { key: "today", label: "Today" },
                        { key: "yesterday", label: "Since Yesterday" },
                        { key: "week", label: "This Week" },
                        { key: "month", label: "This Month" },
                      ].map((d) => (
                        <button
                          key={d.key}
                          onClick={() => setDateFilter(dateFilter === d.key ? "" : d.key)}
                          style={checkOptionStyle(dateFilter === d.key)}
                        >
                          <span style={{ width: "14px", height: "14px", borderRadius: "3px", border: dateFilter === d.key ? "none" : "1px solid #6B6B68", backgroundColor: dateFilter === d.key ? "#E8651A" : "transparent", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "10px", color: "#FFF", flexShrink: 0 }}>{dateFilter === d.key ? "✓" : ""}</span>
                          {d.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Clear all filters */}
                {activeFilters > 0 && (
                  <>
                    <div style={{ height: "1px", backgroundColor: "#2A2A2A", margin: "4px 0" }} />
                    <button
                      onClick={() => { setViewFilter(new Set()); setPriorityFilter(new Set()); setCategoryFilter(new Set()); setSubredditFilter(new Set()); setDateFilter(""); }}
                      style={{ ...checkOptionStyle(false), color: "#EF4444", fontSize: "12px" }}
                    >
                      Clear all filters
                    </button>
                  </>
                )}
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
                  <button key={s.key} onClick={() => { setSort(s.key); setShowSort(false); }} style={checkOptionStyle(sort === s.key)}>{s.label}</button>
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
          <p style={{ fontSize: "15px", color: "#DDD", marginBottom: "8px" }}>
            No alerts found.
          </p>
          <p style={{ fontSize: "13px", color: "#999" }}>
            {activeFilters > 0
              ? "Try adjusting your filters."
              : "We're scanning your subreddits every 30 minutes. Alerts will appear here."}
          </p>
        </div>
      )}

      {/* Alert feed */}
      {!loading && alerts.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          {/* New alerts — Medium + High */}
          {(viewFilter.size === 0 || viewFilter.has("new")) && mediumHighNew.length > 0 && (
            <div>
              <h2 style={{ fontSize: "13px", fontWeight: 700, color: "#FFFFFF", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "14px" }}>
                New Alerts <span style={{ color: "#E8651A" }}>({mediumHighNew.length})</span>
              </h2>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {mediumHighNew.map(renderAlertCard)}
              </div>
            </div>
          )}

          {/* New alerts — Low priority (collapsible) */}
          {(viewFilter.size === 0 || viewFilter.has("new")) && lowNew.length > 0 && (
            <div>
              <button
                onClick={() => setShowAllLow(!showAllLow)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  fontSize: "13px",
                  fontWeight: 500,
                  color: "#CCC",
                  backgroundColor: "transparent",
                  border: "1px solid #2A2A2A",
                  borderRadius: "8px",
                  cursor: "pointer",
                  padding: "10px 16px",
                  fontFamily: "'DM Sans', system-ui, sans-serif",
                  width: "100%",
                  justifyContent: "center",
                  transition: "all 150ms",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#3A3A3A"; e.currentTarget.style.color = "#FFF"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#2A2A2A"; e.currentTarget.style.color = "#CCC"; }}
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
          {(viewFilter.size === 0 || viewFilter.has("seen")) && seenAlerts.length > 0 && (
            <div>
              <h2 style={{ fontSize: "13px", fontWeight: 700, color: "#AAA", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "14px" }}>
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
