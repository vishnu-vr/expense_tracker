import 'package:flutter_test/flutter_test.dart';
import 'package:track_expense/core/domain/budget_alert.dart';
import 'package:track_expense/core/domain/burn_sparkline.dart';
import 'package:track_expense/core/domain/insights_math.dart';
import 'package:track_expense/core/domain/merchant_dictionary.dart';
import 'package:track_expense/core/domain/models.dart';
import 'package:track_expense/core/domain/recurring_expenses.dart';
import 'package:track_expense/core/domain/transaction_search.dart';
import 'package:track_expense/core/format/money.dart';

Transaction _tx(
  String id,
  double amount,
  DateTime date, {
  String categoryId = 'food',
  String? note,
  TransactionType type = TransactionType.expense,
  String? userId,
}) =>
    Transaction(
      id: id,
      amount: amount,
      categoryId: categoryId,
      date: date,
      type: type,
      note: note,
      userId: userId,
    );

void main() {
  group('insights math', () {
    test('days in month handles leap years and December', () {
      expect(totalDaysInMonth(2024, 2), 29);
      expect(totalDaysInMonth(2025, 2), 28);
      expect(totalDaysInMonth(2026, 12), 31);
    });

    test('burn rate and forecast guard against bad input', () {
      expect(dailyBurnRate(3000, 10), 300);
      expect(dailyBurnRate(3000, 0), 0);
      expect(dailyBurnRate(-5, 10), 0);
      expect(monthEndForecast(300, 30), 9000);
      expect(monthEndForecast(double.nan, 30), 0);
    });

    test('pacing ratio and status thresholds', () {
      expect(budgetPacingRatio(5000, 10000, 15, 30), 1.0);
      expect(budgetPacingRatio(5000, 0, 15, 30), isNull);
      expect(pacingStatus(null), PacingStatus.onTrack);
      expect(pacingStatus(1.0), PacingStatus.onTrack);
      expect(pacingStatus(1.05), PacingStatus.ahead);
      expect(pacingStatus(1.2), PacingStatus.warning);
    });

    test('period delta is null when previous is zero', () {
      expect(periodOverPeriodDelta(150, 100), 50);
      expect(periodOverPeriodDelta(150, 0), isNull);
    });
  });

  group('budget alert', () {
    test('sums one category in one month, excluding the edited entry', () {
      final txs = [
        _tx('a', 100, DateTime(2026, 3, 2)),
        _tx('b', 50, DateTime(2026, 3, 20)),
        _tx('c', 70, DateTime(2026, 4, 1)),
        _tx('d', 30, DateTime(2026, 3, 5), categoryId: 'fuel'),
        _tx('e', 999, DateTime(2026, 3, 5), type: TransactionType.income),
      ];
      expect(spentForCategoryInMonth(txs, 'food', 2026, 3), 150);
      expect(
        spentForCategoryInMonth(txs, 'food', 2026, 3,
            excludeTransactionId: 'a'),
        50,
      );
    });

    test('levels: none, approach at 90%, over', () {
      expect(budgetDraftAlert(1000, 500, 100), isNull);
      expect(budgetDraftAlert(1000, 800, 100)!.level,
          BudgetDraftAlertLevel.approach);
      final over = budgetDraftAlert(1000, 950, 100)!;
      expect(over.level, BudgetDraftAlertLevel.over);
      expect(over.projected, 1050);
      expect(over.projectedPct, closeTo(105, 1e-9));
      expect(budgetDraftAlert(0, 10, 10), isNull);
    });
  });

  group('burn sparkline', () {
    test('returns empty when there is no spend', () {
      final spark = buildBurnSparkline([0, 0, 0], 31, 0);
      expect(spark.hasData, isFalse);
      expect(spark.actual, isEmpty);
      expect(spark.forecast, isEmpty);
    });

    test('draws cumulative actual line and a forecast tail', () {
      final spark = buildBurnSparkline([100, 50, 50], 10, 333.33);
      expect(spark.hasData, isTrue);
      expect(spark.actual.length, 4);
      expect(spark.forecast.length, 2);
      expect(spark.today.x, greaterThan(0));
      expect(spark.today.x, lessThan(spark.width));
      // Cumulative spend never goes down, so y never goes up the screen.
      for (var i = 1; i < spark.actual.length; i++) {
        expect(spark.actual[i].y, lessThanOrEqualTo(spark.actual[i - 1].y));
      }
    });

    test('omits forecast when the month is fully elapsed', () {
      final spark = buildBurnSparkline([10, 20, 30], 3, 60);
      expect(spark.hasData, isTrue);
      expect(spark.forecast, isEmpty);
      expect(spark.today.x, closeTo(spark.width - 2, 0.5));
    });
  });

  group('recurring expenses', () {
    String name(String id) => id == 'rent' ? 'Rent' : '';

    test('detects a monthly bill with a stable amount', () {
      final txs = [
        for (var m = 1; m <= 5; m++)
          _tx('r$m', 15000, DateTime(2026, m, 3),
              categoryId: 'rent', note: 'House rent $m'),
        _tx('x', 240, DateTime(2026, 2, 9), note: 'lunch'),
      ];
      final result = detectRecurringExpenses(txs, name);
      expect(result, hasLength(1));
      expect(result.single.cadenceLabel, 'monthly');
      expect(result.single.label, 'House Rent');
      expect(result.single.categoryName, 'Rent');
      expect(result.single.occurrences, 5);
      expect(result.single.averageAmount, 15000);
      expect(result.single.lastPaidDate, DateTime(2026, 5, 3));
    });

    test('rejects irregular timing and unstable amounts', () {
      final irregular = [
        _tx('a', 100, DateTime(2026, 1, 1), note: 'gym'),
        _tx('b', 100, DateTime(2026, 1, 3), note: 'gym'),
        _tx('c', 100, DateTime(2026, 3, 30), note: 'gym'),
      ];
      expect(detectRecurringExpenses(irregular, name), isEmpty);

      final unstable = [
        _tx('a', 100, DateTime(2026, 1, 5), note: 'power'),
        _tx('b', 900, DateTime(2026, 2, 5), note: 'power'),
        _tx('c', 100, DateTime(2026, 3, 5), note: 'power'),
      ];
      expect(detectRecurringExpenses(unstable, name), isEmpty);
    });

    test('filters by user and falls back to Uncategorized', () {
      final txs = [
        for (var w = 0; w < 4; w++)
          _tx('m$w', 60, DateTime(2026, 1, 1 + 7 * w), userId: 'u1'),
        for (var w = 0; w < 4; w++)
          _tx('n$w', 60, DateTime(2026, 1, 2 + 7 * w), userId: 'u2'),
      ];
      final mine = detectRecurringExpenses(txs, name, userId: 'u1');
      expect(mine.single.cadenceLabel, 'weekly');
      expect(mine.single.occurrences, 4);
      expect(mine.single.label, 'Uncategorized');
    });
  });

  group('transaction search', () {
    final tx = Transaction(
      id: 't',
      amount: 1200.5,
      categoryId: 'food',
      date: DateTime(2026, 1, 1),
      type: TransactionType.expense,
      note: 'Lunch at cafe',
      userEmail: 'alex@example.com',
    );

    test('matches everything when the query is empty', () {
      expect(transactionMatchesQuery(tx, '  '), isTrue);
    });

    test('matches category, note, tags, type, amount, and email', () {
      expect(transactionMatchesQuery(tx, 'food', categoryName: 'Food'), isTrue);
      expect(transactionMatchesQuery(tx, 'cafe'), isTrue);
      expect(transactionMatchesQuery(tx, 'trip', tagNames: ['Goa Trip']),
          isTrue);
      expect(transactionMatchesQuery(tx, 'expense'), isTrue);
      expect(transactionMatchesQuery(tx, '1200.5'), isTrue);
      expect(transactionMatchesQuery(tx, 'alex@'), isTrue);
    });

    test('returns false when nothing matches', () {
      expect(
        transactionMatchesQuery(tx, 'salary',
            categoryName: 'Food', tagNames: ['Goa']),
        isFalse,
      );
    });

    test('whole amounts do not match a spurious ".0"', () {
      final whole = tx.copyWith(amount: 1200);
      expect(transactionMatchesQuery(whole, '1200'), isTrue);
      expect(transactionMatchesQuery(whole, '1200.00'), isTrue);
      expect(transactionMatchesQuery(whole, '1200.0x'), isFalse);
    });
  });

  group('merchant dictionary', () {
    test('matches brands and respects ordering', () {
      expect(matchMerchant('uber to airport'), 'Uber');
      expect(matchMerchant('swiggy instamart order'), 'Swiggy');
      expect(matchMerchant('amazon prime renewal'), 'Amazon');
      expect(matchMerchant('irctc ticket'), 'Train');
      expect(matchMerchant('birthday gift'), isNull);
      expect(merchantCanonicalNames, contains('BigBasket'));
    });
  });

  group('money', () {
    test('formats with Indian grouping and optional paise', () {
      expect(formatMoney(120000), '₹1,20,000');
      expect(formatMoney(1200.5), '₹1,200.50');
      expect(formatSignedMoney(-480), '−₹480');
      expect(formatSignedMoney(0), '₹0');
    });

    test('hidden mode masks figures and amounts inside text', () {
      const hidden = Money(hidden: true);
      expect(hidden(500), '••••');
      expect(hidden.text('Rohan added ₹649 in Bills, up from Rs. 499.50'),
          'Rohan added •••• in Bills, up from ••••');
      expect(const Money().text('Spent ₹649'), 'Spent ₹649');
    });
  });
}
