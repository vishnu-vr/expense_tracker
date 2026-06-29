package com.vapps.expensetracker;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.telephony.SmsMessage;
import android.text.TextUtils;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class SmsReceiver extends BroadcastReceiver {
    private static final String TAG = "SmsReceiver";
    private static final String SMS_ACTION = "android.provider.Telephony.SMS_RECEIVED";
    private static final String CHANNEL_ID = "sms_transaction_suggestions";
    private static final String CHANNEL_NAME = "Transaction suggestions";
    private static final String PREF_NAME = "sms_ingest_preferences";
    private static final String KEY_LAST_HASH = "last_sms_hash";
    private static final String KEY_LAST_TS = "last_sms_ts";
    private static final long DEDUP_WINDOW_MS = 30_000L;
    private static final int NOTIFICATION_PREVIEW_MAX = 220;

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !SMS_ACTION.equals(intent.getAction())) {
            Log.d(TAG, "Ignoring intent: " + (intent == null ? "null" : intent.getAction()));
            return;
        }

        if (!SmsIngestPlugin.isSmsIngestEnabled(context)) {
            Log.d(TAG, "SMS ingest disabled in preferences; skipping.");
            return;
        }

        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECEIVE_SMS) != PackageManager.PERMISSION_GRANTED) {
            Log.w(TAG, "RECEIVE_SMS permission not granted; skipping.");
            return;
        }

        Bundle bundle = intent.getExtras();
        if (bundle == null) {
            Log.w(TAG, "SMS intent had no extras; skipping.");
            return;
        }

        Object[] pdus = (Object[]) bundle.get("pdus");
        if (pdus == null || pdus.length == 0) {
            Log.w(TAG, "SMS intent had no PDUs; skipping.");
            return;
        }

        String format = bundle.getString("format");
        String sender = "";
        StringBuilder bodyBuilder = new StringBuilder();

        for (Object pdu : pdus) {
            SmsMessage message = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                ? SmsMessage.createFromPdu((byte[]) pdu, format)
                : SmsMessage.createFromPdu((byte[]) pdu);
            if (message == null) continue;
            if (TextUtils.isEmpty(sender)) {
                sender = message.getDisplayOriginatingAddress();
            }
            String chunk = message.getMessageBody();
            if (chunk != null) bodyBuilder.append(chunk);
        }

        String body = bodyBuilder.toString();
        Log.d(TAG, "Received SMS from='" + sender + "' body='" + body + "'");

        SmsTransactionSuggestion suggestion = parseTransactionSms(body);
        if (suggestion == null) {
            Log.d(TAG, "SMS did not look transactional; skipping.");
            return;
        }
        Log.d(TAG, "Parsed suggestion: " + suggestion);

        if (isDuplicate(context, sender, body)) {
            Log.d(TAG, "Duplicate SMS within dedup window; skipping notification.");
            return;
        }

        showSuggestionNotification(context, suggestion, body);
    }

    private SmsTransactionSuggestion parseTransactionSms(String body) {
        if (TextUtils.isEmpty(body)) return null;

        String normalized = body.toLowerCase(Locale.US);

        boolean looksTransactional = normalized.contains("debit")
            || normalized.contains("credit")
            || normalized.contains("spent")
            || normalized.contains("received")
            || normalized.contains("withdrawn")
            || normalized.contains("upi")
            || normalized.contains("imps")
            || normalized.contains("neft")
            || normalized.contains("rtgs")
            || normalized.contains("a/c")
            || normalized.contains("acct")
            || normalized.contains("account")
            || normalized.contains(" card")
            || normalized.contains("txn")
            || normalized.contains("transaction")
            || normalized.contains("transfer")
            || normalized.contains("paid")
            || normalized.contains("payment");

        boolean hasCurrencyHint = normalized.contains("inr")
            || normalized.contains("rs.")
            || normalized.contains("rs ")
            || normalized.contains("₹");

        if (!looksTransactional && !hasCurrencyHint) return null;

        Double amount = extractAmount(body);

        boolean credit = normalized.contains("credited")
            || normalized.contains("received")
            || normalized.contains("deposited")
            || normalized.contains("refund");
        String type = credit ? "income" : "expense";

        return new SmsTransactionSuggestion(amount, type);
    }

    private Double extractAmount(String body) {
        // [\s.:]* allows whitespace, dots, or colons between the currency token
        // and the amount (e.g. "INR 149", "INR.149.00", "Rs:149", "Rs. 149", "₹149").
        Pattern[] patterns = new Pattern[] {
            // "INR 149.00", "Rs. 149", "Rs.149", "Rs 149/-", "₹149", "INR.149.00"
            Pattern.compile("(?i)(?:rs\\.?|inr|₹)[\\s.:]*([0-9][0-9,]*(?:\\.\\d{1,2})?)"),
            // "149.00 INR", "149 Rs", "149.INR"
            Pattern.compile("(?i)([0-9][0-9,]*(?:\\.\\d{1,2})?)[\\s.:]*(?:rs\\.?|inr|₹)"),
            // "amount: 149.00", "amt 149", "amount.149"
            Pattern.compile("(?i)(?:amount|amt)[\\s.:]+(?:rs\\.?|inr|₹)?[\\s.:]*([0-9][0-9,]*(?:\\.\\d{1,2})?)")
        };

        for (Pattern p : patterns) {
            Matcher m = p.matcher(body);
            if (m.find()) {
                String raw = m.group(1);
                if (raw == null) continue;
                String clean = raw.replace(",", "");
                try {
                    double value = Double.parseDouble(clean);
                    if (value > 0) return value;
                } catch (NumberFormatException ignored) {
                    // try next pattern
                }
            }
        }
        return null;
    }

    private void showSuggestionNotification(Context context, SmsTransactionSuggestion suggestion, String body) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            Log.w(TAG, "POST_NOTIFICATIONS permission not granted; suggestion not shown.");
            return;
        }

        ensureChannel(context);

        Uri.Builder uriBuilder = new Uri.Builder()
            .scheme("com.vapps.expensetracker")
            .authority("add-transaction")
            .appendQueryParameter("smsPrefill", "1")
            .appendQueryParameter("type", suggestion.type);

        if (suggestion.amount != null) {
            uriBuilder.appendQueryParameter("amount", String.valueOf(suggestion.amount));
        }

        Intent openIntent = new Intent(Intent.ACTION_VIEW, uriBuilder.build());
        openIntent.setClass(context, MainActivity.class);
        openIntent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);

        PendingIntent pendingIntent = PendingIntent.getActivity(
            context,
            (int) System.currentTimeMillis(),
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        String title;
        String contentText;
        String bigText;
        String preview = buildBodyPreview(body);

        if (suggestion.amount != null) {
            title = "Add transaction?";
            contentText = String.format(Locale.US, "Detected ₹%.2f from SMS. Tap to add.", suggestion.amount);
            bigText = contentText + (TextUtils.isEmpty(preview) ? "" : "\n\n" + preview);
        } else {
            title = "Possible transaction detected";
            contentText = "Tap to review and add manually.";
            bigText = TextUtils.isEmpty(preview) ? contentText : contentText + "\n\n" + preview;
        }

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(contentText)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(bigText))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent);

        int notificationId = (int) (System.currentTimeMillis() & 0xfffffff);
        NotificationManagerCompat.from(context).notify(notificationId, builder.build());
        Log.d(TAG, "Posted notification id=" + notificationId + " amount=" + suggestion.amount + " type=" + suggestion.type);
    }

    private String buildBodyPreview(String body) {
        if (TextUtils.isEmpty(body)) return "";
        String collapsed = body.replaceAll("\\s+", " ").trim();
        if (collapsed.length() <= NOTIFICATION_PREVIEW_MAX) return collapsed;
        return collapsed.substring(0, NOTIFICATION_PREVIEW_MAX - 1) + "…";
    }

    private void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;
        NotificationChannel existing = manager.getNotificationChannel(CHANNEL_ID);
        if (existing != null) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("Suggestions to add transactions detected from incoming SMS.");
        manager.createNotificationChannel(channel);
    }

    private boolean isDuplicate(Context context, String sender, String body) {
        String normalizedBody = body.replaceAll("\\s+", " ").trim().toLowerCase(Locale.US);
        String hash = ((sender == null ? "" : sender) + "|" + normalizedBody).toLowerCase(Locale.US);
        long now = System.currentTimeMillis();

        android.content.SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
        String previousHash = prefs.getString(KEY_LAST_HASH, "");
        long previousTs = prefs.getLong(KEY_LAST_TS, 0L);
        boolean duplicate = hash.equals(previousHash) && (now - previousTs) < DEDUP_WINDOW_MS;

        prefs.edit().putString(KEY_LAST_HASH, hash).putLong(KEY_LAST_TS, now).apply();
        return duplicate;
    }

    private static class SmsTransactionSuggestion {
        final Double amount;
        final String type;

        SmsTransactionSuggestion(Double amount, String type) {
            this.amount = amount;
            this.type = type;
        }

        @Override
        public String toString() {
            return "SmsTransactionSuggestion{amount=" + amount + ", type='" + type + "'}";
        }
    }
}
