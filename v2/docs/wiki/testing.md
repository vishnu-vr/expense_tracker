# Testing

What exists, how to run it, and what each layer proves. Run the fast layers
on every change; run the slow ones before a deploy or release.

| Layer | Command | Proves | Speed |
|---|---|---|---|
| Dart logic | `cd v2/app && flutter test test/core` | Ported v1 maths, note grouping (byte-for-byte against the original TypeScript), Firestore mapping and repository behaviour (fake Firestore) | seconds |
| Widget / flow | `cd v2/app && flutter test test/features test/app` | Every screen's main flows on the demo household, routing by session, privacy masking, SMS screen and deep link | seconds |
| Kotlin | `cd v2/app/android && ./gradlew :app:testDebugUnitTest` | SMS parser cases (OTP ignored, amounts, credit/debit), per-bank auto-add templates, promo/reminder rejection, merchant key vectors shared with Dart, confidence decision, 7-day dedupe, duplicate check, review queue limits, Nano answer validation | ~1 min |
| On-device | `cd v2/app && flutter test integration_test` (emulator or phone connected) | The real app boots, adds an entry, finds it, opens each tab | ~2 min |
| Backend unit | `cd v2/backend/functions && npm test` | Agent tools, insight detectors, golden answers, proposals, migration transform, agent loop with a scripted model | seconds |
| Rules + handlers | `cd v2/backend/functions && npm run test:rules:emulator` | Security rules allow/deny, every handler against the Firestore emulator | ~1 min |
| Live smoke | `cd v2/backend && node scripts/smoke-live.mjs` | The deployed project: rules, triggers, embeddings, one real assistant answer; cleans up after itself (`--cleanup` sweeps leftovers) | ~1 min, tiny cost |
| Model eval | `cd v2/backend/functions && npm run eval -- --model <id>` (token setup: [operations.md](operations.md#run-the-model-eval)) | Assistant accuracy on 43 golden questions (35 typed English + 8 voice/Malayalam, D-028); last: gemini-3.8-flash 35/35 on the original 35 | ~6 min, billed |

CI (`.github/workflows/v2-app.yml`) runs `flutter analyze` and `flutter test`
on changes under `v2/app`, and `.github/workflows/v2-backend.yml` runs the
backend build, typecheck and unit tests on changes under `v2/backend`. Rules
tests (they need Java and the emulator) are run locally.

## Screenshots

```
SHOTS_DIR=/tmp/shots flutter test --update-goldens test/features
```
Writes a PNG of each key screen with the real fonts. Without `SHOTS_DIR` the
`shot()` calls do nothing, so the normal test run never writes files.

## Writing tests

- Use `test/support/harness.dart`: `pumpApp` (fixed clock 10 Nov 2026 21:00,
  demo household), `tapVisible` (scrolls lazy lists first), `toastGone`,
  `shot`.
- Find things the way a user would: visible text, `bySemanticsLabel`,
  `byTooltip`. Icon buttons always have a tooltip for this reason.
- Pure logic gets a unit test in `test/core/domain` with hand-computed
  expectations. If you port more v1 code, compare against the original as
  `note_grouping_test.dart` does.
- Backend: pure functions in `src/core` get vitest unit tests; anything that
  touches Firestore gets a handler test in `test/integration`; rule changes
  get a case in `test/rules`.

## Manual voice checklist (D-028)

Run on a real Android phone with `--dart-define=BACKEND=firebase` (the
emulator's microphone is unreliable; demo mode uses a scripted fake voice).

1. First tap on the Talk mic asks for the microphone; deny it once and check
   the explanation toast, then allow it in settings and tap Talk again.
2. English, three turns in one conversation: each answer is spoken briefly
   and the details are on screen; it listens again after each answer; the
   turns appear in the thread and in Past conversations.
3. Say "stop" (and once "that's all"): it ends without sending anything.
   Ask "how much did we spend at the bus stop" style questions: sent normally.
4. Tap while it is speaking: speech stops and it listens again. Tap while it
   is listening: it pauses with the transcript editable; fix it and Send.
5. Stay quiet: it ends after about 8 s with "Talk ended after a quiet spell."
6. Press Home or lock the phone mid-conversation: it ends; the screen stays on
   while talking.
7. Turn on Hide amounts and ask a money question: no figures are spoken.
8. Ask for a budget change: it says to tap Confirm; saying "yes" does not
   apply it; tapping Confirm does.
9. Profile › Assistant › Voice language › Malayalam: ask two questions in
   Malayalam (and one mixed with English names). Answers are in Malayalam
   with amounts as digits. On a phone without Malayalam speech, the row and
   the Talk panel say English is used.

## Manual SMS auto-add checklist (D-029)

Run on a real Android phone with a build against the live project
(`--dart-define=BACKEND=firebase`), signed in. Profile › Bank SMS detection:
detection on, Auto-add on. Use real bank messages, or `adb emu sms send` on
an emulator signed in to the live project (see [sms.md](sms.md)).

1. A payment to a well-known merchant (Swiggy, Uber, Amazon…) or one you
   always file the same way: "Added … · Undo · Change" appears; the entry is
   in the Ledger with an SMS badge and note "Merchant · BANK XX1234"; the lock
   screen shows only "Entry added from a bank message".
2. Undo removes the entry. Change opens it in the edit screen.
3. A payment to an unknown payee: "Review detected entry"; Home shows "1
   detected entry to review"; the list shows amount, payee · account, time.
4. In the review list: Add (with a suggested category) saves it; tapping a
   row opens the form prefilled; swiping dismisses it.
5. The same transaction twice (e.g. a bank SMS and a UPI app SMS with the
   same reference): only one entry.
6. A payment you already typed in by hand within 15 minutes: no second entry.
7. Airplane mode, then a message: the entry appears in the Ledger at once and
   syncs (household notification) when back online.
8. A promotion, a bill reminder ("due on"), a collect request, an OTP: nothing.
9. Auto-add off: the old "Add this entry?" suggestion comes back unchanged.
10. On-device AI row: note the status and the phone model; on a supported
    phone, open the review list and check unknown payees get a suggested
    category ("suggested by on-device AI"), never saved by themselves.

## Known gaps

- `FunctionsAgentRepository` (the streaming client) and
  `FirebaseSessionRepository` have no automated tests; they were exercised by
  hand against the emulators and the live project.
- iOS has never been built or tested.
- `DeviceVoiceService` (the speech plugins) has no automated tests; the Talk
  flow is covered with `FakeVoiceService` and the manual checklist above.
- Push delivery and the daily insights schedule have not been observed live.
- SMS auto-add's native Firestore write, Undo and the duplicate check against
  saved entries have only been tested with unit tests and fakes: the emulator
  run (receiver → worker → review list, dedupe, promo/OTP rejection, deep
  link) used a demo build because signing in needs the owner's account.
  Gemini Nano has not run on a supported phone yet.
