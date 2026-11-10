/// Category breakdown, multi-month trends and CSV export.
/// Replaces the inline logic of the original Analysis and Trends screens
/// (`analysis.component.ts`, `trends.component.ts`), with two fixes: the top
/// category counts all of its spend, and the monthly average divides by every
/// month in the window.
library;

import 'models.dart';

class CategoryShare {
  const CategoryShare({
    required this.categoryId,
    required this.total,
    required this.count,
    required this.share,
  });

  final String categoryId;
  final double total;
  final int count;

  /// Fraction of the period's expenses, 0-1.
  final double share;
}

class Breakdown {
  const Breakdown({required this.total, required this.categories, required this.transactions});

  final double total;
  final List<CategoryShare> categories;

  /// Expenses in the period, newest first.
  final List<Transaction> transactions;
}

/// Expenses from [start] (inclusive) to [end] (exclusive), largest category first.
Breakdown categoryBreakdown(
  Iterable<Transaction> txs, {
  required DateTime start,
  required DateTime end,
  String? userId,
}) {
  final inRange = txs
      .where((t) =>
          t.isExpense &&
          !t.date.isBefore(start) &&
          t.date.isBefore(end) &&
          (userId == null || t.userId == userId))
      .toList()
    ..sort((a, b) => b.date.compareTo(a.date));
  final totals = <String, double>{};
  final counts = <String, int>{};
  var total = 0.0;
  for (final t in inRange) {
    totals[t.categoryId] = (totals[t.categoryId] ?? 0) + t.amount;
    counts[t.categoryId] = (counts[t.categoryId] ?? 0) + 1;
    total += t.amount;
  }
  final categories = [
    for (final e in totals.entries)
      CategoryShare(
        categoryId: e.key,
        total: e.value,
        count: counts[e.key]!,
        share: total > 0 ? e.value / total : 0,
      ),
  ]..sort((a, b) {
      final c = b.total.compareTo(a.total);
      return c != 0 ? c : a.categoryId.compareTo(b.categoryId);
    });
  return Breakdown(total: total, categories: categories, transactions: inRange);
}

class MonthBucket {
  const MonthBucket({required this.month, required this.total, required this.byCategory});

  /// First day of the month.
  final DateTime month;
  final double total;
  final Map<String, double> byCategory;
}

class MonthChange {
  const MonthChange({required this.month, required this.delta, required this.pct});

  final DateTime month;

  /// Change in spend from the previous month (positive = more).
  final double delta;
  final double pct;
}

class Trends {
  const Trends({
    required this.months,
    required this.total,
    required this.monthlyAverage,
    this.peak,
    this.lowest,
    this.biggestSpike,
    this.biggestDrop,
    this.topCategoryId,
    this.topCategoryTotal = 0,
    this.risingCategoryId,
  });

  /// Oldest first, ending with the current month.
  final List<MonthBucket> months;
  final double total;
  final double monthlyAverage;
  final MonthBucket? peak;

  /// Lowest month that had any spend; null unless two months had spend.
  final MonthBucket? lowest;
  final MonthChange? biggestSpike;
  final MonthChange? biggestDrop;
  final String? topCategoryId;
  final double topCategoryTotal;

  /// A category whose spend rose in each of the last three months.
  final String? risingCategoryId;

  bool get hasData => total > 0;
}

/// Expense trends over the [monthCount] calendar months ending at [now]'s month.
Trends computeTrends(
  Iterable<Transaction> txs, {
  required DateTime now,
  required int monthCount,
  String? userId,
}) {
  final starts = [
    for (var i = monthCount - 1; i >= 0; i--) DateTime(now.year, now.month - i, 1),
  ];
  final index = {for (var i = 0; i < starts.length; i++) starts[i]: i};
  final totals = List<double>.filled(monthCount, 0);
  final byCat = List.generate(monthCount, (_) => <String, double>{});
  final catTotals = <String, double>{};

  for (final t in txs) {
    if (!t.isExpense || (userId != null && t.userId != userId)) continue;
    final i = index[DateTime(t.date.year, t.date.month, 1)];
    if (i == null) continue;
    totals[i] += t.amount;
    byCat[i][t.categoryId] = (byCat[i][t.categoryId] ?? 0) + t.amount;
    catTotals[t.categoryId] = (catTotals[t.categoryId] ?? 0) + t.amount;
  }

  final months = [
    for (var i = 0; i < monthCount; i++)
      MonthBucket(month: starts[i], total: totals[i], byCategory: byCat[i]),
  ];
  final total = totals.fold(0.0, (a, b) => a + b);
  if (total <= 0) {
    return Trends(months: months, total: 0, monthlyAverage: 0);
  }

  final withSpend = months.where((m) => m.total > 0).toList();
  final peak = withSpend.reduce((a, b) => b.total > a.total ? b : a);
  final lowest =
      withSpend.length >= 2 ? withSpend.reduce((a, b) => b.total < a.total ? b : a) : null;

  MonthChange? spike, drop;
  for (var i = 1; i < monthCount; i++) {
    final prev = totals[i - 1];
    if (prev <= 0) continue;
    final delta = totals[i] - prev;
    final change = MonthChange(month: starts[i], delta: delta, pct: delta / prev * 100);
    if (delta > 0 && (spike == null || delta > spike.delta)) spike = change;
    if (delta < 0 && (drop == null || delta < drop.delta)) drop = change;
  }

  final top = catTotals.entries.reduce((a, b) => b.value > a.value ? b : a);

  String? rising;
  if (monthCount >= 3) {
    var best = 0.0;
    for (final id in catTotals.keys) {
      final a = byCat[monthCount - 3][id] ?? 0;
      final b = byCat[monthCount - 2][id] ?? 0;
      final c = byCat[monthCount - 1][id] ?? 0;
      if (a > 0 && b > a && c > b && c - a > best) {
        best = c - a;
        rising = id;
      }
    }
  }

  return Trends(
    months: months,
    total: total,
    monthlyAverage: total / monthCount,
    peak: peak,
    lowest: lowest,
    biggestSpike: spike,
    biggestDrop: drop,
    topCategoryId: top.key,
    topCategoryTotal: top.value,
    risingCategoryId: rising,
  );
}

String _csvCell(String value) {
  // Neutralise spreadsheet formulas in free text, then quote as needed.
  var v = value;
  if (v.isNotEmpty && '=+-@\t\r'.contains(v[0])) v = "'$v";
  if (v.contains(RegExp(r'[",\n\r]'))) v = '"${v.replaceAll('"', '""')}"';
  return v;
}

String _two(int n) => n.toString().padLeft(2, '0');

/// CSV with the same columns as the original export:
/// `Date,Type,Amount,Category,Note,Tags,User,Email`. Rows are oldest first.
String buildTransactionsCsv(
  Iterable<Transaction> txs, {
  required String Function(String categoryId) categoryName,
  required String Function(String tagId) tagName,
  required String Function(String userId) userName,
}) {
  final sorted = txs.toList()..sort((a, b) => a.date.compareTo(b.date));
  final out = StringBuffer('Date,Type,Amount,Category,Note,Tags,User,Email\r\n');
  for (final t in sorted) {
    final d = t.date;
    out.writeAll([
      '${d.year}-${_two(d.month)}-${_two(d.day)} ${_two(d.hour)}:${_two(d.minute)}',
      t.type.name,
      t.amount.toStringAsFixed(2),
      _csvCell(categoryName(t.categoryId)),
      _csvCell(t.note ?? ''),
      _csvCell(t.tagIds.map(tagName).where((n) => n.isNotEmpty).join('; ')),
      _csvCell(t.userId == null ? '' : userName(t.userId!)),
      _csvCell(t.userEmail ?? ''),
    ], ',');
    out.write('\r\n');
  }
  return out.toString();
}
