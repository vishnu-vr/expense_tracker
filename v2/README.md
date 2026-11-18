# Track Expense v2

The Flutter rebuild. Everything here is new; the original Angular/Capacitor app
in the repo root is not modified and keeps using its own Firebase project.

- `app/` — Flutter app (Android + iOS).
- `backend/` — Firebase backend (functions, rules, indexes), deployed to
  `expense-tracker-v2-5c9fa`. See `backend/README.md` and `backend/SCHEMA.md`.
- `docs/wiki/` — decisions, architecture, AI agent, SMS, design system,
  testing, operations and roadmap. Start at `docs/wiki/README.md`.
- `CLAUDE.md` / `AGENTS.md` — instructions for AI coding agents.

## Running the app

```
cd app
flutter pub get
flutter run                                  # demo: in-memory sample household
flutter run --dart-define=BACKEND=emulator   # local Firebase emulators (start them from backend/)
flutter run --dart-define=BACKEND=firebase   # live project expense-tracker-v2-5c9fa
```

Android builds on this machine need:

```
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
```

## Checks

```
cd app
flutter analyze
flutter test
SHOTS_DIR=/some/dir flutter test --update-goldens test/features   # also writes PNGs of each screen
(cd android && ./gradlew :app:testDebugUnitTest)                  # Kotlin SMS parser tests
flutter test integration_test                                     # on a running emulator or phone
```

## Layout of `app/lib`

- `core/domain` — pure Dart logic ported from the original app (insights,
  budgets, recurring bills, note grouping, trends, CSV). No Flutter imports.
- `core/data` — repository interfaces, the in-memory demo implementations, and
  the Firebase implementations under `core/data/firebase`.
- `core/theme`, `core/widgets`, `core/format` — the "Ledger" design system.
- `features/*` — one folder per screen.
- `app/` — providers, routing and backend selection.

Bank SMS detection is Android only and lives in
`app/android/app/src/main/kotlin/com/vapps/track_expense/`.
