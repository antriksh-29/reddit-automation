/**
 * Reddit Public JSON Client — no auth required.
 * Appends .json to Reddit URLs for structured data.
 * Rate limit: ~10 req/min (unauthenticated).
 * Ref: TECH-SPEC.md §6.1, PRODUCT-SPEC.md §6.1
 *
 * When OAuth credentials are available, this will be upgraded
 * to authenticated requests (100 req/min).
 */

const USER_AGENT = "Arete/1.0 (Reddit Lead Intelligence)";
const REQUEST_DELAY_MS = 7000; // ~8-9 req/min, stays under 10/min limit

let lastRequestTime = 0;

async function rateLimitedFetch(url: string): Promise<Response> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < REQUEST_DELAY_MS) {
    await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS - elapsed));
  }
  lastRequestTime = Date.now();

  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    redirect: "manual", // Don't follow 302s (non-existent subs redirect)
  });

  return res;
}

export interface RedditPost {
  id: string;
  name: string; // fullname like "t3_abc123"
  title: string;
  selftext: string;
  author: string;
  url: string;
  permalink: string;
  subreddit: string;
  created_utc: number;
  ups: number;
  num_comments: number;
  is_self: boolean;
}

/**
 * Fetch new posts from a subreddit.
 * Uses public JSON endpoint — no auth needed.
 * Returns posts sorted by newest first.
 */
export async function fetchNewPosts(
  subredditName: string,
  options: { limit?: number; after?: string | null } = {}
): Promise<{ posts: RedditPost[]; after: string | null }> {
  const limit = options.limit || 25;
  let url = `https://www.reddit.com/r/${subredditName}/new.json?limit=${limit}&raw_json=1`;
  if (options.after) {
    url += `&after=${options.after}`;
  }

  const res = await rateLimitedFetch(url);

  // 302 = subreddit doesn't exist (redirect to search)
  if (res.status === 302) {
    console.warn(`[reddit] r/${subredditName}: does not exist (302)`);
    return { posts: [], after: null };
  }

  if (res.status === 403) {
    console.warn(`[reddit] r/${subredditName}: private or quarantined (403)`);
    return { posts: [], after: null };
  }

  if (res.status === 404) {
    console.warn(`[reddit] r/${subredditName}: banned or removed (404)`);
    return { posts: [], after: null };
  }

  if (!res.ok) {
    console.error(`[reddit] r/${subredditName}: HTTP ${res.status}`);
    return { posts: [], after: null };
  }

  const data = await res.json();

  if (!data?.data?.children) {
    return { posts: [], after: null };
  }

  const posts: RedditPost[] = data.data.children
    .filter((child: { kind: string }) => child.kind === "t3")
    .map((child: { data: Record<string, unknown> }) => ({
      id: child.data.id as string,
      name: child.data.name as string,
      title: child.data.title as string,
      selftext: (child.data.selftext as string) || "",
      author: child.data.author as string,
      url: child.data.url as string,
      permalink: child.data.permalink as string,
      subreddit: child.data.subreddit as string,
      created_utc: child.data.created_utc as number,
      ups: child.data.ups as number,
      num_comments: child.data.num_comments as number,
      is_self: child.data.is_self as boolean,
    }));

  return {
    posts,
    after: (data.data.after as string) || null,
  };
}

/**
 * Fetch comments for a thread (used in thread analysis, not scanner).
 */
export async function fetchThreadComments(
  postId: string,
  subreddit: string
): Promise<{ comments: unknown[]; error?: string }> {
  const url = `https://www.reddit.com/r/${subreddit}/comments/${postId}.json?raw_json=1&limit=100`;
  const res = await rateLimitedFetch(url);

  if (!res.ok) {
    return { comments: [], error: `HTTP ${res.status}` };
  }

  const data = await res.json();
  // Reddit returns [post, comments] array
  if (!Array.isArray(data) || data.length < 2) {
    return { comments: [] };
  }

  return { comments: data[1]?.data?.children || [] };
}
