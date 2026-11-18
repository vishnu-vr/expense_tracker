/// Entries the phone saved from bank messages without asking (D-031).
library;

import 'models.dart';

/// How far back Home looks for auto-added entries to check.
const autoAddedCheckDays = 30;

/// [userId]'s auto-added entries not yet checked, newest first. Only the
/// owner can clear the marker, so other members' entries are left out.
/// With [now], only the last [autoAddedCheckDays] days count.
List<Transaction> autoAddedToCheck(List<Transaction> txs, String userId, {DateTime? now}) {
  final since = now?.subtract(const Duration(days: autoAddedCheckDays));
  return txs
      .where((t) =>
          t.autoAdded &&
          t.userId == userId &&
          (since == null || !t.date.isBefore(since)))
      .toList()
    ..sort((a, b) => b.date.compareTo(a.date));
}

/// "1 auto-added entry to check" / "5 auto-added entries to check".
String autoAddedToCheckLabel(int n) =>
    n == 1 ? '1 auto-added entry to check' : '$n auto-added entries to check';
