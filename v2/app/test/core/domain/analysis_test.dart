import 'package:flutter_test/flutter_test.dart';
import 'package:track_expense/core/domain/analysis.dart';
import 'package:track_expense/core/domain/models.dart';

var _n = 0;
Transaction _tx(double amount, DateTime date,
        {String cat = 'food',
        String? user,
        String? note,
        TransactionType type = TransactionType.expense,
        List<String> tags = const []}) =>
    Transaction(
      id: 't${_n++}',
      amount: amount,
      categoryId: cat,
      date: date,
      type: type,
      userId: user,
      userEmail: user == null ? null : '$user@example.com',
      note: note,
      tagIds: tags,
    );

void main() {
  group('categoryBreakdown', () {
    final txs = [
      _tx(300, DateTime(2026, 3, 1), user: 'a'),
      _tx(100, DateTime(2026, 3, 31, 23, 59), cat: 'fuel', user: 'b'),
      _tx(600, DateTime(2026, 3, 15), user: 'b'),
      _tx(999, DateTime(2026, 4, 1)),
      _tx(5000, DateTime(2026, 3, 2), type: TransactionType.income),
    ];

    test('sums expenses in a half-open range, largest first', () {
      final b = categoryBreakdown(txs,
          start: DateTime(2026, 3, 1), end: DateTime(2026, 4, 1));
      expect(b.total, 1000);
      expect(b.categories.map((c) => c.categoryId), ['food', 'fuel']);
      expect(b.categories.first.total, 900);
      expect(b.categories.first.count, 2);
      expect(b.categories.first.share, 0.9);
      expect(b.transactions.first.categoryId, 'fuel');
    });

    test('filters by user and handles an empty period', () {
      final b = categoryBreakdown(txs,
          start: DateTime(2026, 3, 1), end: DateTime(2026, 4, 1), userId: 'a');
      expect(b.total, 300);
      final empty = categoryBreakdown(txs,
          start: DateTime(2025, 1, 1), end: DateTime(2025, 2, 1));
      expect(empty.total, 0);
      expect(empty.categories, isEmpty);
    });
  });

  group('computeTrends', () {
    final now = DateTime(2026, 3, 18);
    final txs = [
      _tx(1000, DateTime(2025, 12, 5)),
      _tx(3000, DateTime(2026, 1, 5)),
      _tx(500, DateTime(2026, 1, 9), cat: 'fuel'),
      _tx(1500, DateTime(2026, 2, 5)),
      _tx(700, DateTime(2026, 2, 9), cat: 'fuel'),
      _tx(2000, DateTime(2026, 3, 5)),
      _tx(900, DateTime(2026, 3, 9), cat: 'fuel'),
      _tx(99999, DateTime(2025, 9, 1)),
      _tx(99999, DateTime(2026, 3, 1), type: TransactionType.income),
    ];

    test('buckets calendar months ending at the current one', () {
      final t = computeTrends(txs, now: now, monthCount: 4);
      expect(t.months.map((m) => m.month.month), [12, 1, 2, 3]);
      expect(t.months.map((m) => m.total), [1000, 3500, 2200, 2900]);
      expect(t.total, 9600);
      expect(t.monthlyAverage, 2400);
    });

    test('average divides by every month, including empty ones', () {
      final t = computeTrends(txs, now: now, monthCount: 6);
      expect(t.total, 9600);
      expect(t.monthlyAverage, 1600);
      expect(t.months.first.total, 0);
    });

    test('peak, lowest, spike, drop, top and rising category', () {
      final t = computeTrends(txs, now: now, monthCount: 4);
      expect(t.peak!.month.month, 1);
      expect(t.lowest!.month.month, 12);
      expect(t.biggestSpike!.month.month, 1);
      expect(t.biggestSpike!.delta, 2500);
      expect(t.biggestSpike!.pct, 250);
      expect(t.biggestDrop!.month.month, 2);
      expect(t.biggestDrop!.delta, -1300);
      expect(t.topCategoryId, 'food');
      expect(t.topCategoryTotal, 7500);
      expect(t.risingCategoryId, 'fuel');
    });

    test('no data gives an empty result without errors', () {
      final t = computeTrends(const [], now: now, monthCount: 3);
      expect(t.hasData, isFalse);
      expect(t.peak, isNull);
      expect(t.months, hasLength(3));
    });
  });

  group('buildTransactionsCsv', () {
    test('orders by date, quotes and neutralises formulas', () {
      final csv = buildTransactionsCsv(
        [
          _tx(1200.5, DateTime(2026, 3, 2, 9, 5),
              user: 'a', note: 'Lunch, "special"', tags: ['t1', 'gone']),
          _tx(50, DateTime(2026, 3, 1, 18), note: '=SUM(A1)'),
        ],
        categoryName: (id) => 'Food',
        tagName: (id) => id == 't1' ? 'Goa trip' : '',
        userName: (id) => 'Asha',
      );
      final lines = csv.trim().split('\r\n');
      expect(lines[0], 'Date,Type,Amount,Category,Note,Tags,User,Email');
      expect(lines[1], "2026-03-01 18:00,expense,50.00,Food,'=SUM(A1),,,");
      expect(lines[2],
          '2026-03-02 09:05,expense,1200.50,Food,"Lunch, ""special""",Goa trip,Asha,a@example.com');
    });
  });
}
