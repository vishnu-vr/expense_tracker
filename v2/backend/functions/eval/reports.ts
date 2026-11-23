/**
 * Report narrative evaluation (D-033): the ten fixture reports through the
 * writer on each model. Measures how often the number guard passes first
 * time, after the retry, or falls back to the template, with latency and
 * tokens. BILLED: every case is one or two model calls; run only with the
 * owner's go-ahead.
 *
 *   npm run eval:reports -- --model vertexai/gemini-3.8-flash,vertexai/gemini-3.5-flash-lite
 *
 * The narratives are written to the local results file for reading; nothing
 * is logged elsewhere and nothing touches Firestore.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentRuntime, parseModelId, useAccessTokenForVertex } from "../src/agent/models";
import { genkitNarrativeGenerate, NarrativeGenerate, writeNarrative } from "../src/agent/report-writer";
import { agentModelId } from "../src/config";
import { buildCaseReport, REPORT_CASES } from "./report-cases";

function args(argv: string[]): { models: string[]; out: string | null } {
  const out = { models: [] as string[], out: null as string | null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--model" || argv[i] === "--models") out.models = (argv[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    else if (argv[i] === "--out") out.out = argv[++i] ?? null;
    else {
      console.error(`Unknown argument "${argv[i]}". Usage: npm run eval:reports -- --model <provider/model>[,…] [--out file.json]`);
      process.exit(2);
    }
  }
  if (!out.models.length) out.models = [agentModelId()];
  return out;
}

async function main() {
  const a = args(process.argv.slice(2));
  if (process.env.EVAL_ACCESS_TOKEN) {
    useAccessTokenForVertex(process.env.EVAL_ACCESS_TOKEN, process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "");
  }
  const results = [];
  for (const raw of a.models) {
    const id = parseModelId(raw).id;
    const { ai, model } = await getAgentRuntime(id);
    const base = genkitNarrativeGenerate(ai, model);
    const rows = [];
    console.log(`\n=== ${id}: ${REPORT_CASES.length} reports ===`);
    for (const c of REPORT_CASES) {
      const body = buildCaseReport(c);
      let calls = 0;
      let firstPass = false;
      const counting: NarrativeGenerate = async (prompt) => {
        calls++;
        return base(prompt);
      };
      const started = Date.now();
      const r = await writeNarrative(body, counting);
      const latencyMs = Date.now() - started;
      firstPass = r.source === "model" && calls === 1;
      rows.push({ id: c.id, source: r.source, fallbackReason: r.fallbackReason, firstPass, latencyMs, ...r.usage, narrative: r.narrative });
      console.log(`${r.source === "model" ? (firstPass ? "PASS " : "RETRY") : "TEMPL"} ${c.id.padEnd(18)} ${String(latencyMs).padStart(6)}ms ${r.usage.inputTokens} in / ${r.usage.outputTokens} out`);
    }
    const n = rows.length;
    results.push({
      model: id,
      reports: n,
      guardFirstTry: rows.filter((r) => r.firstPass).length,
      guardAfterRetry: rows.filter((r) => r.source === "model" && !r.firstPass).length,
      template: rows.filter((r) => r.source === "template").length,
      latencyMsMean: Math.round(rows.reduce((s, r) => s + r.latencyMs, 0) / n),
      inputTokens: rows.reduce((s, r) => s + r.inputTokens, 0),
      outputTokens: rows.reduce((s, r) => s + r.outputTokens, 0),
      rows,
    });
  }
  console.log("\n=== Summary ===");
  console.table(results.map(({ rows: _rows, ...s }) => s));
  const outFile = a.out ?? join(__dirname, "results", `reports-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  mkdirSync(join(outFile, ".."), { recursive: true });
  writeFileSync(outFile, JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2));
  console.log(`\nNarratives and figures written to ${outFile} (read them for usefulness).`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
