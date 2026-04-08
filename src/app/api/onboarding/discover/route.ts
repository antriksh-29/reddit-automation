import { createServerSupabaseClient } from "@/lib/supabase/server";
import { callOpenAI } from "@/lib/llm/openai";
import { callClaude } from "@/lib/llm/anthropic";
import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";

const SYSTEM_PROMPT = readFileSync(
  join(process.cwd(), "prompts/onboarding-agent2-discovery.md"),
  "utf-8"
);

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { description, icp_description, competitors } = await request.json();

  if (!description || !icp_description) {
    return NextResponse.json(
      { error: "Business description and ICP are required" },
      { status: 400 }
    );
  }

  const userMessage = `Business Description: ${description}

Ideal Customer Profile: ${icp_description}

Known Competitors: ${competitors?.length ? competitors.join(", ") : "None identified yet"}`;

  try {
    // Primary: GPT-5.4 (better Reddit knowledge due to Reddit API partnership)
    const { text, inputTokens, outputTokens } = await callOpenAI({
      model: "gpt-5.4",
      systemPrompt: SYSTEM_PROMPT,
      userMessage,
      maxTokens: 1500,
    });

    const discovery = JSON.parse(text);

    return NextResponse.json({
      discovery,
      tokens: { input: inputTokens, output: outputTokens },
    });
  } catch (primaryError) {
    // Fallback: Claude Sonnet
    console.error("GPT-5.4 discovery failed, falling back to Claude:", primaryError);
    try {
      const { text, inputTokens, outputTokens } = await callClaude({
        systemPrompt: SYSTEM_PROMPT,
        userMessage,
      });

      const discovery = JSON.parse(text);

      return NextResponse.json({
        discovery,
        tokens: { input: inputTokens, output: outputTokens },
      });
    } catch {
      return NextResponse.json(
        { error: "Failed to discover subreddits and keywords. Please try again." },
        { status: 500 }
      );
    }
  }
}
