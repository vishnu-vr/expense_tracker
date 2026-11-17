# Bank SMS detection and auto-add (Android)

Two modes, both off by default, in Profile › Bank SMS detection:

| Mode | What happens | Decision |
|---|---|---|
| Suggest (detection on) | "Add this entry?" notification; the form opens prefilled; you pick a category and save | D-005 |
| Auto-add (also on, **experimental**) | Confident entries are saved by themselves with Undo/Change; the rest go to Review detected entries | D-029 |

The message text is never logged, stored, uploaded or passed on. Auto-add
keeps only the parsed fields: amount, direction, time, payee, bank and the
last digits of the account (the UPI/reference number only as a hash, to drop
repeats).

## Parts

| Part | File |
|---|---|
| Receiver (system broadcast only, `BROADCAST_SMS`) | `app/android/app/src/main/kotlin/com/vapps/track_expense/SmsReceiver.kt` |
| Parser: suggestion `parse`, auto-add `parseDetails` (templates) | `…/SmsParser.kt` |
| Merchant key (same as Dart) | `…/MerchantKey.kt` ↔ `app/lib/core/domain/sms_categories.dart`, vectors in `app/test/fixtures/merchant_key_vectors.json` |
| Toggles, table, 7-day dedupe (`SeenLog`) | `…/SmsPrefs.kt` (SharedPreferences `sms_detection`) |
| Lookup table + confidence decision | `…/CategoryTable.kt` (`SmsCategoriser`) |
| Auto-add worker (native Firebase, duplicate check, write) | `…/SmsAutoAddWorker.kt`, `…/NativeFirebase.kt` |
| Review list (parsed fields, 100 items, 30 days) | `…/SmsReviewQueue.kt` |
| Notifications (private on the lock screen), Undo | `…/SmsNotifications.kt`, `…/SmsActionReceiver.kt` |
| Gemini Nano (foreground only) | `…/NanoCategoriser.kt` |
| Platform channel `track_expense/sms` | `…/MainActivity.kt` ↔ `app/lib/core/data/sms_detection.dart` |
| Table builder and confidence rule (pure Dart) | `app/lib/core/domain/sms_categories.dart` |
| Settings / review screens | `app/lib/features/sms/sms_screen.dart`, `review_screen.dart` (`/sms/review`) |
| Kotlin tests | `app/android/app/src/test/…/SmsParserTest.kt`, `SmsTemplatesTest.kt`, `AutoAddLogicTest.kt` |

## Auto-add flow

```
SMS → SmsReceiver: detection + auto-add on, RECEIVE_SMS granted
    → parseDetails: not a completed transaction (promo, "is due", request,
      declined, OTP)? drop.   No amount? fall back to "Add this entry?"
    → SeenLog: same reference hash or fingerprint in 7 days? drop
    → expedited SmsAutoAddWorker (parsed fields only)
Worker → SmsCategoriser with the table the app pushed:
         history ("expense:swiggy" → food) → canonical merchant's history
         → built-in default → none
       → confident (money moved + amount + payee + rules category + signed in)?
           yes: same user/direction/amount within ±15 min already saved? stop.
                else write `transactions` with source "sms", note
                "Swiggy · HDFC XX1234"; notify "Added ₹1,499 expense ·
                Swiggy → Food" [Undo] [Change → /edit/<id>]
           no:  add to the review list; notify "Review detected entry" → /sms/review
App   → Home banner "N detected entries to review"; the review list asks
        Gemini Nano (if available) for categories of payees the rules could
        not place; Add saves, tapping opens the form prefilled, swipe dismisses.
```

The app pushes the table 2 s after entries change while signed in, and
clears it on sign-out. Demo and emulator builds push no Firebase ids, so
there everything goes to the review list.

Parser templates (from public formats; no real messages yet): HDFC (UPI
"Sent … To", "debited … to VPA", card "Spent … At", NEFT credit, UPI credit),
ICICI (UPI "debited …; X credited", card "spent using … on X", credit), SBI
(UPI "debited by … trf to", "credited by", "has a debit by transfer", card
"spent … at"), Axis (multi-line UPI/P2M, card, UPI/P2A credit), Kotak (UPI
sent/received, card), generic ("paid Rs … to X via UPI", "towards X",
account-to-account). Payees that are phone-number UPI handles are not kept.

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
Signed in to the real project, the first (Swiggy, a built-in merchant) is
added with Undo/Change; sending it again adds nothing. The second (unknown
payee) lands in the review list. The promotion is ignored. In a demo build
all detected entries go to the review list. Inspect the review list with
`adb shell run-as com.vapps.track_expense cat shared_prefs/sms_detection.xml`.
Full checklist: [testing.md](testing.md#manual-sms-auto-add-checklist-d-029).

## Play Store

`RECEIVE_SMS` is a restricted permission: a Permissions Declaration under the
SMS/Call Log policy is needed before any Play release (owner item in
[roadmap.md](roadmap.md)). App Distribution is not affected.
