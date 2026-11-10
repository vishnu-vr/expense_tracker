/// Recurring-expense detection from transaction history.
/// Ported from `src/app/core/utils/recurring-expenses.ts`.
library;

import 'dart:math' as math;

import 'models.dart';

class RecurringExpenseInsight {
  const RecurringExpenseInsight({
    required this.key,
    required this.label,
    required this.categoryId,
    required this.categoryName,
    required this.cadenceLabel,
    required this.averageAmount,
    required this.occurrences,
    required this.lastPaidDate,
  });

  final String key;
  final String label;
  final String categoryId;
  final String categoryName;
  final String cadenceLabel;
  final double averageAmount;
  final int occurrences;
  final DateTime lastPaidDate;
}

final _digits = RegExp(r'\d+');
final _nonWord = RegExp(r'[^\w\s]');
final _spaces = RegExp(r'\s+');

String _normalizeNote(String? note) {
  if (note == null || note.isEmpty) return '';
  return note
      .toLowerCase()
      .replaceAll(_digits, ' ')
      .replaceAll(_nonWord, ' ')
      .replaceAll(_spaces, ' ')
      .trim();
}

String _toTitleCase(String text) => text
    .split(' ')
    .where((w) => w.isNotEmpty)
    .map((w) => w[0].toUpperCase() + w.substring(1))
    .join(' ');

double _average(List<num> values) {
  if (values.isEmpty) return 0;
  return values.fold<double>(0, (sum, v) => sum + v) / values.length;
}

double _standardDeviation(List<num> values, double mean) {
  if (values.isEmpty) return 0;
  final variance = values.fold<double>(0, (sum, v) {
        final delta = v - mean;
        return sum + delta * delta;
      }) /
      values.length;
  return math.sqrt(variance);
}

String? _detectCadence(double avgInterval, double stdDev) {
  if (avgInterval >= 5 && avgInterval <= 9 && stdDev <= 2) return 'weekly';
  if (avgInterval >= 10 && avgInterval <= 18 && stdDev <= 3) {
    return 'every 2 weeks';
  }
  if (avgInterval >= 24 && avgInterval <= 40 && stdDev <= 7) return 'monthly';
  if (avgInterval >= 75 && avgInterval <= 105 && stdDev <= 12) {
    return 'quarterly';
  }
  return null;
}

/// Groups expenses by category + normalised note and keeps the groups with a
/// steady cadence and a stable amount. Needs at least three occurrences.
List<RecurringExpenseInsight> detectRecurringExpenses(
  Iterable<Transaction> expenses,
  String Function(String categoryId) categoryNameById, {
  int maxResults = 4,
  String? userId,
}) {
  final filtered = expenses
      .where((t) => t.isExpense)
      .where((t) => userId == null || userId.isEmpty || t.userId == userId)
      .toList();
  if (filtered.length < 3) return [];

  final groups = <String, List<({Transaction tx, String noteKey})>>{};
  for (final expense in filtered) {
    final noteKey = _normalizeNote(expense.note);
    final key =
        '${expense.categoryId}::${noteKey.isEmpty ? 'no-note' : noteKey}';
    groups.putIfAbsent(key, () => []).add((tx: expense, noteKey: noteKey));
  }

  final recurring = <RecurringExpenseInsight>[];
  groups.forEach((key, txns) {
    if (txns.length < 3) return;

    final sorted = [...txns]..sort((a, b) => a.tx.date.compareTo(b.tx.date));
    final intervals = <int>[];
    for (var i = 1; i < sorted.length; i++) {
      final ms = sorted[i].tx.date.millisecondsSinceEpoch -
          sorted[i - 1].tx.date.millisecondsSinceEpoch;
      intervals.add((ms / 86400000).round());
    }

    final avgInterval = _average(intervals);
    final cadence =
        _detectCadence(avgInterval, _standardDeviation(intervals, avgInterval));
    if (cadence == null) return;

    final amounts = sorted.map((t) => t.tx.amount).toList();
    final avgAmount = _average(amounts);
    if (avgAmount <= 0) return;

    final amountVariation = _standardDeviation(amounts, avgAmount) / avgAmount;
    final noteKey = sorted.first.noteKey;
    final maxVariation = noteKey.isEmpty ? 0.2 : 0.35;
    if (amountVariation > maxVariation) return;

    final categoryId = sorted.first.tx.categoryId;
    final name = categoryNameById(categoryId);
    final categoryName = name.isEmpty ? 'Uncategorized' : name;

    recurring.add(RecurringExpenseInsight(
      key: key,
      label: noteKey.isNotEmpty ? _toTitleCase(noteKey) : categoryName,
      categoryId: categoryId,
      categoryName: categoryName,
      cadenceLabel: cadence,
      averageAmount: avgAmount,
      occurrences: sorted.length,
      lastPaidDate: sorted.last.tx.date,
    ));
  });

  recurring.sort((a, b) => b.averageAmount.compareTo(a.averageAmount));
  return recurring.take(maxResults).toList();
}
