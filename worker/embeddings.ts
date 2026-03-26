/**
 * Sentence embeddings using all-MiniLM-L6-v2.
 * Loaded once at startup, reused for all Pass 1 scoring.
 * Ref: TECH-SPEC.md §7 (ML model), PRODUCT-SPEC.md §7.1 (Pass 1)
 *
 * Model: Xenova/all-MiniLM-L6-v2 (ONNX, ~80MB)
 * Output: 384-dimensional vectors
 * Speed: ~5ms per embedding on CPU
 */

import { pipeline } from "@huggingface/transformers";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let extractor: any = null;

/**
 * Load the sentence-transformer model.
 * Called once at worker startup. Exits if model fails to load.
 */
export async function loadModel(): Promise<void> {
  console.log("[embeddings] Loading all-MiniLM-L6-v2...");
  const startTime = Date.now();

  extractor = await pipeline(
    "feature-extraction",
    "Xenova/all-MiniLM-L6-v2",
  );

  const duration = Date.now() - startTime;
  console.log(`[embeddings] Model loaded in ${duration}ms`);
}

export function isModelLoaded(): boolean {
  return extractor !== null;
}

/**
 * Generate embedding vector for a text string.
 * Returns a 384-dimensional Float32Array.
 */
export async function embed(text: string): Promise<number[]> {
  if (!extractor) {
    throw new Error("Model not loaded. Call loadModel() first.");
  }

  // Truncate to ~512 tokens (~2000 chars) — model's max context
  const truncated = text.slice(0, 2000);

  const output = await extractor(truncated, {
    pooling: "mean",
    normalize: true,
  });

  // output.data is a typed array — convert to regular array
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = (output as any).data || output[0]?.data || output;
  return Array.from(data as ArrayLike<number>);
}

/**
 * Generate embeddings for a user's business profile.
 * Used during onboarding to create the "user relevance profile" vector.
 * Combines description + ICP + keywords into a single embedding.
 */
export async function generateUserProfileEmbedding(
  description: string,
  icpDescription: string,
  keywords: string[]
): Promise<number[]> {
  const combined = [
    description,
    icpDescription,
    ...keywords,
  ]
    .filter(Boolean)
    .join(". ");

  return embed(combined);
}

/**
 * Cosine similarity between two vectors.
 * Both vectors should be normalized (which MiniLM outputs are).
 * Returns value between -1 and 1 (higher = more similar).
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }

  // Vectors are already normalized by the model, so dot product = cosine similarity
  return dot;
}
