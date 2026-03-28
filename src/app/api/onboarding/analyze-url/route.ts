import { createServerSupabaseClient } from "@/lib/supabase/server";
import { callClaude } from "@/lib/llm/anthropic";
import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";

const SYSTEM_PROMPT = readFileSync(
  join(process.cwd(), "prompts/onboarding-agent1-website-analysis.md"),
  "utf-8"
);

/**
 * Strip HTML to meaningful text content.
 * Removes scripts, styles, SVGs, nav/footer boilerplate, then extracts text.
 */
function htmlToText(html: string): string {
  return html
    // Remove script tags and contents (multiline)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    // Remove style tags and contents
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    // Remove SVG tags and contents
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, "")
    // Remove HTML comments
    .replace(/<!--[\s\S]*?-->/g, "")
    // Remove noscript
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, "")
    // Remove all remaining HTML tags
    .replace(/<[^>]+>/g, " ")
    // Decode common HTML entities
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    // Collapse whitespace
    .replace(/\s+/g, " ")
    .trim();
}

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { url } = await request.json();

  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "URL is required" }, { status: 400 });
  }

  // SSRF protection: only allow http/https, block private/internal IPs
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return NextResponse.json({ error: "Only HTTP/HTTPS URLs are allowed" }, { status: 400 });
    }
    const hostname = parsed.hostname.toLowerCase();
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "0.0.0.0" ||
      hostname.startsWith("10.") ||
      hostname.startsWith("172.") ||
      hostname.startsWith("192.168.") ||
      hostname.startsWith("169.254.") ||
      hostname.endsWith(".internal") ||
      hostname.endsWith(".local")
    ) {
      return NextResponse.json({ error: "Internal/private URLs are not allowed" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid URL format" }, { status: 400 });
  }

  try {
    // Fetch the website content
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "Could not reach the website. Please check the URL." },
        { status: 422 }
      );
    }

    const html = await response.text();
    const textContent = htmlToText(html).slice(0, 8000);

    if (textContent.length < 50) {
      return NextResponse.json(
        { error: "Website has too little content to analyze. Please enter details manually." },
        { status: 422 }
      );
    }

    // Agent 1: Analyze website
    const { text, inputTokens, outputTokens } = await callClaude({
      systemPrompt: SYSTEM_PROMPT,
      userMessage: `Website URL: ${url}\n\nWebsite content:\n${textContent}`,
    });

    // Parse JSON — handle markdown code blocks if LLM wraps response
    const jsonStr = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const analysis = JSON.parse(jsonStr);

    return NextResponse.json({
      analysis,
      tokens: { input: inputTokens, output: outputTokens },
    });
  } catch (error) {
    console.error("Onboarding analyze-url error:", error);

    const message =
      error instanceof SyntaxError
        ? "Failed to parse website analysis. Please try again."
        : error instanceof Error && error.name === "TimeoutError"
          ? "Website took too long to respond. Please check the URL."
          : error instanceof Error
            ? `Analysis failed: ${error.message}`
            : "Something went wrong. Please try again.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
