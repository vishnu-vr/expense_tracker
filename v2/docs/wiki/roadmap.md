# Roadmap and open items

Updated 2026-11-14. The approved plan lives in the owner's Claude Code plans
folder; this page is the working copy.

## Done

- Flutter app with every v1 screen, in the Ledger design, light and dark.
- Firebase backend for schema v2: rules, indexes, 8 functions, eval harness,
  migration script (not run).
- Live project `expense-tracker-v2-5c9fa`: Firestore (asia-south1), rules and
  indexes, functions, Vertex AI, Android + iOS apps registered, app connected.
- Live smoke test: all 11 checks pass, including a real assistant answer.

## Blocked on the owner

| Item | Why it needs you |
|---|---|
| Enable Google sign-in in Firebase Auth | Console creates the OAuth client |
| Accept Claude terms in Vertex Model Garden | Needed only to compare Claude in the eval |
| Go-ahead for the v1 → v2 data migration | Reads your real data |
| Finish installing Xcode + CocoaPods | iOS build |
| Play Store SMS permission declaration | Your developer account |

## Next up (in order)

1. Run the eval on `gemini-3.8-flash`; then Claude if terms are accepted.
   Pick the model on accuracy first, then latency and cost (D-010).
2. Data migration dry run, compare counts and sums, then the real run.
3. Release signing key, register its SHA-1, internal testing track.
4. Turn on App Check enforcement (`ENFORCE_APP_CHECK=true`) once release
   builds ship with Play Integrity / App Attest.

## Planned features

- **SMS auto-add** with a toggle: see [sms.md](sms.md) for the open
  questions. Separate plan.
- **On-device AI spike.** Measure accuracy, latency, download size and device
  coverage for parsing and categorising one bank SMS with (a) an OS model
  (Gemini Nano via ML Kit GenAI on Android, Apple's on-device model on iOS)
  and (b) a bundled small open model. Good fit: one message, short output,
  private. Poor fit: the multi-step assistant, which stays in the cloud.
  Package names and device support change fast; re-check docs first.
- What-if tool for the assistant; category suggestions from embeddings.
- Retire the v1 Angular app once v2 is in use.
