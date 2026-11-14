# Track Expense v2: instructions for coding agents

Flutter app (`app/`, Android + iOS) and Firebase backend (`backend/`) for a
household expense tracker with an AI assistant. Read
[`docs/wiki/README.md`](docs/wiki/README.md) first; decisions are in
[`docs/wiki/decisions.md`](docs/wiki/decisions.md).

## Hard rules

- **Never modify v1.** Everything outside `v2/` (the Angular app, `functions/`,
  `firestore.rules`, `src/`, `android/` at the repo root) is the production v1
  app. The only exceptions are `.github/workflows/v2-*.yml`.
- **Never touch the v1 Firebase projects** `expense-tracker-e7ff7` and
  `public-exp-tracker`. The migration script reads from them only, and only
  when the owner says so.
- **Production is `expense-tracker-v2-5c9fa`** (alias `prod`). Deploys,
  permission changes, deleting data or functions, and enabling paid services
  there need the owner's go-ahead in the current conversation.
- **No secrets in the repo.** `firebase_options.dart` and
  `functions/.env.expense-tracker-v2-5c9fa` hold public ids and settings only.
- **The assistant never does arithmetic** (D-011). New numbers come from a
  tool in `backend/functions/src/core`, with a test.
- **Never log prompts, messages or SMS text.**

## Commands

Set these first for Android builds and emulators:
```
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
```

| Task | Command |
|---|---|
| App checks | `cd app && flutter analyze && flutter test` |
| Kotlin tests | `cd app/android && ./gradlew :app:testDebugUnitTest` |
| On-device test | `cd app && flutter test integration_test` (emulator running) |
| Backend checks | `cd backend/functions && npm run build && npm run typecheck && npm test` |
| Rules + handlers | `cd backend/functions && npm run test:rules:emulator` |
| Run app | `cd app && flutter run [--dart-define=BACKEND=emulator\|firebase]` |
| Deploy (with go-ahead) | `cd backend && firebase deploy --only firestore,functions --project prod` |
| Verify live | `cd backend && node scripts/smoke-live.mjs` |

Android emulator AVD: `truepath`. Start headless with
`$ANDROID_HOME/emulator/emulator -avd truepath -no-window -no-audio`.

## Conventions

- **App structure:** pure logic in `app/lib/core/domain` (no Flutter
  imports, unit-tested); data behind interfaces in `app/lib/core/data`;
  screens in `app/lib/features/<name>`. Screens never import Firebase.
- **State:** plain Riverpod providers in `app/lib/app/providers.dart`; no code
  generation (D-004).
- **UI:** use `context.palette`, `LedgerText` and the widgets in
  `core/widgets/common.dart`. Money only through `Money` / `formatMoney`.
  Icon-only buttons need a `tooltip`. Feedback via `showToast`, destructive
  actions via `confirmDialog`.
- **Writes are fire-and-forget** in the Firestore repository (offline
  queueing); do not `await` server round trips in the UI path.
- **Backend structure:** pure logic in `src/core`, Firestore in `src/data`,
  one handler per function in `src/handlers`, exports in `src/index.ts`,
  every tunable in `src/config.ts`.
- **Region:** functions and Firestore are `asia-south1`. The app's
  `_functionsRegion` must equal the backend's `REGION`.
- **Dependencies:** after changing backend deps regenerate the lock with
  `npx npm@10 install --package-lock-only` (D-014).
- **Shell:** the user's shell is zsh; write `${var}:suffix`, never
  `$var:suffix`.

## When you change things

- Data shape or callable contract: update `backend/SCHEMA.md`, the rules,
  rules tests, `app/lib/core/data/firebase/mappers.dart` and its test.
- A structural choice: add an entry to `docs/wiki/decisions.md`.
- New screen or flow: a widget test using `test/support/harness.dart`.
- Something the owner must do: add it to `docs/wiki/roadmap.md` › Blocked on
  the owner.
- Before saying "done": run the app and backend checks above and report the
  actual results.
