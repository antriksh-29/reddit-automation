/**
 * First Scan — fast inline scan triggered after onboarding.
 * Uses the worker's already-loaded MiniLM model for full Pass 1 quality.
 * Streams progress via SSE to the frontend loading screen.
 *
 * Differences from regular scan cycle:
 *   - 2s Reddit fetch delay (not 7s) — only 3 requests
 *   - Generates business embedding if missing
 *   - Streams progress events for real-time UI
 *   - Target: <30 seconds total
 */

import { createClient } from "@supabase/supabase-js";
import pLimit from "p-limit";
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
import { join } from "path";
import { embed, cosineSimilarity } from "./embeddings.js";
import { generateAndStoreEmbedding } from "./generate-embeddings.js";
import { prefilterPost, type UserProfile } from "./prefilter.js";
import type { Response } from "express";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const USER_AGENT = "Arete/1.0 (Reddit Lead Intelligence)";
const FETCH_DELAY_MS = 2000;

const promptTemplate = readFileSync(
  join(process.cwd(), "prompts", "relevance-scoring.md"),
  "utf-8"
);

interface RedditPost {
  id: string;
  name: string;
  title: string;
  selftext: string;
  author: string;
  permalink: string;
  subreddit: string;
  created_utc: number;
  ups: number;
  num_comments: number;
}

function sendSSE(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function runFirstScan(userId: string, res: Response): Promise<void> {
  try {
    // Get business
    const { data: business } = await supabase
      .from("businesses")
      .select("id, description, icp_description, keywords, embedding_vectors")
      .eq("user_id", userId)
      .single();

    if (!business) {
      sendSSE(res, "error", { message: "No business found" });
      res.end();
      return;
    }

    // Get subreddits + competitors
    const { data: subs } = await supabase
      .from("monitored_subreddits")
      .select("id, subreddit_name")
      .eq("business_id", business.id)
      .eq("is_active", true);

    const { data: comps } = await supabase
      .from("competitors")
      .select("name")
      .eq("business_id", business.id);

    const subredditList = subs || [];
    const competitorNames = (comps || []).map((c) => c.name);
    const keywords = business.keywords as { primary: string[]; discovery: string[] } | null;
    const allKeywords = [...(keywords?.primary || []), ...(keywords?.discovery || [])];

    // 1. Generate embedding if missing (uses already-loaded MiniLM)
    sendSSE(res, "progress", { step: "embedding", message: "Building your relevance profile...", pct: 5 });

    let embeddingVectors = business.embedding_vectors as number[] | null;
    if (!embeddingVectors || embeddingVectors.length === 0) {
      await generateAndStoreEmbedding(business.id);
      // Re-fetch the embedding
      const { data: updated } = await supabase
        .from("businesses")
        .select("embedding_vectors")
        .eq("id", business.id)
        .single();
      embeddingVectors = updated?.embedding_vectors as number[] | null;
    }

    // 2. Fetch posts from Reddit (2s delay between requests)
    sendSSE(res, "progress", { step: "fetching", message: "Fetching posts from Reddit...", pct: 10 });

    const allPosts: (RedditPost & { subreddit_id: string })[] = [];

    for (let i = 0; i < subredditList.length; i++) {
      const sub = subredditList[i];
      sendSSE(res, "progress", {
        step: "fetching",
        message: `Scanning r/${sub.subreddit_name}...`,
        pct: 10 + Math.round((i / subredditList.length) * 20),
      });

      try {
        const url = `https://www.reddit.com/r/${sub.subreddit_name}/new.json?limit=25&raw_json=1`;
        const fetchRes = await fetch(url, {
          headers: { "User-Agent": USER_AGENT },
          redirect: "manual",
        });

        if (fetchRes.ok) {
          const data = await fetchRes.json();
          const posts = (data?.data?.children || [])
            .filter((c: { kind: string }) => c.kind === "t3")
            .map((c: { data: Record<string, unknown> }) => ({
              id: c.data.id as string,
              name: c.data.name as string,
              title: c.data.title as string,
              selftext: (c.data.selftext as string) || "",
              author: c.data.author as string,
              permalink: c.data.permalink as string,
              subreddit: c.data.subreddit as string,
              created_utc: c.data.created_utc as number,
              ups: c.data.ups as number,
              num_comments: c.data.num_comments as number,
              subreddit_id: sub.id,
            }));
          allPosts.push(...posts);
        }
      } catch {
        // Skip failed subreddit
      }

      if (i < subredditList.length - 1) {
        await new Promise((r) => setTimeout(r, FETCH_DELAY_MS));
      }
    }

    sendSSE(res, "progress", {
      step: "filtering",
      message: `Found ${allPosts.length} posts. Running semantic analysis...`,
      pct: 35,
    });

    // 3. Pass 1: Full semantic pre-filter (using MiniLM — already loaded in worker)
    const userProfile: UserProfile = {
      embedding_vectors: embeddingVectors,
      keywords: keywords || { primary: [], discovery: [] },
      competitors: competitorNames,
    };

    const filtered: (RedditPost & { subreddit_id: string })[] = [];
    for (const post of allPosts) {
      const result = await prefilterPost(
        { ...post, url: "", is_self: true },
        userProfile
      );
      if (result.passed) {
        filtered.push(post);
      }
    }

    sendSSE(res, "progress", {
      step: "scoring",
      message: `${filtered.length} relevant posts found. AI is scoring them...`,
      pct: 45,
    });

    // 4. Pass 2: Haiku scoring (parallel)
    const limiter = pLimit(5);
    let scored = 0;

    const results = await Promise.allSettled(
      filtered.map((post) =>
        limiter(async () => {
          const prompt = promptTemplate
            .replace("{{business_description}}", business.description || "")
            .replace("{{icp_description}}", business.icp_description || "")
            .replace("{{keywords}}", allKeywords.join(", "))
            .replace("{{competitors}}", competitorNames.join(", "))
            .replace("{{subreddit}}", post.subreddit)
            .replace("{{post_title}}", post.title)
            .replace("{{post_body}}", post.selftext.slice(0, 1500))
            .replace("{{upvotes}}", String(post.ups))
            .replace("{{num_comments}}", String(post.num_comments));

          try {
            const response = await anthropic.messages.create({
              model: "claude-haiku-4-5-20251001",
              max_tokens: 100,
              messages: [{ role: "user", content: prompt }],
            });

            const text = response.content[0].type === "text" ? response.content[0].text : "";
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (!jsonMatch) return null;

            const parsed = JSON.parse(jsonMatch[0]);
            const relevanceScore = Math.max(0, Math.min(1, Number(parsed.relevance_score) || 0.5));
            const validCategories = ["pain_point", "solution_request", "competitor_dissatisfaction", "experience_sharing", "industry_discussion"];
            const category = validCategories.includes(parsed.category) ? parsed.category : "industry_discussion";

            scored++;
            sendSSE(res, "progress", {
              step: "scoring",
              message: `Scoring posts... (${scored}/${filtered.length})`,
              pct: 45 + Math.round((scored / filtered.length) * 40),
            });

            // Priority calculation
            const ageMinutes = Math.max(1, (Date.now() / 1000 - post.created_utc) / 60);
            const recency = ageMinutes < 15 ? 1.0 : ageMinutes < 60 ? 0.8 : ageMinutes < 180 ? 0.6 : ageMinutes < 360 ? 0.4 : ageMinutes < 720 ? 0.2 : 0.1;
            const velocity = Math.min(1.0, (post.ups + post.num_comments) / ageMinutes);
            const postText = `${post.title} ${post.selftext}`.toLowerCase();
            const strongIntent = [/looking for/, /recommend/, /best tool/, /any suggestions/, /alternative to/, /switching from/, /need a\b/, /budget \$/];
            const weakIntent = [/how do you/, /what do you use/, /anyone use/, /frustrated with/];
            const intent = strongIntent.some((p) => p.test(postText)) ? 1.0 : weakIntent.some((p) => p.test(postText)) ? 0.5 : 0.0;

            const priorityScore = Math.round((relevanceScore * 0.4 + recency * 0.3 + velocity * 0.15 + intent * 0.15) * 100) / 100;
            const priorityLevel = priorityScore > 0.7 ? "high" : priorityScore >= 0.4 ? "medium" : "low";

            if (priorityScore < 0.2) return null;

            return {
              business_id: business.id,
              subreddit_id: post.subreddit_id,
              reddit_post_id: post.id,
              post_title: post.title,
              post_body: post.selftext.slice(0, 5000),
              post_author: post.author,
              post_url: `https://reddit.com${post.permalink}`,
              post_created_at: new Date(post.created_utc * 1000).toISOString(),
              upvotes: post.ups,
              num_comments: post.num_comments,
              priority_score: priorityScore,
              priority_level: priorityLevel,
              priority_factors: { relevance: relevanceScore, recency, velocity, intent },
              category,
              email_status: "skipped",
            };
          } catch {
            return null;
          }
        })
      )
    );

    sendSSE(res, "progress", { step: "saving", message: "Saving alerts to your dashboard...", pct: 90 });

    // 5. Insert alerts
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const alerts: any[] = [];
    for (const r of results) {
      if (r.status === "fulfilled" && r.value !== null) {
        alerts.push(r.value);
      }
    }

    let alertsCreated = 0;
    if (alerts.length > 0) {
      const { data: inserted } = await supabase
        .from("alerts")
        .upsert(alerts, { onConflict: "reddit_post_id", ignoreDuplicates: true })
        .select("id");
      alertsCreated = inserted?.length || 0;
    }

    // Update last_seen_post_id for each subreddit
    for (const sub of subredditList) {
      const subPosts = allPosts.filter((p) => p.subreddit_id === sub.id);
      if (subPosts.length > 0) {
        await supabase
          .from("monitored_subreddits")
          .update({
            last_scanned_at: new Date().toISOString(),
            last_seen_post_id: subPosts[0].name,
          })
          .eq("id", sub.id);
      }
    }

    sendSSE(res, "progress", { step: "done", message: "Dashboard ready!", pct: 100 });
    sendSSE(res, "complete", {
      alertsCreated,
      totalPosts: allPosts.length,
      filtered: filtered.length,
    });
  } catch (error) {
    console.error("[first-scan] Error:", error);
    sendSSE(res, "error", { message: "Scan failed. Your dashboard will update on the next cycle." });
  } finally {
    res.end();
  }
}
