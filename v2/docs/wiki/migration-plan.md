# Data migration plan: `public-exp-tracker` → `expense-tracker-v2-5c9fa`

Status: **done 2026-11-14** with the owner's go-ahead (D-023). Re-running
step 3 later is safe; every step that reads v1 or writes v2 still needs the
owner's go-ahead at the time (D-003).

## Result (2026-11-14)

| What | v1 (`public-exp-tracker`) | v2 after migration |
|---|---|---|
| Auth accounts | 9 (6 Google, 3 email/password) | 9 imported, same uids and passwords |
| Households | 6 | 6 |
| Transactions | 2,795 | 2,795, 0 skipped |
| Per-household income/expense | — | match for every household |
| Embeddings | — | 2,640 (the other 155 entries have no note) |

- 12 "entry added" activity items appeared in one household for entries
  dated within the last day (the import rule only silences older ones). No
  push was sent: devices have not registered with v2 yet.
- Credentials: in-memory access token from the Firebase CLI account for
  Firestore, Vertex and Auth; the v1 password-hash settings were read from
  the v1 Auth config by API and passed to `auth:import` in memory; the export
  file was deleted right after the import.
- Live smoke test after migration: 11/11 pass.

## What "no schema changes" means here

The v1 data is assumed to look the way the v1 app writes it today. v2 does
change a few things, and the migration script already handles them:

| v1 | v2 |
|---|---|
| `transactions.date` is an ISO string | Firestore Timestamp (same instant) |
| `accountId`, on-document `embedding` | dropped |
| `tagIds` sometimes missing | always a list (`[]`) |
| no `createdAt` / `updatedAt` on old entries | taken from v1 if present, otherwise from `date` |
| client-written `notifications` | not copied (v2 writes its own) |
| `users/{uid}/fcmTokens` | not copied (tokens belong to the old project) |

Everything else (`users`, `homes`, `categories`, `categoryBudgets`, `tags`)
is copied as-is with the same document ids, so household links, ownership
and category ids line up without remapping.

## What gets moved

1. **Auth accounts**, with their uids unchanged, because every entry and
   household stores uids. Email/password users keep their passwords; Google
   users sign in with Google as before.
2. **Firestore**: `users`, `homes` (+ `categories`, `categoryBudgets`, `tags`),
   `transactions`.
3. **Embeddings** are regenerated in v2, not copied.

## Tools

- Firestore: `backend/functions/src/scripts/migrate-v1-to-v2.ts`
  (`npm run migrate`). Dry run by default; the v1 side is only reachable
  through a read-only wrapper; refuses to run if source = target; prints
  per-household counts and income/expense sums for v1 vs what it would write
  vs what is in v2; writes with `--execute` only.
- Auth: `firebase auth:export` / `firebase auth:import`.
- Embeddings: `src/scripts/backfill-embeddings.ts` (idempotent).

### Credentials (done)

Both scripts currently expect service-account key files. There is no
`gcloud` here, and saving login credentials to files was rejected (D-021).
**Planned change:** let both scripts use a short-lived in-memory access token
from the signed-in Firebase CLI account, as the eval does. The Admin SDK
accepts a credential object with `getAccessToken()`, so no key file is
written. The signed-in account must have access to both projects (it lists
both today). Unit-test the argument handling; no behaviour change otherwise.

Alternative if preferred: the owner downloads a service-account key for each
project (Project settings › Service accounts › Generate key), keeps them
outside the repo, and deletes them afterwards.

## Steps

### 0. Prepare (no data touched)
- Make the credentials change above; `npm run build && npm test`.
- Get the v1 **password hash parameters**: Firebase console for
  `public-exp-tracker` › Authentication › Users › ⋮ › *Password hash
  parameters* (signer key, salt separator, rounds, memory cost). Needed so
  migrated email/password users keep their passwords. Treat the signer key
  as a secret: paste it into the import command only, never into a file in
  the repo.
- Check whether any v1 account uses the same email as an account already in
  v2 (today: `vishnu@expensev2.com`). Import fails for a clashing email; the
  fix is to delete the v2-only account first or skip that user.

### 1. Dry run (reads v1, writes nothing)
```
cd v2/backend/functions
npm run migrate -- <token credentials for source and target>      # no --execute
```
Review the output:
- users / homes / transactions counts and each subcollection's size;
- **skipped transactions** with reasons (invalid date, missing `userId` or
  `homeId`, bad amount). v1 once needed scripts to back-fill `userId` and
  `userEmail`, so a few old entries may lack them. Decide per case: fix them
  in v1 first, or accept the skip;
- per-household table: v1 vs transformed must say `match: yes` everywhere.

### 2. Auth import (writes v2 Auth only)
```
firebase auth:export /tmp/v1-users.json --format=json --project public-exp-tracker
firebase auth:import /tmp/v1-users.json --project expense-tracker-v2-5c9fa \
  --hash-algo=SCRYPT --hash-key=<signer key> --salt-separator=<salt separator> \
  --rounds=<rounds> --mem-cost=<memory cost>
rm /tmp/v1-users.json        # contains password hashes
```
Check: user count in v2 = v1; sign in with one email account and one Google
account in the v2 test build (Google needs no extra step; the uid follows the
Google account).

### 3. Firestore copy (writes v2 only)
Ideally right after telling the household to stop using the v1 app for an
hour, so no new v1 entries arrive mid-copy.
```
npm run migrate -- <credentials> --execute
```
The script re-checks per-household counts and sums after writing and exits
non-zero on any mismatch, failed write or skipped entry.

Side effects in v2 while it writes:
- `onTransactionWritten` fires per entry. Entries whose `createdAt` is older
  than 24 hours count as imports and send **no** household notification
  (D-013); only entries from the last day would produce activity items.
- The same trigger creates embeddings. A burst of writes can hit the
  embedding model's per-minute quota; failures are logged and skipped, which
  step 4 repairs.

### 4. Embeddings backfill
```
npx tsx src/scripts/backfill-embeddings.ts      # with the same token credentials
```
Idempotent: skips entries whose embedding is already current.

### 5. Verify
- Re-run the dry run: the "v1 vs target" table must be all `match: yes`.
- `node ../scripts/smoke-live.mjs`: all pass (it uses its own throwaway
  household and cleans up).
- Open the v2 app with a real account: Home's "Net this month", Ledger totals
  for a past month and Budgets should equal the v1 app for the same period.
- Ask the assistant one question whose answer you know from v1.

### 6. Cut over
- Household members install the v2 build and sign in with their usual
  account.
- Keep the v1 app and `public-exp-tracker` untouched as the fallback for a
  few weeks.
- If someone kept adding entries in v1 after step 3, run step 3 again: it is
  safe to repeat (same document ids, overwrite). It does **not** propagate
  deletions made in v1 after the first copy.

## Rollback

v1 is never written, so it is always intact. To undo in v2: delete the
migrated households' documents and the imported Auth users (the household
ids and uids are in the dry-run output), then repeat from step 1.

## Effort and cost

- Script change for credentials: small (an hour including tests).
- The copy itself: minutes for a household-sized dataset.
- Cost: Firestore reads/writes once per document; one embedding call per
  entry with a note. Negligible at household scale.

## Open questions for the owner

1. Use in-memory token credentials (recommended) or download service-account
   keys?
2. When is a good one-hour window to pause v1 use?
3. Any v1 accounts that should **not** be migrated (old test accounts)?
