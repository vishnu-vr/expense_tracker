import 'package:intl/intl.dart';

final _inr = NumberFormat.currency(locale: 'en_IN', symbol: '₹', decimalDigits: 0);
final _inrExact = NumberFormat.currency(locale: 'en_IN', symbol: '₹', decimalDigits: 2);

const hiddenAmount = '••••';

final _amountInText = RegExp(r'[+−-]?(?:₹|Rs\.?|INR)\s?[\d,]+(?:\.\d+)?', caseSensitive: false);

/// "₹1,20,000" (Indian digit grouping). Paise are shown only when present.
String formatMoney(num amount) {
  final a = amount.abs();
  return (a == a.roundToDouble() ? _inr : _inrExact).format(a);
}

/// "+₹95,400" / "−₹480" / "₹0".
String formatSignedMoney(num amount) {
  if (amount == 0) return formatMoney(0);
  return '${amount > 0 ? '+' : '−'}${formatMoney(amount)}';
}

/// Formats amounts, or masks them when the user has turned on "hide amounts".
class Money {
  const Money({this.hidden = false});

  final bool hidden;

  String call(num amount) => hidden ? hiddenAmount : formatMoney(amount);
  String signed(num amount) => hidden ? hiddenAmount : formatSignedMoney(amount);

  /// Masks rupee amounts inside free text (insight cards, assistant replies).
  String text(String value) => hidden ? value.replaceAll(_amountInText, hiddenAmount) : value;
}

const _months = [
  'January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December',
];
const _weekdays = [
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
];

String monthName(int month) => _months[month - 1];
String shortMonth(int month) => _months[month - 1].substring(0, 3);
String weekdayName(DateTime d) => _weekdays[d.weekday - 1];

/// "3 Nov" or "3 Nov 2025" when the year differs from [now].
String shortDate(DateTime d, [DateTime? now]) {
  final base = '${d.day} ${shortMonth(d.month)}';
  return now != null && now.year == d.year ? base : '$base ${d.year}';
}

/// "November 2026".
String monthYear(DateTime d) => '${monthName(d.month)} ${d.year}';

/// "9:05 pm".
String timeOfDay(DateTime d) {
  final h = d.hour % 12 == 0 ? 12 : d.hour % 12;
  return '$h:${d.minute.toString().padLeft(2, '0')} ${d.hour < 12 ? 'am' : 'pm'}';
}

/// "Today", "Yesterday" or "3 Nov".
String relativeDay(DateTime date, DateTime now) {
  final d = DateTime(date.year, date.month, date.day);
  final today = DateTime(now.year, now.month, now.day);
  final diff = today.difference(d).inDays;
  if (diff == 0) return 'Today';
  if (diff == 1) return 'Yesterday';
  return shortDate(date, now);
}
