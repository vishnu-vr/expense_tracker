# Operations runbook

Everything you need to run, deploy and fix v2. Commands assume macOS with the
tools already installed on this machine.

## Environment

```
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
```
Needed for Android builds and for the Firebase emulators (Java). There is no
`gcloud` on this machine; Google Cloud admin calls go through the signed-in
Firebase CLI account (`firebase login`).

Gradle uses a local distribution zip:
`app/android/gradle/wrapper/gradle-wrapper.properties` points at
`file:///Users/vishnu.ramesh/.gradle/dists/gradle-9.3.1-all.zip`. Copy that
line into any new Flutter/Gradle project.

## Projects

| Alias | Project id | What it is |
|---|---|---|
| `default` | `demo-track-expense` | Emulator-only (`demo-` ids never reach Google) |
| `prod` | `expense-tracker-v2-5c9fa` | The live v2 project, asia-south1 |
| — | `expense-tracker-e7ff7`, `public-exp-tracker` | **v1, do not touch** (D-003) |

## Run the app

```
cd v2/app
flutter run                                   # demo data
flutter run --dart-define=BACKEND=emulator    # local emulators (start them first)
flutter run --dart-define=BACKEND=firebase    # live project
```

## Local emulators

```
cd v2/backend
(cd functions && npm ci && npm run build)
firebase emulators:start --project demo-track-expense
```
Auth 9099, Firestore 8080, Functions 5001, UI 4000. The Android emulator
reaches them at `10.0.2.2`; debug builds allow plain HTTP for this
(`app/android/app/src/debug/AndroidManifest.xml`). Create a test user:
```
curl -s -X POST 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key' \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@example.com","password":"secret12","returnSecureToken":false}'
```
`askAgent` fails locally without model credentials; the app shows an error.

## Deploy

```
cd v2/backend
firebase deploy --only firestore --project prod             # rules + indexes
firebase deploy --only functions --project prod --force     # all functions
firebase deploy --only functions:askAgent --project prod    # one function
```
Before deploying functions: `npm run build && npm test` in `functions/`.
Then run the live smoke test.

## Live smoke test

```
cd v2/backend
node scripts/smoke-live.mjs
```
Signs up a throwaway user, checks rules (allow and deny), the transaction
trigger (notification + embedding), that clients cannot read embeddings, and
one real assistant answer, then deletes everything it created. Expect all
`PASS`. Last result (2026-11-14): all 11 pass; the assistant answered
"₹1,439 over the last 7 days" correctly in about 12 s.

If a run is interrupted, `node scripts/smoke-live.mjs --cleanup` removes
every leftover (homes named "Smoke test", their data, and auth users ending in
`@example.invalid`).

## Troubleshooting

### Callables return 401
Cloud Run needs `allUsers` → `roles/run.invoker` on each callable's service
(`askagent`, `joinhome`, `leavehome`, `confirmproposal`,
`exporttransactionscsv`, region asia-south1). Sign-in is still enforced inside
each function. Set on 2026-11-14 (D-019). If it is ever missing again, fix it
one of these ways:
- Google Cloud console › Cloud Run › each service › Security › "Allow public
  access"; or
- set `invoker: "public"` in the function options and redeploy; or
- delete the five callables and deploy again (a fresh create adds the binding).

### `npm ci` fails in Cloud Build ("Missing … from lock file")
The lock was written by npm 11. Regenerate with npm 10 (D-014):
```
cd v2/backend/functions && npx npm@10 install --package-lock-only && npm ci
```

### "Changing from an HTTPS function to a background triggered function is not allowed"
A failed first deploy left a placeholder. Delete that function
(`firebase functions:delete <name> --region asia-south1 --project prod`) and
deploy again. Only do this on functions you know are broken placeholders.

### Model 404 "Publisher model … not found"
The model is not served in that location. Current Gemini models are on
`global` only (D-018).

### zsh eats `:g…` after a variable
In zsh, `$m:generateContent` applies a history modifier. Write `${m}:…`.

### Sign-in with Google fails
- Google is enabled in Firebase Auth (2026-11-14). The app passes the web
  client id (`DefaultFirebaseOptions.googleWebClientId`) as `serverClientId`;
  without it Android cannot get an ID token.
- Each signing key must be registered:
  `firebase apps:android:sha:create <appId> <SHA1> --project prod`. This Mac's
  debug key is registered; a release key will need adding too.
- iOS uses `googleIosClientId` and the reversed client id URL scheme in
  `app/ios/Runner/Info.plist`.

### Eval: every question fails with "Unknown action type returned from plugin"
It was run through `tsx` instead of the compiled build. Use `npm run eval`,
which compiles first (D-021).

## Run the model eval

Runs the 35 golden questions against a real model (billed, about 6,600 input
tokens per question). No `gcloud` needed: the token comes from your Firebase
CLI login and stays in memory.
```
cd v2/backend/functions
FT=$(npm root -g)/firebase-tools/lib
EVAL_ACCESS_TOKEN=$(node -e "
const {configstore}=require('$FT/configstore.js'); const a=require('$FT/auth.js');
a.getAccessToken(configstore.get('tokens').refresh_token,['https://www.googleapis.com/auth/cloud-platform']).then(t=>process.stdout.write(t.access_token));
") GOOGLE_CLOUD_PROJECT=expense-tracker-v2-5c9fa VERTEX_LOCATION=global \
  npm run eval -- --model vertexai/gemini-3.8-flash
```
Add `,vertex-model-garden/claude-sonnet-5` to `--model` to compare (once the
Claude quota exists), or `--only spend_oct,goa_trip` for a quick check. The
token lasts about an hour. Results are written to `lib-eval/eval/results/`.

## Data migration v1 → v2 (not run)

`backend/functions/src/scripts/migrate-v1-to-v2.ts`. Dry-run by default,
never writes to the source, prints per-home counts and income/expense sums
for source vs target. **Needs the owner's explicit go-ahead** and a
service-account key for each project (keys are gitignored). See
`backend/README.md` for flags. Afterwards run
`src/scripts/backfill-embeddings.ts` and the smoke test.

## Costs to watch

- Cloud Functions min instances are 0; idle cost is near zero.
- Each saved entry with a note makes one embedding call.
- Each assistant question makes several model calls (one per tool round).
- Artifact Registry cleanup policy deletes images older than 1 day (set by
  the first deploy).
