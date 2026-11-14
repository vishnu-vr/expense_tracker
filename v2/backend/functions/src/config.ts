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
