# The AI assistant

## What it is for

Answering questions about the household's money with exact figures, and
suggesting changes the user can confirm. Proactive findings ("Netflix went
up", "Electricity not logged yet") come from the daily insights job, not the
chat.

## Ground rules (see D-011)

1. **No model arithmetic.** Every number is computed by a tool in
   `backend/functions/src/core` and quoted verbatim from a `…Display` field.
2. **Household scope is server-side.** Tools resolve `homeId` from the
   caller's `users/{uid}` and re-check `memberIds`; the model never supplies it.
3. **Writes are proposals.** `propose_set_budget`, `propose_tag_transactions`,
   `propose_recategorise` store a pending proposal; `confirmProposal` applies
   it only to the confirmer's own entries.
4. **No prompt or data logging.** Error logs carry error names and status
   codes only. This makes model failures harder to debug, on purpose.

## Tools

| Tool | Returns |
|---|---|
| `query_transactions` | Filters (dates, type, categories, tags, members, amount range, text) + group by category/month/week/weekday/member/merchant; totals, counts, averages, top rows |
| `compare_periods` | Two ranges, totals and per-category deltas |
| `budget_status` | Budgets, spent, pacing ratio, month-end forecast, projected crossing day |
| `recurring_bills` | Detected recurring bills, price changes, missed payments |
| `find_anomalies` | Entries far outside their category/merchant norm; likely duplicates |
| `search_notes` | Vector search over `transactionEmbeddings` for the home |
| `list_categories` / `list_tags` / `list_members` | Reference data |
| `propose_*` | A pending change (see rule 3) |
| `respond` | The final answer as typed blocks |

## Reply blocks

`text`, `stat`, `bars`, `transactions`, `proposal`; exact shapes in
[`backend/SCHEMA.md`](../../backend/SCHEMA.md#block-ai-response-blocks). The
app parses them in `app/lib/core/data/agent.dart` and drops anything unknown.
For `transactions` and `proposal` the model sends ids only and the server
fills in the rows, so the model cannot invent entries.

## Models

| Setting | Value | Where |
|---|---|---|
| `AGENT_MODEL` | `vertexai/gemini-3.8-flash` | `backend/functions/.env.expense-tracker-v2-5c9fa` |
| `VERTEX_LOCATION` | `global` (D-018) | same |
| Embeddings | `gemini-embedding-001`, 768 dims | `backend/functions/src/config.ts` |
| Claude option | `vertex-model-garden/claude-sonnet-5`, `MODEL_GARDEN_LOCATION` | enabled, but needs a quota increase first (D-022) |

To switch the default model: change `AGENT_MODEL`, run the eval, compare,
redeploy.

### User choice (D-027)

Each member picks a model in Profile › Assistant. The app sends a key with
each question; the server maps it through `AGENT_MODEL_CHOICES` in
`backend/functions/src/config.ts`:

| Key | Label in the app | Model id | Note in the app |
|---|---|---|---|
| `flash` (default) | Gemini Flash | `AGENT_MODEL` (`vertexai/gemini-3.8-flash`) | Best answers |
| `flash-lite` | Gemini Flash-Lite | `vertexai/gemini-3.5-flash-lite` | Cheaper, may miss harder questions |

A missing or unknown key gives the default; a malformed one is rejected. The
Ask screen shows "Using <label>" under the input. The model actually used is
recorded on each answer (`usage.model`) and the thread (`lastModel`).

To add a choice:
1. Run the eval on it (a subset with `--only` first; see operations.md).
2. Add `{ key, id, label }` to `AGENT_MODEL_CHOICES` (keys are `[a-z0-9-]`,
   at most 32 characters) and deploy `askAgent`.
3. Add the same key with a label and one-line note to
   `app/lib/core/domain/agent_models.dart` and ship a build.

To remove one, drop it from the app first; the server then treats the old
key as unknown and answers with the default.

## Voice and Malayalam (D-028)

The app's Talk mode sends spoken questions as normal `askAgent` calls with
`reply: "voice"` and `language: "en" | "ml"` (allowlists `AGENT_REPLY_MODES`
and `AGENT_LANGUAGES` in `src/config.ts`; anything else is
`invalid-argument`). `replyStyleSection` in `src/agent/prompt.ts` appends:

- **voice**: the first block is a text block with a 1–2 sentence spoken
  answer (no tables, lists, ids or ISO dates); details go in later blocks;
  spoken figures are still copied from `…Display` strings; after a
  `propose_*` tool it says what was suggested and to tap Confirm, never to
  confirm by voice.
- **ml**: text, stat labels, captions and bar titles in Malayalam script;
  amounts and numbers exactly as the tools give them (digits with ₹), never
  in words; names unchanged; the question may be mixed Malayalam/English.

Typed English questions get exactly the old prompt. About 100 extra prompt
tokens per voice question.

On the phone (`app/lib/core/domain/voice.dart`): `spokenReply` reads the
first text block (at most 2 sentences; the first stat if there is no text),
says "The details are on screen." when more is shown, describes proposals and
says "Tap Confirm on screen to apply it.", and with Hide amounts on drops
every sentence that contains a figure and says "Amounts are hidden, the
answer is on screen." Malayalam uses Malayalam phrases (the proposal summary,
which is server-written English, is not read). `isStopPhrase` ends the
conversation on whole utterances like "stop", "that's all", "bye", "നിർത്തൂ",
"മതി" (and transliterations "mathi", "nirthu"); a question that merely
contains "stop" is sent normally. Malayalam is used only when the phone has
both recognition and a voice for it; otherwise English, with a note. The
phone's recogniser may send audio to Google or Apple when on-device
recognition is unavailable (usual for Malayalam). Nothing heard or said is
logged.

Eval: 3 voice questions (`voice_*`: first block is a short text answer with
a figure, same figures as the typed twin) and 5 Malayalam ones (`ml_*`,
asked in voice mode; the answer must be in Malayalam script). Run them on
both models:

```
npm run eval -- --model vertexai/gemini-3.8-flash,vertexai/gemini-3.5-flash-lite \
  --only voice_spend_oct,voice_food_oct_vs_sep,voice_propose_budget,ml_spend_oct,ml_grocery_sep,ml_swiggy_oct,ml_food_budget_now,ml_propose_budget
```

## Evaluating a model

`backend/functions/eval/` has a fixture household (8 months, 2 members,
budgets, recurring bills, a planted anomaly and a duplicate) and 43 golden
questions (35 typed English, plus 8 voice/Malayalam ones from D-028) whose
expected numbers are computed by code. Unit tests check the
expectations against the tools, so the answer key itself is tested.

```
cd v2/backend/functions
npm run eval -- --model vertexai/gemini-3.8-flash
```

It reports numeric accuracy, latency and token use per model. Without
`gcloud`, pass a short-lived token from your Firebase CLI login (D-021); see
[operations.md › Run the model eval](operations.md#run-the-model-eval).

### Results

| Date | Model | Passed | Exact figures | Latency mean / p95 | Tokens per question (in / out) |
|---|---|---|---|---|---|
| 2026-11-14 | `vertexai/gemini-3.8-flash` | 35/35 | 100% | 9.7 s / 15.6 s | ~6,600 / ~210 |
| — | `vertex-model-garden/claude-sonnet-5` | not run: quota (D-022) | | | |

## Status on 2026-11-14

- Deployed and answering. The live smoke test asked "How much did I spend in
  the last 7 days, and on what?" and got correct stat, bars, transactions and
  text blocks in about 12 s.
- Embeddings verified live (768 dims written by the trigger).
- Eval: 35/35 on `gemini-3.8-flash` (see Results above).
- Known log noise: Genkit logs `ERROR: /tool/<name> already registered.` for
  each tool on later model rounds. It comes from Genkit's per-call registry
  and does not affect answers (eval and smoke test pass). Ignore it in logs.

## Conversations and usage (D-025)

- Threads live at `homes/{homeId}/aiThreads/{threadId}` and are **personal**:
  only the member who started one can read it, continue it (`askAgent`) or
  resolve its proposals (`confirmProposal`); anyone else gets `not-found`.
- The app lists them under Ask › Past conversations (`/ask/history`,
  `createdBy == uid` ordered by `updatedAt desc`, limit 50) and reopens one
  with `/ask?thread=<id>`, rendering the stored blocks with the same widgets.
  Proposal docs' `status` decides whether Confirm is still offered.
- After each successful answer the server writes, in one batch:
  - `usage {inputTokens, outputTokens, modelCalls, model, latencyMs}` on the
    assistant message;
  - `usage.{questions, inputTokens, outputTokens, modelCalls}` increments,
    `lastModel`, `lastMessagePreview` (first text block, 80 chars) and
    `updatedAt` on the thread;
  - the same increments on `aiUsage/{YYYY-MM}_{homeId}` (India-time month,
    server-only), which feeds the admin dashboard's "Assistant usage".
- Token counts are what the model reports to Genkit per call, summed over the
  run (`RunAgentResult.usage`). They are counts only; no prompt or answer text
  is copied anywhere new.

## Reports (D-033)

Expense reports reuse the same core figures and the assistant's model choice
(D-027) for a narrative written under a number guard, with a template
fallback. See [reports.md](reports.md). "Ask about this report" opens Ask
with a question for the same two periods.

## Ideas not built yet

- What-if answers ("if dining drops 20%…") as a dedicated tool.
- Using embeddings to suggest a category while typing a note, and for SMS
  auto-add.
- Paginating the household load (the agent currently loads every entry).
