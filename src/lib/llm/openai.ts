import OpenAI from "openai";

let client: OpenAI | null = null;

export function getOpenAIClient(): OpenAI {
  if (!client) {
    client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY!,
    });
  }
  return client;
}

/**
 * Call OpenAI GPT-4o with a system prompt and user message.
 * Used for: comment drafting (per TECH-SPEC.md LLM usage table).
 * Failover: Claude Sonnet (handled at call site).
 */
export async function callOpenAI({
  model = "gpt-5.4",
  systemPrompt,
  userMessage,
  maxTokens = 2000,
}: {
  model?: string;
  systemPrompt: string;
  userMessage: string;
  maxTokens?: number;
}): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const openai = getOpenAIClient();

  const response = await openai.chat.completions.create({
    model,
    max_completion_tokens: maxTokens,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
  });

  const text = response.choices[0]?.message?.content || "";

  return {
    text,
    inputTokens: response.usage?.prompt_tokens || 0,
    outputTokens: response.usage?.completion_tokens || 0,
  };
}
