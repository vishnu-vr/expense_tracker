# Architecture

## The pieces

```
Phone (Flutter, Android + iOS)
 ├─ UI: features/*            screens, Ledger design system
 ├─ Logic: core/domain        pure Dart, unit-tested, no Flutter imports
 ├─ Data: core/data           repository interfaces
 │    ├─ demo_*               in-memory sample household (default run mode)
 │    └─ firebase/*           Firestore, Auth, Functions, Messaging
 └─ Android native: SmsReceiver.kt  bank SMS → "Add this entry?" notification

Firebase project expense-tracker-v2-5c9fa (asia-south1)
 ├─ Auth                       email/password, Google
 ├─ Firestore                  schema v2, security rules = the access model
 ├─ Cloud Functions (Node 22)
 │    ├─ callables (public     joinHome, leaveHome, askAgent (streaming),
 │    │   invoker, sign-in      confirmProposal, exportTransactionsCsv,
│    │   checked in code)      getAdminDashboard (admin claim only)
 │    ├─ triggers              onTransactionWritten → notification + embedding
 │    │                        onNotificationCreated → FCM push
 │    └─ schedule              generateInsights, 06:00 Asia/Kolkata
 ├─ Vertex AI (global)         gemini-3.8-flash (agent), gemini-embedding-001
 ├─ BigQuery (US)              billing_export: Cloud Billing export (read by getAdminDashboard)
 └─ Cloud Monitoring           token, Firestore op and request counts (read by getAdminDashboard)
```

## Run modes

The app picks its backend at build time with `--dart-define=BACKEND=…`
(`app/lib/app/backend.dart`):

| Mode | What it talks to | Use it for |
|---|---|---|
| `demo` (default) | In-memory household, dated around today | UI work, screenshots, tests |
| `emulator` | Local Firebase emulators (`10.0.2.2` from the Android emulator) | Rules, triggers, flows end to end |
| `firebase` | `expense-tracker-v2-5c9fa` | Real use |

Swapping is done only through Riverpod overrides of four providers:
`sessionRepositoryProvider`, `householdRepositoryProvider`,
`agentRepositoryProvider`, `pushServiceProvider`. Screens never import
Firebase.

## App layout (`app/lib`)

| Folder | Holds |
|---|---|
| `main.dart` | Startup: prefs, backend overrides, push wiring |
| `app/providers.dart` | Every shared provider: data streams, settings, derived insights |
| `app/router.dart` | go_router; redirects follow the session (splash → login → onboarding → app) |
| `app/backend.dart` | Run-mode selection, Firebase init, App Check |
| `core/domain` | Models and logic ported from v1 (insights, budgets, recurring bills, note grouping, trends, CSV) |
| `core/data` | `HouseholdRepository`, `SessionRepository`, `AgentRepository`, `AdminRepository` (billing dashboard), SMS channel, demo + Firebase implementations |
| `core/theme`, `core/widgets`, `core/format` | Design tokens, shared widgets, money/date formatting and masking |
| `features/<screen>` | One folder per screen |
| `firebase_options.dart` | Client config for the v2 project (public identifiers, not secrets) |

## Backend layout (`backend/functions/src`)

| Folder | Holds |
|---|---|
| `index.ts` | Function exports only (thin wrappers) |
| `config.ts` | Region, model ids, embedding model, limits: the one place to change them |
| `core/` | Pure logic: query, compare, budget, recurring, anomalies, insight detectors, blocks, proposals, billing dashboard shaping |
| `agent/` | Genkit agent: tools, system prompt, tool loop, provider resolution |
| `data/` | Firestore access: home resolution, loading, vector search; `billing.ts` reads BigQuery + Monitoring over REST |
| `handlers/` | One file per callable/trigger |
| `scripts/` | Migration v1→v2, embedding backfill, `set-admin` (never run automatically) |

## Data flow examples

**Adding an entry.** Form → `HouseholdRepository.saveTransaction` → Firestore
write (queued offline, not awaited) → rules check ownership and shape →
`onTransactionWritten` writes `notifications/tx_<eventId>` and the embedding →
`onNotificationCreated` pushes to the other members.

**Asking the assistant.** Ask screen → `askAgent` stream → server loads the
caller's home (membership re-checked) → model calls tools → tools compute
numbers from the household's data → model calls `respond` with blocks →
server validates, fills in transaction rows, stores the thread → app renders
blocks. Status chunks ("Thinking…", one per tool) stream while it works.

**Billing dashboard.** Profile › Admin › Billing & usage (shown only with
the `admin` claim) → `getAdminDashboard({month})` → server checks the claim,
queries the BigQuery billing export and Cloud Monitoring in parallel, shapes
the numbers in `core/billing.ts`, caches them 15 min → screen. Without the
export it returns `billing.configured: false` and the setup steps show.

**Bank SMS.** `SMS_RECEIVED` (system only) → `SmsReceiver` checks the toggle
and permissions → `SmsParser` (ignores OTPs) → notification with
`trackexpense://app/add?type=&amount=&date=` → go_router opens the prefilled
form.

## Where to look for the contract

- Firestore documents, blocks, callables, errors: [`backend/SCHEMA.md`](../../backend/SCHEMA.md)
- Access rules: [`backend/firestore.rules`](../../backend/firestore.rules)
- Why things are the way they are: [decisions.md](decisions.md)
