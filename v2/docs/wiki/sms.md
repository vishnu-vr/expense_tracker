# Bank SMS detection (Android)

## Today: suggestions only

| Part | File |
|---|---|
| Receiver (system broadcast only, `BROADCAST_SMS`) | `app/android/app/src/main/kotlin/com/vapps/track_expense/SmsReceiver.kt` |
| Parser | `…/SmsParser.kt`, tests in `app/android/app/src/test/…/SmsParserTest.kt` |
| Toggle + dedupe store | `…/SmsPrefs.kt` (SharedPreferences `sms_detection`) |
| Platform channel `track_expense/sms` | `…/MainActivity.kt` ↔ `app/lib/core/data/sms_detection.dart` |
| Settings screen | `app/lib/features/sms/sms_screen.dart` (Profile › Bank SMS detection) |

Flow: message arrives → toggle on and `RECEIVE_SMS` granted? → parse →
duplicate within 30 s? → notification "Add this entry?" → tap opens
`trackexpense://app/add?type=…&amount=…&date=<SMS time>` → form prefilled,
user picks a category and saves.

Parser rules (from v1, two fixes): a message passes if it has a transaction
word (debit, credit, UPI, a/c, txn…) or a currency hint (INR, Rs, ₹). OTP
messages are ignored. Credit words (credited, received, deposited, refund)
mean income, otherwise expense. Currency tokens must start a word, so
"hours 2" is no longer read as "Rs 2". India only: INR and UPI/IMPS/NEFT/RTGS.

Privacy: message text is never logged, stored or uploaded.

## Next: auto-add (planned, not started)

The owner wants a toggle that categorises and adds entries by itself. Open
questions to settle in its own plan:

- **Where categorisation runs.** On-device model (message never leaves the
  phone) vs the server (better accuracy, needs the text uploaded). Spike
  first: see [roadmap.md](roadmap.md) "On-device AI".
- **Confidence and review.** Auto-add above a threshold, queue the rest as
  pending suggestions in the app (survives a dismissed notification).
- **Dedupe against saved entries**, not just the last message.
- **Merchant extraction** (payee, account last-4, UPI ref) with per-bank
  templates; reuse `merchant_dictionary.dart`.
- **Play Store.** `RECEIVE_SMS` is a restricted permission; a Permissions
  Declaration is required and expense tracking must still qualify under the
  current SMS/Call Log policy. Check before investing in auto-add.

## Testing by hand

```
adb emu sms send HDFCBK "Rs.1,499.00 debited from A/c XX1234 to SWIGGY. UPI Ref 123456789012"
```
The toggle must be on (Profile › Bank SMS detection) and both permissions
granted.
