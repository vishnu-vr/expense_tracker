# Decision log

Every decision that shapes Track Expense v2, newest first. Each entry says who
decided, why, and what it rules out. Before changing anything listed here,
add a new entry that supersedes the old one; do not silently edit history.

Status values: **Accepted** (in force), **Superseded** (replaced by a later
entry), **Proposed** (not yet agreed).

---

## D-030 · SMS auto-add asks a human: notification questions, payee memory, evening catch-up
**2026-11-17 · Accepted · owner request · experimental · refines D-029**

Many UPI payments go to people (an auto driver's phone-number UPI id), so
neither rules nor AI can know what they were for. Auto-add now asks.
- **Ask in the notification.** A payment that goes to the review list posts
  "₹150 to Ramesh K — what was this for?" (lock screen: "A payment to
  describe") with up to two category buttons and **Reply** (RemoteInput),
  when the phone can save natively (signed in to the real project, an amount).
  Otherwise the old "Review detected entry" link stays.
  - **Buttons** come from quick suggestions Dart computes and exports in the
    table (`buildQuickSuggestions`): for every amount band (<100, 100–300,
    300–1k, 1k–3k, 3k–10k, 10k+) × day-part (5–11, 11–16, 16–21, 21–5) the
    household's categories score 3 for the same band and part, 2 for the same
    band, 1 for the neighbouring band at the same part; gaps are filled from
    the most-used categories (starter list food/grocery/transportation for a
    new household). The item's own guess (e.g. built-in, money not clearly
    moved) goes first. One tap saves through the same native write as
    auto-add (`SmsEntryWriter`, `source: "sms"`, note "Ramesh K · HDFC
    XX1234"), removes the item and turns the notification into "Added … ·
    Undo · Change".
  - **Reply.** The words become the note, first: "auto to office · Ramesh
    K" (payee, or the account when there is no payee; `smsNote` /
    `SmsNote.compose`). The category is guessed from the words without Nano
    (it cannot run in the background, D-029): each word votes through the
    household's own note words (`buildWordCategories`: 2+ notes, 80% in one
    category, stop words and digits skipped), else a built-in keyword list
    (`builtinKeywordCategories`, expense only, only for categories the
    household has); the whole text also votes through the merchant
    dictionary. Saved only when all votes agree; otherwise the notification
    becomes "Which category for 'gift for amma'?" with the voted (then
    suggested) categories, and the item keeps the words so the review list
    shows them prefilled. Ignoring it leaves the item in the list as before.
- **Payee memory (on the phone only).** Labelling a payment (button, reply,
  a chip or the form from the review list) stores `hash → {category, type,
  last words, time, entry id}` in SharedPreferences `sms_detection`. The key
  is the first 32 hex characters of SHA-256(salt | normalised payee): `tel:`
  + the last 10 digits of a phone-number UPI handle, `vpa:` + a named UPI
  address, or `name:` + the merchant key. The salt is 16 random bytes made
  once per install. `SmsReceiver` hashes the payee before anything is
  queued, so phone numbers never reach WorkManager, the review list or the
  memory; they are shown as "UPI xxxxx1234" (the parser used to drop such
  payees). The next payment to a remembered payee is saved with that
  category and words when auto-add is on, ahead of history and built-ins
  (still needs money moved, an amount, a valid category and a signed-in
  phone). Editing an SMS entry in the app updates the memory (the phone keeps
  entry id → payee hash for 90 days, at most 300); Undo drops the memory
  that entry created; **Forget remembered payees** on the SMS screen clears
  it. At most 500 payees.
- **Evening catch-up.** A daily WorkManager job at about 20:30 local time
  (one unique job per evening, rescheduled by itself and whenever the SMS
  screen opens) posts "3 payments need a description", opening
  `/sms/review`, when detection, auto-add and the reminder are on, it runs
  between 20:00 and 23:00, nothing was shown that day, and the list has items
  with an amount from the last 7 days. **Evening reminder** toggle on the SMS
  screen, on by default.
- **Review list.** Each item has a note field (prefilled with reply words)
  and up to three category chips (its own guess, then the same quick
  suggestions) plus "Other…" for the form: one tap or a few words.
- **Gemini Nano status.** Profile shows why it is not available: available,
  downloadable, waiting for Wi-Fi, downloading, not supported (with the
  "Android AICore" version or "AICore not installed"), AICore needs an update
  (`NEEDS_SYSTEM_UPDATE`, `AICORE_INCOMPATIBLE`, AICore 601), still setting up
  (AICore 606), no space, busy (`BUSY`, quota, background), Android too old,
  or error with a numeric code, never an exception message. "Check again"
  re-checks. Per the ML Kit GenAI device list (checked 2026-11-17) the Prompt
  API supports Samsung from the Galaxy S25 series on; the S24 series is not
  listed, so "Not supported on this phone yet" is expected there.
  `genai-prompt` 1.0.0-beta5 is still the latest.
- **Privacy.** Unchanged for messages. The table now also carries single
  note words the household uses consistently (not whole notes), on the phone
  only. Typed reply words are kept only in the review item until saved, and
  never logged.
- Rules out: storing phone numbers or raw UPI ids, cloud or background AI for
  replies, syncing payee memory between phones (each phone learns its own;
  the household's history still syncs through entries).

---

## D-029 · SMS auto-add: native worker, rules + history first, Nano only suggests, review list
**2026-11-17 · Accepted · owner request · experimental · refines D-005**

Profile › Bank SMS detection gains **Auto-add confident entries** (off by
default; needs detection on). With it off, D-005 is unchanged: "Add this
entry?" and a prefilled form.
- **Flow.** `SmsReceiver` parses the message on the phone
  (`SmsParser.parseDetails`: amount, direction, payee, bank from the sender id,
  account/card last digits, reference number) and drops promotions, reminders
  ("is due", "will be debited"), payment requests, declined/failed messages and
  OTPs. Repeats are dropped for 7 days by the SHA-256 of the UPI/reference
  number or a fingerprint of bank, account, amount, direction and minute
  (`SeenLog`). The parsed fields go to an expedited WorkManager job
  (`SmsAutoAddWorker`); the receiver itself has about 10 s.
- **Confidence rule.** An entry is saved on its own only when the message says
  money moved (debited, spent, sent, credited…), it has an amount and a payee,
  and the payee's category comes from (1) the household's history, where a
  merchant is known when at least 2 entries of that direction carry it and at
  least 80% of them share one category (counted for the note's merchant part
  and for the dictionary merchant it names, `buildCategoryTable`), or (2) the
  built-in map (`builtinMerchantCategories`, one default category per
  `merchant_dictionary.dart` merchant; payment apps have none). The category
  must exist and fit the direction, and the phone must be signed in to the
  real project. Everything else goes to **Review detected entries**
  (SharedPreferences, parsed fields only, at most 100 items, 30 days) with
  any category it found preselected. Corrections improve the history because
  the table is rebuilt from saved entries.
- **Dart decides, Kotlin looks up.** The rule lives in pure Dart
  (`core/domain/sms_categories.dart`). The app pushes the table (homeId, uid,
  known merchants, built-in patterns, categories, Firebase client ids) over
  `track_expense/sms` 2 s after entries change and clears it on sign-out.
  `merchantKey()` is implemented on both sides and tested against one shared
  fixture (`app/test/fixtures/merchant_key_vectors.json`).
- **Native write.** The worker uses the native Firebase Auth and Firestore
  SDKs (BoM 35.1.0, the version FlutterFire's plugins resolve to) on the same
  default app: if the process was started by the SMS, the default app is
  created from the pushed options, which FlutterFire then reuses. Firestore is
  left on default settings, because FlutterFire's own (also default) settings
  are only accepted after start when equal. Writes are queued offline like the
  app's. Before writing it checks for the same user, direction and amount
  within ±15 minutes (`homeId` + `date` range, the existing index). The entry
  is the app's normal shape plus `source: "sms"`, note `Swiggy · HDFC XX1234`.
  Demo and emulator builds push no Firebase ids, so they only use the review
  list. If App Check is ever enforced on Firestore, the worker would need its
  own App Check provider first.
- **Notifications** are private on the lock screen ("Entry added from a bank
  message" / "A bank message to review"). "Added ₹1,499 expense · Swiggy →
  Food" has **Undo** (deletes the entry; owner delete is already allowed) and
  **Change** (`trackexpense://app/edit/<id>`). Review opens `/sms/review`; Home
  shows "N detected entries to review".
- **Gemini Nano** (ML Kit GenAI Prompt API `com.google.mlkit:genai-prompt:1.0.0-beta5`)
  is integrated, but AICore runs inference only for the top foreground app
  (`BACKGROUND_USE_BLOCKED`), so it cannot run in the worker. Instead, when the
  review list opens, Nano suggests a category for up to 5 entries the rules
  could not place (prompt: payee, direction, category ids; answer accepted only
  if it is one listed id of that direction; 5 s timeout). It never saves on its
  own. The library needs Android 8.0 (the app's minSdk is 24): it is merged
  with `tools:overrideLibrary` and only called on API 26+. The model downloads
  only on an unmetered network. Profile shows its status (precise reasons
  since D-030).
- **Privacy (unchanged from D-005).** The message text is never stored,
  logged, uploaded or passed to the worker; the reference number is kept only
  as a hash. Nano runs on the phone.
- **Rules.** `validTransaction` accepts an optional `source` that must be
  `'sms'`. The live rules have no field allowlist, so they already accept it;
  the stricter local rule is not deployed yet.
- Parser templates are written from the common public formats of HDFC, ICICI,
  SBI, Axis, Kotak and generic UPI wording; no real messages were available.
- Rules out: a headless Flutter engine in the background (heavier, less
  reliable), sending message text to the server or a cloud model, letting an
  uncalibrated model save entries, and SMS on iOS.

---

## D-028 · Voice mode uses on-device speech around askAgent
**2026-11-15 · Accepted · owner request**

Ask has a **Talk** mode: tap the mic beside Send and talk hands-free. The
phone's own speech recognition (`speech_to_text`) and text-to-speech
(`flutter_tts`) wrap the existing `askAgent`, so tools, threads, usage and
the model choice (D-027) are unchanged, there is no new paid service, and a
spoken question costs what a typed one does (plus about 100 prompt tokens).
The loop is listen → answer aloud → listen again; it ends on a stop phrase
("stop", "that's all", "bye", "നിർത്തൂ", "മതി"…, checked on the phone and
never sent), about 8 s of silence, End, or the app going to the background.
A tap interrupts an answer; a tap while listening pauses so the transcript
can be fixed. `askAgent` gains two optional, allowlisted fields: `reply`
(`text` default, `voice`) and `language` (`en` default, `ml`). Voice mode
asks the model for a 1–2 sentence spoken answer as the first text block;
Malayalam asks for Malayalam script with amounts kept as digits. Figures
still come only from tools (D-011). The app speaks that first block (at most
two sentences), points to bars/entries ("The details are on screen."),
describes proposals and says to tap Confirm — **proposals are confirmed only
by tapping, never by voice**. With Hide amounts on, no sentence containing a
figure is spoken ("Amounts are hidden, the answer is on screen."). Voice
language (English (India) `en-IN` or Malayalam `ml-IN`) is a per-device
setting (SharedPreferences `voiceLanguage`) in Profile › Assistant; when the
phone lacks Malayalam recognition or a Malayalam voice, English is used with
a note. Recognition prefers on-device for English; otherwise (and usually for
Malayalam) the phone's recogniser may send audio to Google or Apple.
Transcripts are never logged; only the final text is sent, as a normal
question. Screens use a `VoiceService` interface (`core/data/voice.dart`);
the device implementation is wired in `backend.dart`, demo mode and tests use
`FakeVoiceService`. Rules out: a cloud speech API or audio model (cost, new
data flow), voice confirmation of changes, and sentence-by-sentence streamed
speech (later improvement).

---

## D-027 · Users choose the assistant model from a server allowlist
**2026-11-15 · Accepted · owner request**

Each member picks the assistant model in Profile › Assistant: **Gemini
Flash** (`vertexai/gemini-3.8-flash`, the default, best answers) or **Gemini
Flash-Lite** (`vertexai/gemini-3.5-flash-lite`, cheaper). The choice is a
per-device setting (SharedPreferences `agentModel`) sent with each question
as the optional `model` key of `askAgent`. The app sends a **key**, never a
model id: the server maps keys to ids through `AGENT_MODEL_CHOICES` in
`src/config.ts` (`resolveAgentModel`), so providers stay swappable on the
server without an app release (as in D-007). The default key, a missing key
and an unknown key all give the configured default (`AGENT_MODEL`), so older
apps and retired choices keep working; a malformed value is
`invalid-argument`. Usage already records the model actually used (message
`usage.model`, thread `lastModel`, the `askAgent complete` log). No monthly
cap for now. Why: about ₹50 of Gemini cost in a month against a ₹100 budget,
most of it from eval runs. Published Vertex prices (global, per 1M tokens,
checked 2026-11-15): Flash $0.75 in / $3.75 out until 31 Dec 2026, then
$1.50 / $7.50; Flash-Lite $0.30 / $2.50. Rules out: letting the app send raw
model ids, and choosing the model per household.

---

## D-026 · Admin dashboard shows entries per household
**2026-11-14 · Accepted · owner request**

The admin Billing & usage screen has a Households section: number of
households, households active this month, entries this month and in total,
and per household its name, member count, entries this month and in total,
and the date of the latest entry. It is computed live with Firestore
`count()` aggregations (cheap at this scale) rather than a rollup. Counts and
dates only: amounts, notes and other entry content are never read for it.

---

## D-025 · Past conversations are personal, with usage counted per thread
**2026-11-14 · Accepted · owner**

The owner asked for a past-conversations area and per-thread usage visible
to the user and the admin.
- **Personal threads.** A thread, its messages and its proposals are readable
  only by its `createdBy` member (still home-scoped); housemates and
  outsiders get nothing. `askAgent` and `confirmProposal` treat another
  member's thread or proposal as `not-found`. This supersedes the earlier
  "any home member reads aiThreads" rule. Questions can mention personal
  matters, and nothing in the app needed shared threads.
- **Usage written by the server** in the same batch as the answer: the
  assistant message gets `usage {inputTokens, outputTokens, modelCalls,
  model, latencyMs}`; the thread gets `FieldValue.increment` totals in
  `usage {questions, inputTokens, outputTokens, modelCalls}`, plus
  `lastModel` and an 80-character `lastMessagePreview`. Failed answers are
  not counted. Pure helpers in `functions/src/core/ai-usage.ts` (D-011).
- **Monthly rollup** `aiUsage/{YYYY-MM}_{homeId}` (India-time month),
  server-only (rules deny all client access). `getAdminDashboard` reads it
  for its `assistant` section: totals, active households, and per household
  name + counts sorted by tokens. The admin never sees thread titles or
  message text; the rollup holds counts only.
- App: Ask › history button opens `/ask/history`; a thread opens with
  `/ask?thread=<id>` and continues there. Proposals already resolved show
  their outcome instead of Confirm.
- Rules out for now: sharing a thread with the household, deleting or
  renaming threads from the app, and per-user (rather than per-household)
  usage in the admin view.

---

## D-024 · Admin billing and usage dashboard inside the app
**2026-11-14 · Accepted · owner**

One admin-only screen (Profile › Admin › Billing & usage) shows what the
project costs to run, month by month, plus the usage behind it.
- **Costs** come only from the Cloud Billing export to BigQuery (dataset
  `billing_export`, US multi-region, so it backfills from the start of the
  previous month). The callable `getAdminDashboard` queries the
  `gcp_billing_export_v1_*` tables for the project and invoice month: totals,
  credits, services, top SKUs, daily cost (India time) and the previous month.
- **Usage** comes from Cloud Monitoring: Vertex AI tokens per model, Firestore
  reads/writes/deletes, Cloud Run requests per function (assistant questions =
  `askagent` requests). Monitoring keeps about six weeks, so older months show
  "Usage not available".
- **Admin** is the custom claim `admin: true`, set with
  `npm run set-admin` (in-memory token, no key files, preview by default). The
  app hides the screen without it; the callable rejects non-admins with
  `permission-denied`.
- All numbers (net = gross + credits, month-end forecast = daily average ×
  days in month, change vs last month, "Other" grouping) come from
  `backend/functions/src/core/billing.ts`, unit-tested (D-011). Billing and
  usage are read independently, so one failing does not hide the other.
  Results are cached in memory for 15 minutes per month.
- REST through the `google-auth-library` already installed with
  firebase-admin (dynamic import, like `agent/models.ts`); no new packages.
- Rules out for now: manually entered fixed costs, budget alerts, and a
  separate web dashboard.

---

## D-023 · v1 data migrated from `public-exp-tracker`
**2026-11-14 · Accepted · owner go-ahead**

9 accounts, 6 households and 2,795 entries copied; every household's counts
and sums match; embeddings rebuilt. v1 left untouched as the fallback.
Details and re-run steps: [migration-plan.md](migration-plan.md).
- The migration and backfill scripts authenticate with an in-memory access
  token (`MIGRATE_ACCESS_TOKEN`, `BACKFILL_ACCESS_TOKEN`). The Admin SDK's
  `getFirestore()` refuses non-key credentials, so the scripts build the
  Firestore client directly with an OAuth client from Firestore's own copy of
  `google-auth-library` (a different major version fails inside gRPC).
- Incident: during the first Auth import attempt the v1 password-hash signer
  key was printed to the assistant's terminal output (a zsh word-splitting
  mistake). It was not written to the repo or any file. Firebase does not let
  a project rotate it; the exposure only matters together with the password
  hashes, which were deleted.

---

## D-022 · Claude needs a Vertex AI quota increase before it can be compared
**2026-11-14 · Accepted · waiting on the owner**

Claude is enabled in Model Garden, but every request (`claude-sonnet-5` on
`global` and `us-east5`) returns 429 "Quota exceeded … Please submit a quota
increase request". New projects start with no Claude quota. Until the owner
files the increase, the agent stays on Gemini. When quota arrives, check which
location answers and set `MODEL_GARDEN_LOCATION` to it (`global` is listed on
the pricing page).

## D-021 · The eval runs from compiled CommonJS, with an in-memory token
**2026-11-14 · Accepted**

- `npm run eval` compiles `src` + `eval` to `lib-eval/` (`tsconfig.eval.json`)
  and runs it with Node, exactly like the deployed functions. Through `tsx`,
  the lazily imported model plugin loads an ESM copy of Genkit next to the CJS
  one and every call fails with "Unknown action type returned from plugin".
- Without `gcloud`, credentials come from `EVAL_ACCESS_TOKEN`: a short-lived
  access token for the signed-in Firebase CLI account, held in memory and
  passed to the plugin via `useAccessTokenForVertex` (eval only; deployed
  functions use their service account). Writing the CLI's refresh token to a
  credentials file was rejected as too risky.

## D-020 · gemini-3.8-flash is the agent model for now
**2026-11-14 · Accepted · on eval results**

First real eval: **35/35 questions passed, 100% of figures exact**. Mean
latency 9.7 s (median 7.9 s, p95 15.6 s), about 6,600 input and 210 output
tokens per question, 2.3 model calls per question. Claude comparison is
pending (D-022). Re-run the eval after any change to the prompt, tools or model.

## D-019 · Callable functions need a public invoker binding
**2026-11-14 · Accepted · found during the first deploy**

Firebase callable functions run on Cloud Run and must allow `allUsers` to
invoke them; each function checks the caller's Firebase sign-in itself. The
first deploy failed half-way, and the retry updated the functions without
adding that binding, so every callable answered HTTP 401.
- **Fixed 2026-11-14** with the owner's go-ahead: `allUsers` → `roles/run.invoker`
  set on each callable's Cloud Run service. The change takes about a minute to
  apply. If a callable is ever recreated by hand and 401s again, see
  [operations.md › Callables return 401](operations.md#callables-return-401).
- `askAgent`, `joinHome`, `leaveHome`, `confirmProposal`, `exportTransactionsCsv`
  are affected. Triggers and the schedule are not.

## D-018 · Vertex AI location is `global`
**2026-11-14 · Accepted**

`gemini-3.8-flash` (and `gemini-3.5-flash`) answer only on the `global`
Vertex AI location for this project; `us-central1` returns 404. Embeddings
(`gemini-embedding-001`) work on both. `VERTEX_LOCATION=global` in
`backend/functions/.env.expense-tracker-v2-5c9fa`, and it is the code default.
Model Garden (Claude) keeps its own `MODEL_GARDEN_LOCATION`.

## D-017 · Everything runs in `asia-south1` (Mumbai)
**2026-11-14 · Accepted**

- Firestore `(default)` database: `asia-south1`, matching both v1 projects.
  This cannot be changed later.
- Cloud Functions: `asia-south1`. Firestore triggers must run in the database
  region, and keeping callables there avoids cross-region latency.
- The app's `_functionsRegion` (`app/lib/app/backend.dart`) must equal
  `REGION` (`backend/functions/src/config.ts`).

## D-016 · New Firebase project `expense-tracker-v2-5c9fa`
**2026-11-14 · Accepted · owner**

Created by the owner on the Blaze plan. Vertex AI, Firestore and the build
services are enabled. The `.firebaserc` alias is `prod`; `default` stays the
emulator-only `demo-track-expense` so a bare `firebase` command can never
touch production.

## D-015 · Function settings file is committed
**2026-11-14 · Accepted**

`backend/functions/.env.expense-tracker-v2-5c9fa` holds model ids, locations
and flags only, never secrets, and is committed so a deploy is reproducible.
Secrets, if ever needed, go in Secret Manager (`defineSecret`).

## D-014 · Package lock is generated with npm 10
**2026-11-14 · Accepted**

Cloud Build uses npm 10 (Node 22). A lock written by npm 11 (local Node 24)
omits optional peer packages and makes `npm ci` fail in the cloud. After
changing dependencies run `npx npm@10 install --package-lock-only` in
`backend/functions`.

## D-013 · Notifications and embeddings are server-written
**2026-11-10 · Accepted**

The `onTransactionWritten` trigger writes household notifications and keeps
`transactionEmbeddings/{txId}` in step. Clients can only add their own uid to
`readBy`; clients can never read vectors. This keeps 768 floats per entry off
phones and stops clients forging activity.
- A new entry whose `createdAt` is more than 24 hours old is treated as an
  import and sends no notification (avoids push spam during migration).

## D-012 · Leaving a household is a server call
**2026-11-10 · Accepted**

Rules let only the owner edit a home, so a member cannot remove themselves
from `memberIds`. `leaveHome` does it in a transaction and hands ownership to
the first remaining member when the owner leaves. The last member leaving
keeps the home and its data (nothing is deleted).

## D-011 · The assistant never does arithmetic
**2026-11-10 · Accepted**

The model plans and explains; every number comes from a tool that computes
it in code (`backend/functions/src/core`). Tools return ready-to-quote
`…Display` strings. The model answers through a final `respond` tool with
typed blocks (`text`, `stat`, `bars`, `transactions`, `proposal`), validated
server-side and rendered natively by the app.
- Write actions are proposals only. Nothing changes until a member taps
  Confirm, and `confirmProposal` only changes the confirmer's own entries.
- Rejected alternative: free-form markdown answers with numbers computed by
  the model. The v1 assistant did this and got sums wrong.

## D-010 · Agent model is configurable; Gemini first, Claude compared later
**2026-11-10 · Accepted · owner chose "keep it swappable"**

Genkit is the swap layer. `AGENT_MODEL` picks the model:
`vertexai/gemini-3.8-flash` (default), `vertex-model-garden/claude-…`, or
`googleai/…` for evals with an API key. The choice between Gemini and Claude
is made on the eval harness (35 golden questions with exact answers), not on
taste. Claude needs the owner to accept its terms in Model Garden first.

## D-009 · Embeddings: what goes in, what stays out
**2026-11-10 · Accepted**

Embedded text is `note | category name | matched merchant | tag names`.
Amounts, dates and income/expense stay structured filters, because vectors
are bad at them. Model `gemini-embedding-001`, 768 dimensions
(`text-embedding-004` retires 1 April 2027). Entries without a note get no
vector. Used for semantic note search only (later: categorisation).
- The on-device MiniLM model from v1 is dropped; rule-based note grouping is
  ported to Dart (`app/lib/core/domain/note_grouping.dart`).

## D-008 · Schema v2 changes
**2026-11-10 · Accepted**

- `transactions.date` is a Firestore `Timestamp` (was an ISO string).
- `accountId` and the on-document `embedding` are dropped.
- New: `aiThreads` (+ `messages`, `proposals`) and `insights` under each home.
- Full contract: [`backend/SCHEMA.md`](../../backend/SCHEMA.md).

## D-007 · Proactive insights are deterministic
**2026-11-10 · Accepted**

The daily `generateInsights` job (06:00 Asia/Kolkata) runs detectors in code:
month review, subscription price change / new / stopped, missing bill,
unusual transaction, budget forecast, merchant habit, category drift, budget
suggestion, likely duplicate. A model may only reword titles, and a template
fallback means it works with no model at all. Card ids are stable
(`kind_periodKey_subject`) so reruns update rather than duplicate.

## D-006 · Design direction "Ledger"
**2026-11-10 · Accepted · owner picked from three mockups**

Light, editorial: off-white ground, ink rules, large tabular numbers, one
deep-green accent, Space Grotesk headings, Inter body. Dark theme mirrors it.
Mockups: https://claude.ai/artifact/6ADJAJmXeMjoDUKKuHWsqC (A is the chosen
one). Details: [design-system.md](design-system.md).

## D-005 · Bank SMS detection stays a suggestion, on-device only
**2026-11-10 · Accepted · auto-add is a separate, later decision (now D-029)**

A Kotlin `BroadcastReceiver` parses incoming bank messages on the phone and
posts "Add this entry?". Tapping it opens the form prefilled. Message text is
never stored, logged or uploaded. Off by default; the toggle is a real
setting (v1 reset it to on at every launch). The receiver is protected with
`BROADCAST_SMS` so other apps cannot fake messages. Android only: iOS has no
API to read SMS.

## D-004 · Plain Dart models, Riverpod without code generation
**2026-11-10 · Accepted**

Models are hand-written immutable classes; providers are plain Riverpod.
`freezed`/`riverpod_generator` were tried and removed to avoid a build step.
Pure logic lives in `app/lib/core/domain` with no Flutter imports.

## D-003 · New app lives in `v2/`; v1 is never modified
**2026-11-10 · Accepted · owner instruction**

The Angular/Capacitor app, its `functions/`, rules and both v1 Firebase
projects (`expense-tracker-e7ff7`, `public-exp-tracker`) are in use and are
not changed. v2 only ever reads from v1, and only via the migration script,
and only with the owner's explicit go-ahead.

## D-002 · Android + iOS, one Flutter codebase
**2026-11-10 · Accepted · owner**

Web stays on the v1 PWA until it is retired. SMS features are Android-only.
iOS needs Sign in with Apple alongside Google before App Store release.

## D-001 · Rebuild in Flutter with a real AI agent
**2026-11-10 · Accepted · owner**

v1 is a WebView app with a single-shot "Ask AI" (no tools, no memory, weak
embeddings, a likely-broken vector index). v2 is native, multi-turn and
tool-based. The approved plan is mirrored in [roadmap.md](roadmap.md).
