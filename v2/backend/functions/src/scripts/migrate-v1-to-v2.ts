/**
 * One-off migration: Track Expense v1 project -> v2 project.
 *
 * With a short-lived access token (no key files; see docs/wiki/migration-plan.md):
 *   MIGRATE_ACCESS_TOKEN=<token> npm run migrate -- --source-project public-exp-tracker \
 *     --target-project expense-tracker-v2-5c9fa            [--execute]
 *
 * With service-account keys:
 *   npm run migrate -- --source-key ./v1-sa.json --target-key ./v2-sa.json            # dry run (default)
 *   npm run migrate -- --source-key ./v1-sa.json --target-key ./v2-sa.json --execute  # actually write
 *
 * Keys may also come from SOURCE_SERVICE_ACCOUNT / TARGET_SERVICE_ACCOUNT.
 *
 * Copies (document ids preserved):
 *   users/{uid}
 *   homes/{homeId} + categories, categoryBudgets, tags
 *   transactions/{id}   with the v2 transform (see migrate-transform.ts)
 * Not copied: notifications (ephemeral), users/{uid}/fcmTokens (tokens belong to
 * the old project's sender), transaction embeddings (regenerated — see
 * backfill-embeddings.ts). Auth users are moved separately with
 * `firebase auth:export` / `auth:import` so uids stay the same.
 *
 * Safety:
 *  - Dry run is the default; nothing is written without --execute.
 *  - The SOURCE project is only ever read: it is reached through `ReadOnlySource`,
 *    which exposes no write method.
 *  - Refuses to run if source and target are the same project.
 */
import { cert, Credential, initializeApp } from "firebase-admin/app";
import { Firestore, getFirestore } from "firebase-admin/firestore";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { HomeTotals, summarizeByHome, totalsEqual, transformTransaction, V2Transaction } from "./migrate-transform";

interface Args {
  sourceKey: string;
  targetKey: string;
  sourceProject: string;
  targetProject: string;
  execute: boolean;
}

export function parseArgs(argv: string[]): Args {
  let sourceKey = process.env.SOURCE_SERVICE_ACCOUNT ?? "";
  let targetKey = process.env.TARGET_SERVICE_ACCOUNT ?? "";
  let sourceProject = "";
  let targetProject = "";
  let execute = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--source-key") sourceKey = argv[++i] ?? "";
    else if (a === "--target-key") targetKey = argv[++i] ?? "";
    else if (a === "--source-project") sourceProject = argv[++i] ?? "";
    else if (a === "--target-project") targetProject = argv[++i] ?? "";
    else if (a === "--execute") execute = true;
    else if (a === "--dry-run") execute = false;
    else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: npm run migrate -- --source-key <v1 key json> --target-key <v2 key json> [--execute]\n" +
          "   or: MIGRATE_ACCESS_TOKEN=<token> npm run migrate -- --source-project <v1 id> --target-project <v2 id> [--execute]",
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  const tokenMode = !!sourceProject || !!targetProject;
  if (tokenMode) {
    if (!sourceProject || !targetProject) throw new Error("Give both --source-project and --target-project.");
    if (!process.env.MIGRATE_ACCESS_TOKEN) throw new Error("--source-project/--target-project need MIGRATE_ACCESS_TOKEN.");
  } else if (!sourceKey || !targetKey) {
    throw new Error(
      "Give --source-key and --target-key (or SOURCE_SERVICE_ACCOUNT / TARGET_SERVICE_ACCOUNT), " +
        "or --source-project and --target-project with MIGRATE_ACCESS_TOKEN.",
    );
  }
  return { sourceKey, targetKey, sourceProject, targetProject, execute };
}

/**
 * Admin SDK credential backed by a short-lived OAuth access token held in
 * memory (e.g. from the signed-in Firebase CLI account). Nothing is written
 * to disk. Tokens last about an hour, which is ample for a household.
 */
export function accessTokenCredential(token: string): Credential {
  return { getAccessToken: async () => ({ access_token: token, expires_in: 3000 }) };
}

type Doc = { id: string; data: Record<string, unknown> };

/** The only handle on the v1 project. It can read; it has no way to write. */
class ReadOnlySource {
  constructor(private readonly db: Firestore) {}

  async readCollection(path: string): Promise<Doc[]> {
    const snap = await this.db.collection(path).get();
    return snap.docs.map((d) => ({ id: d.id, data: d.data() }));
  }
}

/**
 * Firestore client authenticated with an in-memory access token. The Admin
 * SDK's getFirestore() only accepts key files or default credentials, so the
 * client is built directly; the settings are passed through to google-auth.
 */
export function firestoreWithToken(projectId: string, token: string): Firestore {
  // Use the google-auth-library copy that Firestore itself depends on; a
  // different major version fails inside gRPC ("headers.forEach is not a function").
  const fromFirestore = createRequire(require.resolve("@google-cloud/firestore"));
  const { OAuth2Client } = fromFirestore("google-auth-library") as typeof import("google-auth-library");
  const authClient = new OAuth2Client();
  authClient.setCredentials({ access_token: token });
  return new Firestore({ projectId, authClient } as ConstructorParameters<typeof Firestore>[0]);
}

function openProjectWithToken(projectId: string, token: string): { db: Firestore; projectId: string } {
  return { db: firestoreWithToken(projectId, token), projectId };
}

function openProject(name: string, keyPath: string): { db: Firestore; projectId: string } {
  const key = JSON.parse(readFileSync(resolve(keyPath), "utf8")) as { project_id?: string };
  if (!key.project_id) throw new Error(`${keyPath} is not a service account key (no project_id).`);
  const app = initializeApp({ credential: cert(resolve(keyPath)), projectId: key.project_id }, name);
  return { db: getFirestore(app), projectId: key.project_id };
}

const HOME_SUBCOLLECTIONS = ["categories", "categoryBudgets", "tags"] as const;
const inr = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function printComparison(title: string, left: Map<string, HomeTotals>, right: Map<string, HomeTotals>, labels: [string, string]): boolean {
  console.log(`\n${title}`);
  let allMatch = true;
  const rows = [...new Set([...left.keys(), ...right.keys()])].sort().map((homeId) => {
    const a = left.get(homeId);
    const b = right.get(homeId);
    const match = totalsEqual(a, b);
    if (!match) allMatch = false;
    return {
      home: homeId,
      [`${labels[0]} count`]: a?.count ?? 0,
      [`${labels[1]} count`]: b?.count ?? 0,
      [`${labels[0]} income`]: inr(a?.income ?? 0),
      [`${labels[1]} income`]: inr(b?.income ?? 0),
      [`${labels[0]} expense`]: inr(a?.expense ?? 0),
      [`${labels[1]} expense`]: inr(b?.expense ?? 0),
      match: match ? "yes" : "NO",
    };
  });
  console.table(rows);
  return allMatch;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const token = process.env.MIGRATE_ACCESS_TOKEN ?? "";
  const sourceProject = args.sourceProject
    ? openProjectWithToken(args.sourceProject, token)
    : openProject("source", args.sourceKey);
  const targetProject = args.targetProject
    ? openProjectWithToken(args.targetProject, token)
    : openProject("target", args.targetKey);
  if (sourceProject.projectId === targetProject.projectId) {
    throw new Error(`Source and target are the same project (${sourceProject.projectId}). Refusing to run.`);
  }
  const source = new ReadOnlySource(sourceProject.db);
  const target = targetProject.db;

  console.log(`Source (read only): ${sourceProject.projectId}`);
  console.log(`Target:             ${targetProject.projectId}`);
  console.log(args.execute ? "Mode: EXECUTE — the target will be written." : "Mode: DRY RUN — nothing will be written. Pass --execute to write.");

  // ---- read v1
  const [users, homes, v1Transactions] = await Promise.all([
    source.readCollection("users"),
    source.readCollection("homes"),
    source.readCollection("transactions"),
  ]);
  const subcollections: { path: string; docs: Doc[] }[] = [];
  for (const home of homes) {
    for (const sub of HOME_SUBCOLLECTIONS) {
      const path = `homes/${home.id}/${sub}`;
      subcollections.push({ path, docs: await source.readCollection(path) });
    }
  }

  // ---- transform
  const transformed: { id: string; doc: V2Transaction }[] = [];
  const skipped: { id: string; reason: string }[] = [];
  for (const t of v1Transactions) {
    const r = transformTransaction(t.data);
    if (r.ok) transformed.push({ id: t.id, doc: r.doc });
    else skipped.push({ id: t.id, reason: r.reason });
  }

  console.log(`\nusers: ${users.length}   homes: ${homes.length}   transactions: ${v1Transactions.length}`);
  for (const s of subcollections) console.log(`  ${s.path}: ${s.docs.length}`);
  if (skipped.length) {
    console.log(`\n${skipped.length} transaction(s) cannot be migrated and will be skipped:`);
    skipped.forEach((s) => console.log(`  ${s.id}: ${s.reason}`));
  }

  const sourceTotals = summarizeByHome(v1Transactions.map((t) => t.data));
  const plannedTotals = summarizeByHome(transformed.map((t) => t.doc));
  const plannedOk = printComparison("Per home: source (v1) vs transformed (what would be written)", sourceTotals, plannedTotals, ["source", "planned"]);

  const readTargetTotals = async () =>
    summarizeByHome((await target.collection("transactions").select("homeId", "type", "amount").get()).docs.map((d) => d.data()));
  printComparison("Per home: source (v1) vs target (current contents)", sourceTotals, await readTargetTotals(), ["source", "target"]);

  if (!args.execute) {
    console.log(`\nDry run complete. ${plannedOk ? "Transformed data matches the source." : "MISMATCH between source and transformed data — investigate before executing."}`);
    return;
  }

  // ---- write v2 (target only)
  const writer = target.bulkWriter();
  let failures = 0;
  writer.onWriteError((err) => {
    if (err.failedAttempts < 5) return true;
    failures++;
    console.error(`Write failed: ${err.documentRef.path} (${err.code})`);
    return false;
  });
  for (const u of users) void writer.set(target.collection("users").doc(u.id), u.data);
  for (const h of homes) void writer.set(target.collection("homes").doc(h.id), h.data);
  for (const s of subcollections) {
    for (const d of s.docs) void writer.set(target.collection(s.path).doc(d.id), d.data);
  }
  for (const t of transformed) void writer.set(target.collection("transactions").doc(t.id), t.doc);
  await writer.close();

  const ok = printComparison("After migration — per home: source (v1) vs target", sourceTotals, await readTargetTotals(), ["source", "target"]);
  if (failures > 0 || !ok || skipped.length > 0) {
    console.error(`\nMigration finished with problems: ${failures} failed write(s), ${skipped.length} skipped transaction(s), totals ${ok ? "match" : "DO NOT match"}.`);
    process.exitCode = 1;
  } else {
    console.log("\nMigration complete: counts and sums match for every home.");
  }
}

if (require.main === module) main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
