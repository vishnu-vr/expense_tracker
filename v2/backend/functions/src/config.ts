/**
 * All tunables in one place. Values come from environment variables so they
 * can be set per project in `functions/.env` / `functions/.env.<projectId>`
 * (loaded by Firebase at deploy time) without code changes. No secrets here.
 */

const env = (name: string, fallback: string): string => {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : fallback;
};

/**
 * Embedding model for semantic note search (Vertex AI).
 * Verified against @genkit-ai/google-genai 1.44.0's known Vertex embedders:
 * `text-embedding-004` (used by v1) is hidden there and marked as retiring
 * 1 Apr 2027; `gemini-embedding-001` is a listed, text-only model that
 * supports `taskType` and `outputDimensionality`.
 *
 * Changing this (or the dimension) requires re-embedding every transaction
 * and, for the dimension, redeploying the vector index.
 */
export const EMBEDDING_MODEL = "gemini-embedding-001";
/** Must match `vectorConfig.dimension` in firestore.indexes.json (Firestore max is 2048). */
export const EMBEDDING_DIMENSIONS = 768;

/**
 * Agent model, as `<provider>/<model>`:
 *   vertexai/<gemini model>            Gemini on Vertex AI (default)
 *   vertex-model-garden/<claude model> Claude through Vertex Model Garden
 *   googleai/<gemini model>            Gemini Developer API (needs GEMINI_API_KEY; handy for local evals)
 */
export const DEFAULT_AGENT_MODEL = "vertexai/gemini-3.8-flash";
export const agentModelId = (): string => env("AGENT_MODEL", DEFAULT_AGENT_MODEL);

/** Vertex AI location for Gemini + embeddings. */
export const vertexLocation = (): string => env("VERTEX_LOCATION", "global");
/** Vertex AI location for Model Garden (Claude) models. */
export const modelGardenLocation = (): string => env("MODEL_GARDEN_LOCATION", "us-east5");

/** Optional model used ONLY to reword insight cards. Empty = deterministic templates. */
export const insightsPhrasingModelId = (): string => env("INSIGHTS_PHRASING_MODEL", "");

/** Time zone used by the scheduled insights job (homes do not store one). */
export const defaultTimeZone = (): string => env("DEFAULT_TIME_ZONE", "Asia/Kolkata");

/** Enforce App Check on callables. Off by default so emulators and early builds work. */
export const enforceAppCheck = (): boolean => env("ENFORCE_APP_CHECK", "false") === "true";

export const AGENT_LIMITS = {
  /** Max characters of a user message. */
  maxMessageLength: 2000,
  /** Prior messages replayed as history. */
  maxHistoryMessages: 20,
  /** Characters of history replayed (oldest dropped first). */
  maxHistoryChars: 12000,
  /** Model ↔ tool round trips per question. */
  maxTurns: 10,
} as const;

/** Cloud Functions region. Same as the Firestore database (asia-south1, Mumbai): Firestore triggers must run in the database region. */
export const REGION = "asia-south1";

/**
 * Admin billing dashboard (D-024). Costs come from the Cloud Billing export
 * to BigQuery (`<project>.<BILLING_DATASET>.gcp_billing_export_v1_*`), set up
 * once in the console; usage comes from Cloud Monitoring.
 */
export const billingDataset = (): string => env("BILLING_DATASET", "billing_export");
/** BigQuery location of the export dataset (fixed when it is created). */
export const billingLocation = (): string => env("BILLING_LOCATION", "US");
/** Project whose costs are shown. Defaults to the project the functions run in. */
export const billingProjectId = (): string => env("BILLING_PROJECT_ID", process.env.GCLOUD_PROJECT ?? "");

export const BILLING_LIMITS = {
  /** Results per month are cached in memory this long. */
  cacheMs: 15 * 60_000,
  /** Services shown by name; the rest are summed into "Other". */
  topServices: 6,
  /** SKUs returned, by gross cost. */
  topSkus: 10,
  /** Cloud Monitoring keeps most metrics about six weeks; older months have no usage. */
  usageRetentionDays: 42,
  /** Billing months, daily buckets and the forecast use this zone (fixed +05:30, no DST). */
  timeZone: "Asia/Kolkata",
  utcOffsetMinutes: 330,
} as const;
