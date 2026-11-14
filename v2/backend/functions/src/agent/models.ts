import { genkit, Genkit } from "genkit";
import type { ModelArgument } from "genkit/model";
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, modelGardenLocation, vertexLocation } from "../config";

export type Provider = "vertexai" | "vertex-model-garden" | "googleai";

export interface ModelId {
  provider: Provider;
  name: string;
  /** `<provider>/<name>` */
  id: string;
}

/**
 * Parse a configured model id. A bare name is accepted: `claude-*` goes to
 * Vertex Model Garden, anything else to Gemini on Vertex AI.
 */
export function parseModelId(raw: string): ModelId {
  const value = raw.trim();
  const slash = value.indexOf("/");
  const prefix = slash > 0 ? value.slice(0, slash) : "";
  const rest = slash > 0 ? value.slice(slash + 1) : value;
  if (!rest) throw new Error(`Invalid model id "${raw}".`);
  let provider: Provider;
  if (prefix === "vertexai" || prefix === "vertex-model-garden" || prefix === "googleai") provider = prefix;
  else if (prefix === "") provider = rest.startsWith("claude-") ? "vertex-model-garden" : "vertexai";
  else throw new Error(`Unknown model provider "${prefix}" in "${raw}". Use vertexai/, vertex-model-garden/ or googleai/.`);
  return { provider, name: rest, id: `${provider}/${rest}` };
}

export interface AgentRuntime {
  ai: Genkit;
  model: ModelArgument;
  modelId: ModelId;
}

const runtimes = new Map<string, Promise<AgentRuntime>>();

/**
 * Build (once per model id) a Genkit instance with the plugins that model
 * needs. This is the provider swap layer: tools, prompt and block handling
 * are identical for every provider.
 *
 * Plugins are imported lazily so loading the functions module (deploy-time
 * discovery, emulators, unit tests) never needs credentials or the heavier SDKs.
 */
/**
 * Auth for local tools (the eval) when no Application Default Credentials
 * exist: a short-lived OAuth access token held in memory only. Deployed
 * functions never set this; they use the runtime service account.
 */
let accessTokenOverride: { token: string; projectId: string } | null = null;

export function useAccessTokenForVertex(token: string, projectId: string): void {
  accessTokenOverride = { token, projectId };
  runtimes.clear();
}

/** Extra plugin options for the access-token override; empty when not set. */
async function vertexAuthOptions(): Promise<{ googleAuth?: Record<string, unknown>; projectId?: string }> {
  if (!accessTokenOverride) return {};
  const { OAuth2Client } = await import("google-auth-library");
  const client = new OAuth2Client();
  client.setCredentials({ access_token: accessTokenOverride.token });
  const { projectId } = accessTokenOverride;
  // The plugin reads the project from its own options, not from googleAuth.
  return { googleAuth: { authClient: client, projectId }, projectId };
}

export function getAgentRuntime(rawModelId: string): Promise<AgentRuntime> {
  const modelId = parseModelId(rawModelId);
  let runtime = runtimes.get(modelId.id);
  if (!runtime) {
    runtime = createRuntime(modelId);
    runtimes.set(modelId.id, runtime);
    runtime.catch(() => runtimes.delete(modelId.id));
  }
  return runtime;
}

async function createRuntime(modelId: ModelId): Promise<AgentRuntime> {
  if (modelId.provider === "googleai") {
    const { googleAI } = await import("@genkit-ai/google-genai");
    return { ai: genkit({ plugins: [googleAI()] }), model: googleAI.model(modelId.name), modelId };
  }
  const { vertexAI } = await import("@genkit-ai/google-genai");
  const auth = await vertexAuthOptions();
  if (modelId.provider === "vertex-model-garden") {
    // Claude (and other partner models) through Vertex AI Model Garden. The
    // model must be enabled for the project in the Model Garden console.
    const { vertexModelGarden } = await import("@genkit-ai/vertexai/modelgarden");
    return {
      ai: genkit({
        plugins: [
          vertexAI({ location: vertexLocation(), ...auth }),
          vertexModelGarden({ location: modelGardenLocation(), ...auth }),
        ],
      }),
      model: vertexModelGarden.model(modelId.name),
      modelId,
    };
  }
  return {
    ai: genkit({ plugins: [vertexAI({ location: vertexLocation(), ...auth })] }),
    model: vertexAI.model(modelId.name),
    modelId,
  };
}

let embeddingAi: Promise<Genkit> | null = null;

/** Embed one text with the configured Vertex embedding model. */
export async function embedText(text: string, taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY"): Promise<number[]> {
  const { vertexAI } = await import("@genkit-ai/google-genai");
  if (!embeddingAi) {
    embeddingAi = Promise.resolve(genkit({ plugins: [vertexAI({ location: vertexLocation() })] }));
  }
  const ai = await embeddingAi;
  const result = await ai.embed({
    embedder: vertexAI.embedder(EMBEDDING_MODEL),
    content: text,
    options: { outputDimensionality: EMBEDDING_DIMENSIONS, taskType },
  });
  const vector = result[0]?.embedding;
  if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(`Embedding model returned ${vector?.length ?? 0} dimensions, expected ${EMBEDDING_DIMENSIONS}.`);
  }
  return vector;
}
