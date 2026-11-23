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

/**
 * Models a user may pick in the app (D-027). The app sends only the `key`;
 * the id stays on the server so providers can be swapped without an app
 * release. The first entry is the default and follows `AGENT_MODEL`.
 */
export const AGENT_MODEL_CHOICES = [
  { key: "flash", id: DEFAULT_AGENT_MODEL, label: "Gemini Flash" },
  { key: "flash-lite", id: "vertexai/gemini-3.5-flash-lite", label: "Gemini Flash-Lite" },
] as const;

/** Shape of a model key in an `askAgent` request; anything else is rejected. */
export const AGENT_MODEL_KEY_PATTERN = /^[a-z0-9-]{1,32}$/;

/**
 * Model id for a user's choice. The default key, a missing key and an
 * unknown key (for example one an older app still sends after a choice is
 * removed) all give the configured default, `agentModelId()`.
 */
export function resolveAgentModel(key?: string): string {
  const choice = AGENT_MODEL_CHOICES.find((c) => c.key === key);
  if (!choice || choice === AGENT_MODEL_CHOICES[0]) return agentModelId();
  return choice.id;
}

/**
 * SMS category suggestions (D-032). Users pick Cloud with a D-027 key; the
 * cheaper Flash-Lite is the default here (unlike the assistant), so a
 * missing or unknown key gives Flash-Lite.
 */
export const SMS_SUGGEST = {
  defaultModelKey: "flash-lite",
  /** Items per call (the review list asks for up to 5 at once). */
  maxItems: 5,
  /** Characters of one payee name or reply; the app trims to this too. */
  maxTextChars: 80,
  /** Calls per user per India-time day; more gives `resource-exhausted`. */
  dailyCallsPerUser: 100,
  /** Output cap per call: one short line per item. */
  maxOutputTokens: 120,
} as const;

export function resolveSmsSuggestModel(key?: string): { key: string; id: string; label: string } {
  const choice =
    AGENT_MODEL_CHOICES.find((c) => c.key === key) ?? AGENT_MODEL_CHOICES.find((c) => c.key === SMS_SUGGEST.defaultModelKey)!;
  return { key: choice.key, id: resolveAgentModel(choice.key), label: choice.label };
}

/**
 * Expense reports (D-033). On-demand reports use the caller's assistant
 * model key (D-027, default for missing or unknown keys); the monthly job
 * uses the default `AGENT_MODEL`.
 */
export const REPORTS = {
  /** Longest report period and custom comparison, in days. */
  maxDays: 366,
  /** Baseline periods averaged by the "average" comparison. */
  averagePeriods: 3,
  /** generateReport + refreshReport calls per user per India-time day (`aiRateLimits`, `reportCalls`). */
  dailyCallsPerUser: 10,
  /** Custom reports older than this are deleted by the monthly job; monthly reports are kept. */
  customRetentionDays: 180,
  /** Monthly job: 07:00 on the 1st, India time. */
  monthlySchedule: "0 7 1 * *",
  /** Output cap per narrative call. */
  maxOutputTokens: 1200,
  narrativeLimits: { headline: 120, summary: 600, changes: 4, suggestions: 3, item: 240 },
} as const;

/** Display name of a model id ("Gemini Flash"), or the id itself when it is not a listed choice. */
export function agentModelLabel(modelId: string): string {
  return AGENT_MODEL_CHOICES.find((c) => c.id === modelId)?.label ?? modelId.replace(/^[a-z-]+\//, "");
}

/**
 * The on-device model the app can download (D-032), for reference: the app
 * reads `models/gemma3-1b-it-int4.json` from the default Storage bucket
 * (written by `scripts/upload-model.mjs`), so a new upload needs no release.
 * Gemma is provided under and subject to the Gemma Terms of Use
 * (https://ai.google.dev/gemma/terms).
 */
export const ON_DEVICE_MODEL = {
  manifest: "models/gemma3-1b-it-int4.json",
  file: "models/gemma3-1b-it-int4.litertlm",
  source: "https://huggingface.co/litert-community/Gemma3-1B-IT/resolve/main/gemma3-1b-it-int4.litertlm",
  sizeBytes: 584_417_280,
  /** Of the uploaded file (2026-11-18); the manifest carries the same value. */
  sha256: "1325ae366d31950f137c9c357b9fa89448b176d76998180c08ceaca78bba98be",
} as const;

/**
 * How the app will present the answer (D-028). `voice` means the app reads
 * the first text block aloud, so the prompt asks for a short spoken answer
 * first. The first entry is the default.
 */
export const AGENT_REPLY_MODES = ["text", "voice"] as const;
export type AgentReplyMode = (typeof AGENT_REPLY_MODES)[number];

/**
 * Languages the assistant may answer in (D-028): `en` (default) and `ml`
 * (Malayalam). Anything else in a request is rejected.
 */
export const AGENT_LANGUAGES = ["en", "ml"] as const;
export type AgentLanguage = (typeof AGENT_LANGUAGES)[number];

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

/** Assistant usage accounting (D-025). */
export const AI_USAGE = {
  /** `aiUsage/{YYYY-MM}_{homeId}` months are India time (fixed +05:30). */
  timeZone: "Asia/Kolkata",
  /** Characters of the assistant's first text block kept as the thread's `lastMessagePreview`. */
  previewChars: 80,
  /** Rollup docs read per month for the admin view. */
  maxRollupDocs: 1000,
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
