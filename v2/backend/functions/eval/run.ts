/**
 * Agent evaluation: run every golden question against the fixture household
 * with a real model and score the answers deterministically.
 *
 *   npm run eval -- --model vertexai/gemini-3.8-flash
 *   npm run eval -- --model vertexai/gemini-3.8-flash,vertex-model-garden/claude-sonnet-5
 *   npm run eval -- --model googleai/gemini-3.8-flash --only spend_oct,goa_trip
 *
 * Tools run on in-memory fixture data — no Firestore. Only the model call
 * needs credentials. Nothing is read from or written to any Firebase project.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getAgentRuntime, parseModelId, ModelId } from "../src/agent/models";
import { runAgent } from "../src/agent/run";
import { agentModelId } from "../src/config";
import { FIXTURE_NOW, FIXTURE_TIME_ZONE } from "./fixture";
import { FixtureBackend } from "./fixture-backend";
import { buildGoldens, Golden } from "./golden";
import { scoreAnswer, Score } from "./scoring";

interface Args {
  models: string[];
  only: string[] | null;
  out: string | null;
  verbose: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { models: [], only: null, out: null, verbose: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--model" || a === "--models") args.models = (argv[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--only") args.only = (argv[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--out") args.out = argv[++i] ?? null;
    else if (a === "--verbose") args.verbose = true;
    else if (a === "--help" || a === "-h") {
      console.log("Usage: npm run eval -- --model <provider/model>[,<provider/model>…] [--only id,id] [--out file.json] [--verbose]");
      process.exit(0);
    } else {
      fail(`Unknown argument "${a}". Try --help.`);
    }
  }
  if (args.models.length === 0) args.models = [agentModelId()];
  return args;
}

function fail(message: string): never {
  console.error(`\neval: ${message}\n`);
  process.exit(2);
}

/** Refuse to start without the credentials the chosen provider needs, and say exactly what is missing. */
function assertCredentials(model: ModelId): void {
  if (model.provider === "googleai") {
    if (!process.env.GEMINI_API_KEY && !process.env.GOOGLE_API_KEY) {
      fail(
        `No credentials for ${model.id}.\n` +
          "  The Gemini Developer API needs an API key: export GEMINI_API_KEY=<key> and run again.",
      );
    }
    return;
  }
  const adcFile = join(homedir(), ".config", "gcloud", "application_default_credentials.json");
  const hasAdc = !!process.env.GOOGLE_APPLICATION_CREDENTIALS || existsSync(adcFile);
  const project = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
  const problems: string[] = [];
  if (!hasAdc) {
    problems.push("no Google credentials: run `gcloud auth application-default login` or set GOOGLE_APPLICATION_CREDENTIALS=<service-account.json>");
  }
  if (!project) problems.push("no project: set GOOGLE_CLOUD_PROJECT=<a project with Vertex AI enabled>");
  if (project?.startsWith("demo-")) problems.push(`"${project}" is an emulator-only demo project; Vertex AI needs a real one`);
  if (problems.length) {
    fail(
      `No credentials for ${model.id} (Vertex AI).\n` +
        problems.map((p) => `  - ${p}`).join("\n") +
        (model.provider === "vertex-model-garden"
          ? "\n  Claude models must also be enabled for the project in Vertex AI Model Garden."
          : "") +
        "\n  Alternatively use the Gemini Developer API: --model googleai/<model> with GEMINI_API_KEY set.",
    );
  }
}

interface Row {
  id: string;
  score: Score;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  modelCalls: number;
  tools: string[];
  usedFallback: boolean;
  error?: string;
  answer?: string;
}

const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${((n / d) * 100).toFixed(1)}%`);
const quantile = (values: number[], q: number) => {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

async function evaluate(modelRaw: string, goldens: Golden[], verbose: boolean) {
  const { ai, model, modelId } = await getAgentRuntime(modelRaw);
  const rows: Row[] = [];
  console.log(`\n=== ${modelId.id} — ${goldens.length} questions ===`);
  for (const g of goldens) {
    const backend = new FixtureBackend(g.uid);
    try {
      const res = await runAgent({ ai, model, backend, message: g.question, timeZone: FIXTURE_TIME_ZONE, now: FIXTURE_NOW });
      const score = scoreAnswer(g, res.blocks, backend.proposals);
      rows.push({
        id: g.id,
        score,
        latencyMs: res.latencyMs,
        inputTokens: res.usage.inputTokens,
        outputTokens: res.usage.outputTokens,
        modelCalls: res.usage.modelCalls,
        tools: res.toolCalls.map((t) => t.name),
        usedFallback: res.usedFallback,
        answer: verbose ? JSON.stringify(res.blocks) : undefined,
      });
      console.log(
        `${score.pass ? "PASS" : "FAIL"}  ${g.id.padEnd(22)} ${String(res.latencyMs).padStart(6)}ms  ` +
          `${String(res.usage.inputTokens).padStart(6)} in / ${String(res.usage.outputTokens).padStart(5)} out  ` +
          `${score.missing.length ? `missing: ${score.missing.join("; ")}` : ""}`,
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      rows.push({
        id: g.id,
        score: { pass: false, numbersExpected: g.numbers.length, numbersExact: 0, numbersRounded: 0, missing: ["error"] },
        latencyMs: 0, inputTokens: 0, outputTokens: 0, modelCalls: 0, tools: [], usedFallback: false,
        error: message.slice(0, 300),
      });
      console.log(`ERROR ${g.id.padEnd(22)} ${message.slice(0, 160)}`);
    }
  }

  const ok = rows.filter((r) => !r.error);
  const numbersExpected = rows.reduce((s, r) => s + r.score.numbersExpected, 0);
  const summary = {
    model: modelId.id,
    questions: rows.length,
    passed: rows.filter((r) => r.score.pass).length,
    errors: rows.length - ok.length,
    questionAccuracy: pct(rows.filter((r) => r.score.pass).length, rows.length),
    numericAccuracyExact: pct(rows.reduce((s, r) => s + r.score.numbersExact, 0), numbersExpected),
    numericAccuracyRounded: pct(rows.reduce((s, r) => s + r.score.numbersRounded, 0), numbersExpected),
    fallbackAnswers: ok.filter((r) => r.usedFallback).length,
    latencyMsMean: ok.length ? Math.round(ok.reduce((s, r) => s + r.latencyMs, 0) / ok.length) : 0,
    latencyMsP50: quantile(ok.map((r) => r.latencyMs), 0.5),
    latencyMsP95: quantile(ok.map((r) => r.latencyMs), 0.95),
    inputTokens: ok.reduce((s, r) => s + r.inputTokens, 0),
    outputTokens: ok.reduce((s, r) => s + r.outputTokens, 0),
    modelCallsPerQuestion: ok.length ? +(ok.reduce((s, r) => s + r.modelCalls, 0) / ok.length).toFixed(2) : 0,
  };
  return { summary, rows };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const models = args.models.map((m) => {
    try {
      return parseModelId(m);
    } catch (e) {
      return fail((e as Error).message);
    }
  });
  models.forEach(assertCredentials);

  let goldens = buildGoldens();
  if (args.only) {
    const unknown = args.only.filter((id) => !goldens.some((g) => g.id === id));
    if (unknown.length) fail(`Unknown question id(s): ${unknown.join(", ")}`);
    goldens = goldens.filter((g) => args.only!.includes(g.id));
  }

  const results = [];
  for (const m of models) results.push(await evaluate(m.id, goldens, args.verbose));

  console.log("\n=== Summary ===");
  console.table(results.map((r) => r.summary));

  const outFile =
    args.out ?? join(__dirname, "results", `eval-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  mkdirSync(join(outFile, ".."), { recursive: true });
  writeFileSync(outFile, JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2));
  console.log(`Results written to ${outFile}`);

  if (results.every((r) => r.summary.errors === r.summary.questions)) {
    fail("Every question failed with an error — check credentials, project, location and model id (see errors above).");
  }
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
