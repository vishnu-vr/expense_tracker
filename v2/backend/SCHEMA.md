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
- `aiThreads/{threadId}` — `{ title, createdBy, createdAt, updatedAt }`. **Read-only for clients**; created/updated by `askAgent`.
  - `messages/{id}` — `{ role: 'user'|'assistant', blocks: Block[], createdAt }`. Read-only for clients. Order by `createdAt`.
  - `proposals/{id}` — `{ action, params, summary, status: 'pending'|'applied'|'rejected', createdBy, createdAt, resolvedBy?, resolvedAt?, result? }`. Read-only for clients; resolved through `confirmProposal`.
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
- `transactionEmbeddings`: (`homeId` ASC, `vector` VECTOR dimension 768, flat)

## Callable functions (region `us-central1`)

| name | request | response |
|---|---|---|
| `joinHome` | `{ displayId }` | `{ id, name, displayId, ownerId, memberIds }` |
| `leaveHome` | `{}` | `{ homeId, ownershipTransferredTo: string \| null }` |
| `exportTransactionsCsv` | `{ from: 'YYYY-MM-DD', to: 'YYYY-MM-DD', timeZone }` | `{ csv, filename, count }` |
| `askAgent` (streaming) | `{ threadId?, message, timeZone }` | `{ threadId, messageId, blocks: Block[] }`; stream chunks `{ type:'status', text }` \| `{ type:'text', delta }` |
| `confirmProposal` | `{ threadId, proposalId, accept: boolean }` | `{ proposalId, status: 'applied'|'rejected', appliedCount, skippedTransactionIds }` |

`leaveHome` removes the caller from their home's `memberIds` and deletes `users/{uid}.homeId`. If the caller owned the home and members remain, `ownerId` moves to the first remaining member (returned as `ownershipTransferredTo`). An empty home and all its data are left in place; the caller's transactions stay with the household. `failed-precondition` if the user has no `homeId`; a stale `homeId` is simply cleared.

All require Firebase Auth. See `README.md` for error codes and streaming notes.
