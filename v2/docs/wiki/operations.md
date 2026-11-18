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

## Distribute a test build (Firebase App Distribution)

```
cd v2/app
# bump `version:` in pubspec.yaml first (the +N build number must go up)
flutter build apk --release --dart-define=BACKEND=firebase
firebase appdistribution:distribute build/app/outputs/flutter-apk/app-release.apk \
  --app 1:117550011867:android:4d858566fa14bdfa91c3fe --project prod \
  --groups testers --release-notes "What changed"
```
Testers are in the `testers` group (add with
`firebase appdistribution:testers:add <email> --group-alias testers --project prod`).
Release builds are still signed with the debug key, which is fine for
testing; Play Store needs a real release key (and its SHA-1 registered for
Google sign-in). First build: 1.0.0 (1), 2026-11-14.

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
firebase deploy --only storage --project prod               # storage.rules (D-032)
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
`PASS`. Last result (2026-11-17): all 24 pass; the assistant answered in
about 12 s, and `suggestSmsCategory` filed "BLUE TOKAI COFFEE" as food and
"auto to office" as transportation in about 1.5 s on Flash-Lite.

If a run is interrupted, `node scripts/smoke-live.mjs --cleanup` removes
every leftover (homes named "Smoke test", their data, and auth users ending in
`@example.invalid`).

## Troubleshooting

### Callables return 401
Cloud Run needs `allUsers` → `roles/run.invoker` on each callable's service
(`askagent`, `joinhome`, `leavehome`, `confirmproposal`,
`exporttransactionscsv`, `suggestsmscategory`, region asia-south1). A newly
created callable gets it on create, but it can take a minute or two to
apply: `suggestSmsCategory` answered 401 right after its first deploy and
200 a few minutes later (2026-11-17). Sign-in is still enforced inside
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

Runs the 43 golden questions (35 typed English, 8 voice/Malayalam; D-028) against a real model. **It is billed:** about
6,600 input tokens per question, so about 230k input tokens per full run
(most of November's Gemini cost came from two full runs). Prefer `--only`
with a handful of ids for quick checks. No `gcloud` needed: the token comes from your Firebase
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

## Data migration v1 → v2 (done)

Done 2026-11-14 (D-023). Full plan, results and re-run steps:
[migration-plan.md](migration-plan.md). Source project: `public-exp-tracker`.


`backend/functions/src/scripts/migrate-v1-to-v2.ts`. Dry-run by default,
never writes to the source, prints per-home counts and income/expense sums
for source vs target. **Needs the owner's explicit go-ahead** and a
service-account key for each project (keys are gitignored). See
`backend/README.md` for flags. Afterwards run
`src/scripts/backfill-embeddings.ts` and the smoke test.

## Billing dashboard (D-024)

Profile › Admin › Billing & usage. Admin accounts only.

**1. Turn on the export (once, billing account admin, console).**
Billing › Billing export › **BigQuery export** › Standard usage cost › Edit
settings: project `expense-tracker-v2-5c9fa`, create dataset
`billing_export`, location **US (multi-region)**. The location cannot be
changed later; US/EU backfills from the start of the previous month. Data
arrives within a few hours (the first time up to 5 days). Until then the
screen shows these steps plus live usage.

**2. Check the functions' access.** The runtime service account
(`<project number>-compute@developer.gserviceaccount.com` unless changed)
needs BigQuery Job User, BigQuery Data Viewer and Monitoring Viewer on the
project. It normally has Editor, which covers all three. Check in the console
under IAM & Admin › IAM; grant only with the owner's go-ahead.

**3. Make an account admin.** The user must have signed in once. Get a
short-lived token from the signed-in Firebase CLI without writing it anywhere,
then preview and apply:
```
cd v2/backend/functions
export ADMIN_ACCESS_TOKEN="$(node -e '
  const {execSync}=require("child_process");
  const ft=execSync("npm root -g").toString().trim()+"/firebase-tools/lib";
  const {configstore}=require(ft+"/configstore.js");
  require(ft+"/auth.js").getAccessToken(configstore.get("tokens").refresh_token,
    ["https://www.googleapis.com/auth/cloud-platform"]).then(t=>process.stdout.write(t.access_token));')"
npm run set-admin -- --project expense-tracker-v2-5c9fa --email you@example.com            # preview
npm run set-admin -- --project expense-tracker-v2-5c9fa --email you@example.com --execute  # apply
unset ADMIN_ACCESS_TOKEN
```
Add `--revoke` to remove it. Other claims are kept. The app picks it up when
the ID token refreshes: sign out and back in.

**4. Deploy.** `firebase deploy --only functions:getAdminDashboard --project prod`
from `v2/backend`. A newly created callable gets the public invoker binding
(D-019); if it returns 401, see Troubleshooting › Callables return 401
(service `getadmindashboard`).

**Settings** (`functions/.env.<project>`): `BILLING_DATASET` (default
`billing_export`), `BILLING_LOCATION` (default `US`), `BILLING_PROJECT_ID`
(default: the functions' project).

**Troubleshooting**
- *Setup steps still show after enabling:* the export has not written its
  first table yet; wait (up to 5 days the first time). Results are also cached
  15 minutes per month.
- *"No billing data for this month":* the export exists but has nothing for
  that month (months before the backfill window).
- *"Could not read billing data this time":* the query failed; the function
  log has `Admin dashboard read failed` with `part` and HTTP `status`
  (403 = missing BigQuery roles).
- *Usage not available:* months older than about six weeks (Monitoring
  retention), or Monitoring returned an error (`part: "usage"` in the log).
- *Admin section missing:* the claim is not set, or the token has not
  refreshed; sign out and in.

## On-device model (D-032)

Cloud Storage for Firebase: default bucket
`expense-tracker-v2-5c9fa.firebasestorage.app`, asia-south1, STANDARD,
created 2026-11-17 (the Cloud Storage for Firebase API was enabled for it).
Rules: `backend/storage.rules` (signed-in users read `models/**`, no client
writes). The app downloads `models/gemma3-1b-it-int4.json` (the manifest),
then the file it names, and checks size and SHA-256.

```
cd v2/backend
node scripts/model-storage.mjs status                    # bucket and model files
node scripts/model-storage.mjs upload ~/Downloads/gemma3-1b-it-int4.litertlm
```
`upload` hashes the file, uploads it in 32 MiB chunks (resumable) to
`models/gemma3-1b-it-int4.litertlm`, checks the stored size, then writes the
manifest `{file, size, sha256, license}`. Apps pick it up on the next
"Download on Wi-Fi"; no release is needed. Record the size and SHA-256 in
`ON_DEVICE_MODEL` in `functions/src/config.ts` and in D-032.

Only upload the official file: Hugging Face `litert-community/Gemma3-1B-IT`,
`gemma3-1b-it-int4.litertlm` (584,417,280 bytes), downloaded after accepting
the Gemma terms (gated; there is no ungated official copy). Gemma is
provided under and subject to the Gemma Terms of Use found at
ai.google.dev/gemma/terms. `create-bucket` exists for a fresh project only.

## Costs to watch

- Cloud Functions min instances are 0; idle cost is near zero.
- Each saved entry with a note makes one embedding call.
- Each assistant question makes several model calls (one per tool round).
- SMS category suggestions on Cloud (D-032): about 300 input + 10 output
  Flash-Lite tokens per call, at most 100 calls per user per day.
- The on-device model download: about 0.58 GB of Storage egress per install
  (roughly ₹5–8), plus a few rupees a month to store it. asia-south1 has no
  free Storage tier.
- Artifact Registry cleanup policy deletes images older than 1 day (set by
  the first deploy).
