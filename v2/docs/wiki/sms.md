# Bank SMS detection and auto-add (Android)

Two modes, both off by default, in Profile › Bank SMS detection:

| Mode | What happens | Decision |
|---|---|---|
| Suggest (detection on) | "Add this entry?" notification; the form opens prefilled; you pick a category and save | D-005 |
| Auto-add (also on, **experimental**) | Confident entries are saved by themselves with Undo/Change and marked **Auto** until checked; the rest go to Review detected entries and the notification asks "what was this for?" | D-029, D-030, D-031 |

The message text is never logged, stored, uploaded or passed on. Auto-add
keeps only the parsed fields: amount, direction, time, payee, bank and the
last digits of the account (the UPI/reference number only as a hash, to drop
repeats). Payee memory keys are salted hashes; phone numbers are never stored
and are shown as "UPI xxxxx1234" (D-030).

## Parts

| Part | File |
|---|---|
| Receiver (system broadcast only, `BROADCAST_SMS`) | `app/android/app/src/main/kotlin/com/vapps/track_expense/SmsReceiver.kt` |
| Parser: suggestion `parse`, auto-add `parseDetails` (templates) | `…/SmsParser.kt` |
| Merchant key (same as Dart) | `…/MerchantKey.kt` ↔ `app/lib/core/domain/sms_categories.dart`, vectors in `app/test/fixtures/merchant_key_vectors.json` |
| Toggles, table, 7-day dedupe (`SeenLog`) | `…/SmsPrefs.kt` (SharedPreferences `sms_detection`) |
| Lookup table + confidence decision, quick suggestions, reply guess, note rule | `…/CategoryTable.kt` (`SmsCategoriser`, `QuickSuggest`, `ReplyCategoriser`, `SmsNote`) |
| Payee memory (salted hashes, entry → payee for edits) | `…/PayeeMemory.kt` |
| Notification answers (one-tap, Reply) | `…/SmsLabeller.kt` (`LabelLogic`) |
| Native entry write (worker and notification actions; `SmsSave` decides the `autoAdded` marker) | `…/SmsEntryWriter.kt` |
| Evening catch-up (about 20:30) | `…/SmsCatchUpWorker.kt` (`CatchUp`) |
| Auto-add worker (native Firebase, duplicate check, write) | `…/SmsAutoAddWorker.kt`, `…/NativeFirebase.kt` |
| Review list (parsed fields, 100 items, 30 days) | `…/SmsReviewQueue.kt` |
| Notifications (private on the lock screen), Undo, category buttons, Reply | `…/SmsNotifications.kt`, `…/SmsActionReceiver.kt` |
| Gemini Nano (foreground only) and its status (`NanoStatusMapper`); shared prompt and answer check (`NanoPrompt`) | `…/NanoCategoriser.kt` |
| Category suggestions (D-032): `AiMode`, `CategorySuggester` (None, Cloud, Gemma, Nano), `Suggesters`, `AiSuggest` | `…/CategorySuggester.kt` |
| Gemma 3 1B on the phone (LiteRT-LM), memory gate | `…/OnDeviceLlm.kt` |
| Model download (manifest, resume, SHA-256), states, `GemmaDownloadWorker` | `…/GemmaModel.kt` |
| AI on unclear reply words, off the receiver (`SmsSuggestWorker`) | `…/SmsLabeller.kt` |
| Cloud suggestions callable | `backend/functions/src/handlers/suggest-sms-category.ts`, `src/core/sms-suggest.ts` |
| Platform channel `track_expense/sms` | `…/MainActivity.kt` ↔ `app/lib/core/data/sms_detection.dart` |
| Table builder, confidence rule, quick suggestions, reply words, note rule (pure Dart) | `app/lib/core/domain/sms_categories.dart` |
| Settings / review screens | `app/lib/features/sms/sms_screen.dart`, `review_screen.dart` (`/sms/review`) |
| Auto-added entries to check (pure Dart), Ledger filter, Looks right, Home line | `app/lib/core/domain/auto_added.dart`, `features/ledger/ledger_screen.dart`, `features/entry/entry_screen.dart`, `features/home/home_screen.dart` |
| Kotlin tests | `app/android/app/src/test/…/SmsParserTest.kt`, `SmsTemplatesTest.kt`, `AutoAddLogicTest.kt`, `HumanInTheLoopTest.kt`, `AutoAddedMarkerTest.kt`, `CategoryAiTest.kt` |

## Auto-add flow

```
SMS → SmsReceiver: detection + auto-add on, RECEIVE_SMS granted
    → parseDetails: not a completed transaction (promo, "is due", request,
      declined, OTP)? drop.   No amount? fall back to "Add this entry?"
    → payee identity (tel:/vpa:/name:) → salted hash; the raw value is dropped
    → SeenLog: same reference hash or fingerprint in 7 days? drop
    → expedited SmsAutoAddWorker (parsed fields only)
Worker → SmsCategoriser with the table the app pushed:
         remembered payee (D-030) → history ("expense:swiggy" → food)
         → canonical merchant's history → built-in default → none
       → confident (money moved + amount + payee + rules category + signed in)?
           yes: same user/direction/amount within ±15 min already saved? stop.
                else write `transactions` with source "sms",
                autoAdded true (D-031), note
                "Swiggy · HDFC XX1234"; notify "Added ₹1,499 expense ·
                Swiggy → Food" [Undo] [Change → /edit/<id>]
           no:  add to the review list; notify "₹150 to Ramesh K — what was
                this for?" [Transportation] [Food] [Reply] (D-030), or
                "Review detected entry" → /sms/review when it cannot save
Buttons → save natively, remember the payee, "Added … · Undo · Change"
Reply   → words → category from household words / keywords / merchants;
          all agree: save with note "auto to office · Ramesh K";
          else "Which category for 'auto'?" + buttons, words kept in the list
20:30   → "3 payments need a description" → /sms/review (Evening reminder)
App   → Home banner "N detected entries to review"; the review list asks
        the chosen model (D-032) for categories of payees the rules could
        not place (it never saves; AI rows have Approve); each row has a note field and quick category chips (one
        tap saves and remembers the payee), "Other…" or tapping opens the
        form prefilled, swipe dismisses. Editing an SMS entry later updates
        the payee memory; "Forget remembered payees" clears it.
App   → auto-added entries show an "Auto" badge (confirmed ones "SMS");
        Home "N auto-added entries to check" (yours, last 30 days) opens the
        Ledger's "Auto-added" filter; "Looks right" on the entry, or saving
        an edit, clears the marker (D-031)
```

## Category suggestions (D-032)

SMS settings › **Category suggestions** (shown with auto-add on):

| Option | What it uses | Notes |
|---|---|---|
| Off (default) | Rules, history, payee memory only | |
| Cloud | `suggestSmsCategory` on Gemini Flash-Lite (default) or Flash | "Sends only the payee name or your reply words, never the SMS." Works in the background; needs network |
| On-device: Gemma 3 1B | LiteRT-LM on the CPU, model downloaded once (557 MB) | "Nothing leaves the phone." Download on Wi-Fi with progress, Cancel, Delete; "Model not available yet" until the file is in the bucket. Needs ≥ 4 GB RAM and 1 GB free at the time |
| Gemini Nano | ML Kit Prompt API | Listed only where supported; runs only while the review list is open |

Whatever the model says only preselects a category, labelled **Suggested by
AI · <model>**. Nothing it suggests is saved until the user approves:

```
Worker: Review, nothing placed it, payee is a name → chosen model (Cloud/Gemma)
        → answer: review item {categorySource: "ai", aiModel}
          notify "₹420 to BLUE TOKAI — AI suggests Food"
          [Approve] (= the category button: user-confirmed, no Auto marker,
          payee memory learns it) [Change] (form prefilled) [Reply]
        → no answer / failure: the D-030 question as before
Reply unclear → SmsSuggestWorker asks about the words → same AI notification
Review list  → asks the chosen model (Nano too) for up to 5 open items;
               AI rows have Approve; "Approve all AI suggestions (N)" asks
               "Approve N AI suggestions?" first
```

Gemma is provided under and subject to the Gemma Terms of Use found at
ai.google.dev/gemma/terms (shown on the download option).

To test the download by hand, upload the model first (operations.md ›
On-device model), pick Gemma, tap **Download on Wi-Fi** (the emulator's
network counts as unmetered), watch the progress notification, then send an
unknown payee:

```
adb emu sms send HDFCBK "Rs.420.00 debited from A/c XX1234 on 17-11-26 to VPA bluetokai@okicici (UPI Ref No 444455556666). Not you? Call 18002586161"
```

## Auto-added marker (D-031)

Only a fully automatic save (rules, history or a remembered payee, nobody
asked) writes `autoAdded: true`. A notification category button, a Reply and
the review list (chip or form) are the user's own answer: no marker, the
entry shows **SMS**. The marker stays until the entry's owner taps **Looks
right** on the entry screen or saves an edit; housemates see the **Auto**
badge and "Not checked yet" but no button, and the Home count and Ledger
filter only list your own entries.

The app pushes the table 2 s after entries change while signed in, and
clears it on sign-out. Demo and emulator builds push no Firebase ids, so
there everything goes to the review list.

Parser templates (from public formats; no real messages yet): HDFC (UPI
"Sent … To", "debited … to VPA", card "Spent … At", NEFT credit, UPI credit),
ICICI (UPI "debited …; X credited", card "spent using … on X", credit), SBI
(UPI "debited by … trf to", "credited by", "has a debit by transfer", card
"spent … at"), Axis (multi-line UPI/P2M, card, UPI/P2A credit), Kotak (UPI
sent/received, card), generic ("paid Rs … to X via UPI", "towards X",
account-to-account). Payees that are phone-number UPI handles are shown as
"UPI xxxxx1234" and used only as a hashed memory key.

Parser rules shared with suggestions (from v1, two fixes): a message passes
if it has a transaction word (debit, credit, UPI, a/c, txn…) or a currency
hint (INR, Rs, ₹). Currency tokens must start a word. India only.

## Testing by hand

Debug build, emulator or phone. Detection and auto-add on, both permissions
granted. Do not force-stop the app before sending (a force-stopped app gets
no SMS broadcasts until it is opened again); `adb shell am kill` is fine.

```
adb emu sms send HDFCBK "Rs.1,499.00 debited from A/c XX1234 on 17-11-26 to VPA swiggy@icici (UPI Ref No 123456789012). Not you? Call 18002586161"
adb emu sms send KOTAKB "Sent Rs.320.00 from Kotak Bank AC X5678 to rameshstores@okhdfc on 17-11-26.UPI Ref 998877665544."
adb emu sms send HDFCBK "Get up to Rs.5000 cashback on your HDFC Credit Card. Click here to apply now!"
```

The emulator console sends one line only (no multi-line Axis messages).

Notification questions (D-030) need a table that can write. In a demo build
you can push a test table with fake Firebase ids into `sms_detection.xml`
(kill the app process first with `adb shell run-as com.vapps.track_expense
kill <pid>`, not force-stop); answers then end in "Could not save the entry",
which still shows the whole flow. Send a payment to a phone-number handle:

```
adb emu sms send HDFCBK "Rs.150.00 debited from A/c XX1234 on 17-11-26 to VPA 9876543210@ybl (UPI Ref No 555566667777). Not you? Call 18002586161"
```

Expand it in the shade (`adb shell cmd statusbar expand-notifications`) and
use the buttons or Reply. Force the evening job with `adb shell cmd
jobscheduler run -f -n androidx.work.systemjobscheduler com.vapps.track_expense <id>`
(the id is in `adb shell dumpsys jobscheduler`).
Signed in to the real project, the first (Swiggy, a built-in merchant) is
added with Undo/Change; sending it again adds nothing. The second (unknown
payee) lands in the review list. The promotion is ignored. In a demo build
all detected entries go to the review list. Inspect the review list with
`adb shell run-as com.vapps.track_expense cat shared_prefs/sms_detection.xml`.
Full checklist: [testing.md](testing.md#manual-sms-auto-add-checklist-d-029).

## Gemini Nano status

Profile › Bank SMS detection › On-device AI shows why it is or is not
available, with "Check again" (D-030). Galaxy S24 series phones are not on
the ML Kit GenAI Prompt API device list (Samsung starts at the Galaxy S25),
so they show "Not supported on this phone yet". The small line under it is
the "Android AICore" version, or "AICore not installed".

## Play Store

`RECEIVE_SMS` is a restricted permission: a Permissions Declaration under the
SMS/Call Log policy is needed before any Play release (owner item in
[roadmap.md](roadmap.md)). App Distribution is not affected.
