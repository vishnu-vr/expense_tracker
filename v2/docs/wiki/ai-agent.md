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
| Claude option | `vertex-model-garden/claude-…`, `MODEL_GARDEN_LOCATION=us-east5` | needs terms accepted in Model Garden |

To switch models: change `AGENT_MODEL`, run the eval, compare, redeploy.

## Evaluating a model

`backend/functions/eval/` has a fixture household (8 months, 2 members,
budgets, recurring bills, a planted anomaly and a duplicate) and 35 golden
questions whose expected numbers are computed by code. Unit tests check the
expectations against the tools, so the answer key itself is tested.

```
cd v2/backend/functions
npm run eval -- --model vertexai/gemini-3.8-flash
```

It reports numeric accuracy, latency and token use per model. Not yet run
against a real model (as of 2026-11-14).

## Status on 2026-11-14

- Deployed and answering. The live smoke test asked "How much did I spend in
  the last 7 days, and on what?" and got correct stat, bars, transactions and
  text blocks in about 12 s.
- Embeddings verified live (768 dims written by the trigger).
- Answer quality across many questions has not been measured: run the eval.

## Ideas not built yet

- What-if answers ("if dining drops 20%…") as a dedicated tool.
- Using embeddings to suggest a category while typing a note, and for SMS
  auto-add.
- Paginating the household load (the agent currently loads every entry).
