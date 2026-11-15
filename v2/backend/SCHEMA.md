# Track Expense — Firestore schema v2

This is the contract between the Flutter app (`v2/app`) and the backend (`v2/backend`).
"Server" means Cloud Functions / Admin SDK, which bypass security rules.

## Collections

### `users/{uid}`
| field | type | notes |
|---|---|---|
| `email` | string | |
| `name` | string | |
| `photoURL` | string | |
| `createdAt` | Timestamp | |
| `homeId` | string | Pointer to the user's home. Rules only allow a value whose home lists the user in `memberIds`; the server additionally re-checks `memberIds` on every call. |

Subcollection `users/{uid}/fcmTokens/{token}` — `{ token }` (doc id = the FCM token). Private to the user.

Access: read by self and by members of the same home (single `get`, or `where('homeId','==', myHomeId)`); create/update by self; no delete.

### `homes/{homeId}`
| field | type | notes |
|---|---|---|
| `name` | string | |
| `displayId` | string | 6-character invite code; immutable from clients |
| `ownerId` | string | uid; immutable from clients |
| `memberIds` | string[] | uids |
| `createdAt` | Timestamp | |

Access: read by members. **Create** only with `ownerId == uid` and `memberIds == [uid]` (may be batched with the `users/{uid}.homeId` update). Update by owner only. Joining an existing home goes through the `joinHome` callable and leaving through `leaveHome` (a non-owner cannot edit `memberIds` from the client). No client delete.

Subcollections (all read/write by home members unless stated):

- `categories/{id}` — `{ name, icon, color, type: 'income'|'expense' }`. Custom categories only; the built-in defaults (same ids as v1: `food`, `grocery`, `salary`, …) are merged in by the app and by the server (`functions/src/core/categories.ts`). A home doc with a default's id overrides it.
- `categoryBudgets/{categoryId}` — `{ categoryId, amount: number, updatedAt: Timestamp }`. Monthly budget; doc id = category id.
- `tags/{id}` — `{ name, color?, note?, createdBy?, createdAt? }`.
- `aiThreads/{threadId}` — `{ title, createdBy, createdAt, updatedAt, usage?: { questions, inputTokens, outputTokens, modelCalls }, lastModel?, lastMessagePreview? }`. **Personal and read-only for clients** (D-025): only the member whose uid is `createdBy` can read the thread, its messages and its proposals; list queries must filter `where('createdBy','==', uid)` (index: `createdBy` ASC, `updatedAt` DESC). Created/updated by `askAgent`, which also rejects continuing someone else's thread (`not-found`). `usage` is incremented (`FieldValue.increment`) after each successful answer; `lastModel` is the model id (e.g. `vertexai/gemini-3.8-flash`); `lastMessagePreview` is the first ~80 characters of the latest answer's first text block (or its first stat). Threads created before D-025 have no `usage`/preview until their next answer.
  - `messages/{id}` — `{ role: 'user'|'assistant', blocks: Block[], createdAt, usage? }`. Read-only for clients. Order by `createdAt`. Assistant messages carry `usage: { inputTokens, outputTokens, modelCalls, model, latencyMs }` (that one answer).
  - `proposals/{id}` — `{ action, params, summary, status: 'pending'|'applied'|'rejected', createdBy, createdAt, resolvedBy?, resolvedAt?, result? }`. Read-only for clients; resolved through `confirmProposal` (by `createdBy` only).
- `insights/{id}` — `{ kind, title, body, data, periodKey, createdAt, dismissedBy: string[] }`. Read by members; the only client write is adding/removing **your own uid** in `dismissedBy`. Doc id is stable: `<kind>_<periodKey>[_<subject>]`.

### `transactions/{id}`
| field | type | notes |
|---|---|---|
| `amount` | number | ≥ 0 |
| `categoryId` | string | |
| `date` | **Timestamp** | changed from the v1 ISO string |
| `note` | string? | |
| `type` | `'income'` \| `'expense'` | |
| `userId` | string | owner; must equal the creator's uid; immutable |
| `userEmail` | string | |
| `homeId` | string | immutable |
| `tagIds` | string[] | required (use `[]`) |
| `createdAt` | Timestamp | set to "now" by the client on create (see note below) |
| `updatedAt` | Timestamp | |

No `accountId`, no `embedding` (rules reject both).

Access: read by home members — list queries **must** filter `where('homeId','==', myHomeId)`. Create by a member for themselves. Update/delete by the entry's owner only.

Note: a transaction created with a `createdAt` more than 24 h in the past is treated as an import and produces no household notification.

### `transactionEmbeddings/{txId}` — server only
`{ homeId, vector: Vector(768), text, model, updatedAt }`. No client access at all. Maintained by the `onTransactionWritten` trigger. Only entries with a note have one. `text` is `"<note> | <category name> | <matched merchant> | <tag names>"` — amount, date and type are never embedded.

### `aiUsage/{YYYY-MM}_{homeId}` — server only
`{ month: 'YYYY-MM', homeId, questions, inputTokens, outputTokens, modelCalls, updatedAt }`. Monthly assistant usage per household (month in Asia/Kolkata), incremented by `askAgent` after each successful answer and read by `getAdminDashboard`. Counts only, no text. No client access at all (D-025).

### `notifications/{id}`
`{ type: 'transaction_added'|'transaction_updated'|'transaction_deleted', message, transactionId, homeId, createdBy, createdByName, createdAt: Timestamp, readBy: string[] }`

Created by the server trigger on transaction create/update/delete (clients no longer create them). Clients may read (`where('homeId','==', myHomeId)`, `orderBy('createdAt','desc')`) and add **their own uid** to `readBy`; nothing else.

## Block (AI response blocks)

```
{ type: 'text', text }
{ type: 'stat', label, value, caption? }
{ type: 'bars', title?, items: [{ label, value: number, display: string }] }
{ type: 'transactions', items: [{ id, note, categoryName, amount, type, date /* ISO-8601 instant */ }] }
{ type: 'proposal', proposalId, action: 'set_budget'|'tag_transactions'|'recategorise', summary }
```
Source of truth: `functions/src/core/blocks.ts` (`BlockSchema`). At most 12 blocks per message.

## Insight kinds

`month_review`, `subscription_price_change`, `subscription_new`, `subscription_stopped`, `bill_missing`, `unusual_transaction`, `budget_forecast`, `merchant_habit`, `category_drift`, `budget_suggestion`, `likely_duplicate`. `data` holds the exact figures and ids behind each card (e.g. `transactionId`, `categoryId`, `spent`, `budget`, `crossingDay`); see `functions/src/core/insights/detectors.ts`.

## Indexes (`firestore.indexes.json`)

- `transactions`: (`homeId` ASC, `date` ASC) and (`homeId` ASC, `date` DESC)
- `notifications`: (`homeId` ASC, `createdAt` DESC)
- `aiThreads` (collection scope): (`createdBy` ASC, `updatedAt` DESC) — the Past conversations list
- `transactionEmbeddings`: (`homeId` ASC, `vector` VECTOR dimension 768, flat)

## Callable functions (region `asia-south1`)

| name | request | response |
|---|---|---|
| `joinHome` | `{ displayId }` | `{ id, name, displayId, ownerId, memberIds }` |
| `leaveHome` | `{}` | `{ homeId, ownershipTransferredTo: string \| null }` |
| `exportTransactionsCsv` | `{ from: 'YYYY-MM-DD', to: 'YYYY-MM-DD', timeZone }` | `{ csv, filename, count }` |
| `askAgent` (streaming) | `{ threadId?, message, timeZone, model?, reply?, language? }` — `model` is a choice key (`flash`, `flash-lite`; `[a-z0-9-]{1,32}`, else `invalid-argument`); missing or unknown means the server default (D-027). `reply`: `'text'` (default) or `'voice'` (a short spoken answer comes first); `language`: `'en'` (default) or `'ml'` (Malayalam, amounts as digits) (D-028); any other value of either is `invalid-argument` | `{ threadId, messageId, blocks: Block[] }`; stream chunks `{ type:'status', text }` \| `{ type:'text', delta }` |
| `confirmProposal` | `{ threadId, proposalId, accept: boolean }` | `{ proposalId, status: 'applied'|'rejected', appliedCount, skippedTransactionIds }`; `not-found` unless the caller created the proposal |
| `getAdminDashboard` (admin only) | `{ month: 'YYYY-MM' }` | `{ month, billing, usage, assistant, households }`, see below |

`leaveHome` removes the caller from their home's `memberIds` and deletes `users/{uid}.homeId`. If the caller owned the home and members remain, `ownerId` moves to the first remaining member (returned as `ownershipTransferredTo`). An empty home and all its data are left in place; the caller's transactions stay with the household. `failed-precondition` if the user has no `homeId`; a stale `homeId` is simply cleared.

All require Firebase Auth. See `README.md` for error codes and streaming notes.

### `getAdminDashboard` (D-024)

Requires the custom claim `admin: true` (`permission-denied` otherwise,
`unauthenticated` when signed out). `invalid-argument` for a malformed or
future month (months are India time). `unavailable` only when both the billing
and the usage reads fail. Amounts are in the billing currency, rounded to 2
decimals, net of credits (credits are negative).

```
{
  month: "2026-11",
  billing:
    { configured: true, currency: "INR", dataAsOf: ISO string | null,
      net, gross, credits, previousMonthNet: number | null,
      forecastNet: number | null,          // current month only
      changeVsPreviousMonth: number | null, // (forecastNet ?? net) - previousMonthNet
      byService: [{ service, amount }],    // net, sorted, small ones summed into "Other"
      topSkus:   [{ service, sku, amount, usage, unit }],  // top 10 by gross cost
      daily:     [{ date: "YYYY-MM-DD", amount }] }        // India time
  | { configured: false, reason: "not_set_up" | "no_data" | "unavailable" },
  usage: { available: boolean,             // false for months past Monitoring retention (~6 weeks)
           assistantQuestions,              // askagent requests
           functionCalls: [{ name, count }],
           firestore: { reads, writes, deletes },
           tokens: [{ model, input, output }] },
  assistant: { available: boolean,         // false if the aiUsage read failed
               questions, inputTokens, outputTokens, modelCalls,
               activeHouseholds,            // households with ≥ 1 question
               byHousehold: [{ homeId, homeName, questions, inputTokens, outputTokens }] }
                                            // sorted by inputTokens + outputTokens, highest first
  households: { available: boolean,        // false if the read failed
                households, entries,         // all households; entries ever recorded
                entriesInMonth,              // entries dated in the month (Asia/Kolkata)
                activeInMonth,               // households with ≥ 1 entry in the month
                byHousehold: [{ homeId, homeName, members, entries, entriesInMonth,
                                lastEntryAt /* ISO | null; latest entry dated up to now,
                                               future-dated entries (EMIs entered ahead) are
                                               counted in `entries` but skipped here */ }] }
                                            // sorted by entriesInMonth, then entries, then name
}
```
`households` uses `count()` aggregations on `transactions` per household plus
one latest-entry lookup (index `homeId` + `date` desc). Counts and dates only:
no amounts, notes or other entry content (D-026). A failed read gives
`households.available: false` and does not fail the call.
`assistant` comes from the `aiUsage` rollup for the month; `homeName` is read
from `homes/{homeId}` ("Deleted household" if it no longer exists). Thread
titles and message text are never read or returned.
`not_set_up`: the BigQuery export dataset/table does not exist yet.
`no_data`: it exists but has no rows for the month. `unavailable`: the query
failed (usage is still returned). A failed `aiUsage` read gives
`assistant.available: false` and does not fail the call. Cached in memory for 15 minutes per month.
