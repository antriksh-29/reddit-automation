/**
 * Generate and store user profile embeddings.
 * Called:
 *   - During worker startup (backfill any businesses with null embeddings)
 *   - Via POST /generate-embeddings webhook (after onboarding)
 *
 * The embedding combines the business description, ICP, all keywords,
 * and competitor names into a rich semantic profile vector.
 */

import { createClient } from "@supabase/supabase-js";
import { embed } from "./embeddings.js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Generate embedding for a single business and store it.
 */
export async function generateAndStoreEmbedding(businessId: string): Promise<void> {
  // Fetch business details
  const { data: business, error: bizError } = await supabase
    .from("businesses")
    .select("id, name, description, icp_description, keywords")
    .eq("id", businessId)
    .single();

  if (bizError || !business) {
    console.error(`[embeddings] Business ${businessId} not found:`, bizError);
    return;
  }

  // Fetch competitors
  const { data: competitors } = await supabase
    .from("competitors")
    .select("name")
    .eq("business_id", businessId);

  const competitorNames = (competitors || []).map((c) => c.name);
  const keywords = business.keywords as { primary: string[]; discovery: string[] } | null;
  const allKeywords = [
    ...(keywords?.primary || []),
    ...(keywords?.discovery || []),
  ];

  // Build a rich text representation of the business for embedding
  // This is what every post will be compared against semantically
  const profileText = [
    // Business core
    `Business: ${business.name}`,
    business.description ? `What we do: ${business.description}` : "",
    // ICP — who we're looking for
    business.icp_description
      ? `Our ideal customers: ${business.icp_description}`
      : "",
    // Keywords — what topics matter
    allKeywords.length > 0
      ? `Relevant topics and keywords: ${allKeywords.join(", ")}`
      : "",
    // Competitors — who else is in our space
    competitorNames.length > 0
      ? `Competitors in our space: ${competitorNames.join(", ")}`
      : "",
    // Add some semantic context about what kind of posts we want to find
    "We want to find Reddit posts from people who have problems we can solve,",
    "are looking for tools in our category, are dissatisfied with our competitors,",
    "or are discussing workflows and processes relevant to our product.",
  ]
    .filter(Boolean)
    .join(". ");

  console.log(
    `[embeddings] Generating embedding for "${business.name}" (${profileText.length} chars)`
  );

  const embedding = await embed(profileText);

  // Store the embedding
  const { error: updateError } = await supabase
    .from("businesses")
    .update({ embedding_vectors: embedding })
    .eq("id", businessId);

  if (updateError) {
    console.error(`[embeddings] Failed to store embedding for ${businessId}:`, updateError);
    return;
  }

  console.log(
    `[embeddings] Stored ${embedding.length}-dim embedding for "${business.name}"`
  );
}

/**
 * Backfill embeddings for all businesses that don't have them yet.
 * Called once at worker startup.
 */
export async function backfillEmbeddings(): Promise<number> {
  const { data: businesses, error } = await supabase
    .from("businesses")
    .select("id, name")
    .is("embedding_vectors", null);

  if (error || !businesses) {
    console.error("[embeddings] Failed to fetch businesses for backfill:", error);
    return 0;
  }

  if (businesses.length === 0) {
    console.log("[embeddings] All businesses have embeddings — no backfill needed");
    return 0;
  }

  console.log(
    `[embeddings] Backfilling embeddings for ${businesses.length} businesses`
  );

  let count = 0;
  for (const biz of businesses) {
    try {
      await generateAndStoreEmbedding(biz.id);
      count++;
    } catch (err) {
      console.error(`[embeddings] Failed for "${biz.name}":`, err);
    }
  }

  return count;
}
