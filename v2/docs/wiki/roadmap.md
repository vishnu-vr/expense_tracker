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
- Eval on `gemini-3.8-flash`: 35/35, all figures exact (D-020).
- v1 data migrated: 9 accounts, 6 households, 2,795 entries, totals match (D-023).
- Admin billing & usage dashboard live: `getAdminDashboard` deployed, owner is admin, build 1.0.0 (3) distributed (D-024, 2026-11-14).
- Google sign-in enabled and wired in the app; reaches Google's sign-in screen
  on Android.

## Blocked on the owner

| Item | Why it needs you |
|---|---|
| Request a Claude quota increase in Vertex AI (D-022) | Quota requests are made by the project owner in the console |
| Finish installing Xcode + CocoaPods | iOS build |
| Play Store SMS permission declaration | Your developer account |
| Go-ahead for the Flash-Lite eval subset (billed, ~66k input tokens), then deploy `askAgent` and ship build 1.0.0 (6) (D-027) | Billed run and a production deploy |
| Go-ahead for the voice/Malayalam eval subset on Flash and Flash-Lite (billed, 8 questions × 2 models), then deploy `askAgent`, run the manual voice checklist on a real phone, and ship build 1.0.0 (7) (D-028) | Billed run, a production deploy and a real microphone |
| Turn on the Cloud Billing export to BigQuery (dataset `billing_export`, US multi-region; D-024) | Only a billing account admin can, in the console; see operations.md › Billing dashboard |

## Next up (in order)

1. Compare Claude in the eval once its quota is granted (D-022); pick the
   model on accuracy first, then latency and cost (D-010).
2. Household members install the v2 build and sign in with their usual
   accounts (data migrated 2026-11-14, D-023).
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
- Talk mode: speak the answer sentence by sentence as it streams (D-028 v1
  waits for the whole answer, about 10 s).
- Retire the v1 Angular app once v2 is in use.
