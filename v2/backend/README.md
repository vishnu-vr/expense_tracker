# Track Expense v2 — Firebase backend

Cloud Functions (TypeScript, Node 22), Firestore rules and indexes for the Flutter rebuild.
Data model and callable contracts: [`SCHEMA.md`](SCHEMA.md).

The default project is the emulator-only `demo-track-expense` (the `demo-` prefix means
the Firebase CLI never contacts a real project). The live project is the `prod` alias,
`expense-tracker-v2-5c9fa` (asia-south1); pass `--project prod` explicitly to deploy.
Deploy steps, the live smoke test (`scripts/smoke-live.mjs`) and troubleshooting are in
[`../docs/wiki/operations.md`](../docs/wiki/operations.md).

## Layout

```
firebase.json            functions + firestore + emulators
.firebaserc              default project: demo-track-expense
firestore.rules          schema v2 security rules
firestore.indexes.json   composite + vector indexes
SCHEMA.md                data model, blocks, callables
functions/
  src/index.ts           function exports (thin wrappers)
  src/config.ts          model ids, embedding model, limits — the one place to change them
  src/core/              PURE logic (no Firebase, no Genkit): query, compare, budget, recurring,
                         anomalies, insights/detectors, blocks, proposals, merchant dictionary, …
  src/agent/             Genkit agent: tools, system prompt, loop, provider/model resolution
  src/data/              Firestore access (home resolution, loading, vector search)
  src/handlers/          one file per callable / trigger
  src/scripts/           migrate-v1-to-v2.ts, backfill-embeddings.ts (never run automatically)
  eval/                  fixture household, golden questions, scoring, runner
  test/unit/             no emulator needed
  test/rules/            security rules (Firestore emulator)
  test/integration/      handlers against the Firestore emulator (models / FCM faked)
```

## Run

```bash
cd functions
npm install
npm run build            # tsc, strict
npm run typecheck        # also type-checks tests and eval
npm test                 # unit tests

# Rules + handler integration tests (starts the Firestore emulator; needs Java)
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
npm run test:rules:emulator
# equivalent: cd .. && firebase emulators:exec --only firestore --project demo-track-expense "npm --prefix functions run test:rules"

# All emulators for the app to talk to (auth 9099, firestore 8080, functions 5001, UI 4000)
cd .. && firebase emulators:start --project demo-track-expense
```

In the emulators the triggers and callables work end to end; anything that calls a model
(askAgent, embeddings) needs Vertex AI credentials and fails cleanly without them
(askAgent returns `internal`, embedding failures are logged and do not block the notification).
The scheduled `generateInsights` function is not started by the emulator suite (no Pub/Sub emulator configured).

## Functions

| export | type | what it does |
|---|---|---|
| `joinHome` | callable | Join a home by invite code. |
| `leaveHome` | callable | Leave the current home; hands ownership to the first remaining member if the owner leaves. |
| `exportTransactionsCsv` | callable | CSV of the caller's household for a local-day range. |
| `askAgent` | streaming callable | The insights agent (below). |
| `confirmProposal` | callable | Apply or reject a change the agent proposed. |
| `onTransactionWritten` | Firestore trigger | (a) writes the household `notifications` doc, (b) keeps `transactionEmbeddings/{txId}` in step. |
| `onNotificationCreated` | Firestore trigger | FCM push to the other members; deletes dead tokens. |
| `generateInsights` | schedule, daily 06:00 | Runs the detectors for every home and upserts cards in `homes/{id}/insights`. |

Error codes used by callables: `unauthenticated`, `invalid-argument`, `failed-precondition`
(user has no home / proposal already resolved or no longer valid), `permission-denied`
(not a member of the home their profile points at / no entry in a proposal is theirs),
`not-found` (invite code; a thread or proposal that is missing or was started by another member, D-025), `internal` (model failure).

## The agent

- **Principle: the model never does arithmetic.** Tools in `src/core/` compute every number and
  return it together with a ready-to-quote `…Display` string (INR, Indian grouping). The system
  prompt (`src/agent/prompt.ts`) tells the model to quote those verbatim and to say when data is missing.
- **Household scoping:** the home is resolved from the caller's uid (`users/{uid}.homeId`, then verified
  against `homes/{homeId}.memberIds`). No tool takes a home id.
- **Tools:** `query_transactions`, `compare_periods`, `budget_status`, `recurring_bills`, `find_anomalies`,
  `search_notes`, `list_categories`, `list_tags`, `list_members`, and the proposal tools
  `propose_set_budget`, `propose_tag_transactions`, `propose_recategorise`.
- **Writes are proposals.** A `propose_*` tool stores `aiThreads/{t}/proposals/{id}` with status `pending`
  and nothing else. `confirmProposal` applies it, enforcing the same rules as `firestore.rules`
  (member of the home; only your own transactions).
- **Answer format:** the model finishes by calling a `respond` tool with blocks. Blocks are validated
  (`src/core/blocks.ts`); transaction and proposal blocks are filled in by the server from ids, so the
  model cannot invent rows. Anything invalid falls back to a single text block.
- **Streaming:** `status` chunks are sent live as each tool starts. `text` chunks are the final text blocks
  sent in small pieces after validation (they are not raw model tokens). Treat the streamed text as a
  preview and render the returned `blocks` when the call completes.
- **Threads:** `threadId` omitted → new thread. With `threadId`, the last 20 messages (≤ 12k characters)
  are replayed as history.

### Switching model / provider

Set `AGENT_MODEL` in `functions/.env` (see `.env.example`):

```
AGENT_MODEL=vertexai/gemini-3.8-flash            # default — Gemini on Vertex AI
AGENT_MODEL=vertex-model-garden/claude-sonnet-5  # Claude via Vertex Model Garden
AGENT_MODEL=googleai/gemini-3.8-flash            # Gemini Developer API (GEMINI_API_KEY), handy for local evals
```

Tools, prompt and block handling are identical for every provider (`src/agent/models.ts` is the only
provider-aware file). For Claude: enable the model in Vertex AI Model Garden for the project and set
`MODEL_GARDEN_LOCATION` to a region that serves it.

The embedding model is the constant `EMBEDDING_MODEL` in `src/config.ts` (`gemini-embedding-001`, 768
dimensions). Changing it means re-embedding (`src/scripts/backfill-embeddings.ts`) and, if the dimension
changes, updating `firestore.indexes.json`.

## Evaluation

```bash
cd functions
npm run eval -- --model vertexai/gemini-3.8-flash
npm run eval -- --model vertexai/gemini-3.8-flash,vertex-model-garden/claude-sonnet-5   # compare
npm run eval -- --model googleai/gemini-3.8-flash --only spend_oct,goa_trip --verbose
```

Runs 35 golden questions against a deterministic fixture household (`eval/fixture.ts`: 2 members,
March–10 November 2026, budgets, recurring bills, a planted anomaly and duplicate). Tools are backed by
in-memory fixture data — no Firestore. Scoring is deterministic (expected numbers must appear in the
answer; proposals must be stored with the right parameters). Reports per-question pass/fail, numeric
accuracy (exact and rounded), latency (mean/p50/p95) and token usage, and writes JSON to `eval/results/`.

Needs model credentials: Vertex AI (`gcloud auth application-default login` or
`GOOGLE_APPLICATION_CREDENTIALS`, plus `GOOGLE_CLOUD_PROJECT`) or `GEMINI_API_KEY` for `googleai/…`.
Without them it exits with code 2 and says what is missing. The expected numbers themselves are verified
without any model by `test/unit/golden.test.ts`.

## Migration (v1 project → v2 project)

```bash
cd functions
npm run migrate -- --source-key <v1-service-account.json> --target-key <v2-service-account.json>            # dry run (default)
npm run migrate -- --source-key <v1-service-account.json> --target-key <v2-service-account.json> --execute
```

Copies `users`, `homes` (+ `categories`, `categoryBudgets`, `tags`) and `transactions` with document ids
preserved; transactions get the v2 transform (ISO `date` → Timestamp, `accountId` and `embedding` dropped,
`tagIds` defaulted). The dry run prints per-home counts and income/expense sums for source vs
transformed and source vs target. The source project is only read. Not copied: notifications, FCM
tokens, embeddings. Auth users: `firebase auth:export` / `auth:import` (keeps uids).

Order for a real cutover: deploy rules/indexes/functions to the new project → import Auth → run the
migration. Migrated transactions keep their old `createdAt`, so the trigger sends no notifications for
them but does create their embeddings (or run `src/scripts/backfill-embeddings.ts` afterwards).

## Before the first deploy (not done here)

- Add the real project to `.firebaserc`; enable Vertex AI; grant the functions service account Vertex AI User.
- Create the vector index (it is in `firestore.indexes.json`; `firebase deploy --only firestore:indexes`).
- Run the eval with real credentials and confirm the model ids / locations in `.env`.
- Turn on `ENFORCE_APP_CHECK` once the apps ship App Check.
