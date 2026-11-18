import 'package:flutter_test/flutter_test.dart';
import 'package:track_expense/core/domain/home_insights.dart';
import 'package:track_expense/core/domain/insights_math.dart';
import 'package:track_expense/core/domain/models.dart';

var _n = 0;
Transaction _exp(double amount, DateTime date,
        {String cat = 'food', String? user, String? note}) =>
    Transaction(
      id: 't${_n++}',
      amount: amount,
      categoryId: cat,
      date: date,
      type: TransactionType.expense,
      userId: user,
      note: note,
    );
Transaction _inc(double amount, DateTime date) => Transaction(
      id: 't${_n++}',
      amount: amount,
      categoryId: 'salary',
      date: date,
      type: TransactionType.income,
    );

String? _name(String id) =>
    const {'food': 'Food', 'fuel': 'Fuel', 'rent': 'Rent'}[id];

void main() {
  // Wednesday 18 March 2026; the week started on Sunday the 15th.
  final now = DateTime(2026, 3, 18, 10);

  SmartInsightCard? card(HomeInsights i, SmartInsightKind k) =>
      i.smartInsights.where((c) => c.kind == k).firstOrNull;

  test('financial health compares this month with last, across a year edge',
      () {
    final jan = DateTime(2026, 1, 10);
    final i = HomeInsights(now: jan, transactions: [
      _inc(50000, DateTime(2026, 1, 1)),
      _exp(20000, DateTime(2026, 1, 5)),
      _inc(40000, DateTime(2025, 12, 1)),
      _exp(20000, DateTime(2025, 12, 20)),
    ]);
    expect(i.financialHealth.netCashFlow, 30000);
    expect(i.financialHealth.lastMonthNetCashFlow, 20000);
    expect(i.financialHealth.periodDeltaPct, 50);
  });

  test('burn rate, forecast, projected savings and daily series', () {
    final i = HomeInsights(now: now, transactions: [
      _inc(60000, DateTime(2026, 3, 1)),
      _exp(9000, DateTime(2026, 3, 2)),
      _exp(9000, DateTime(2026, 3, 18, 9)),
      _exp(500, DateTime(2026, 2, 27)),
    ]);
    expect(i.burnRate.spentMtd, 18000);
    expect(i.burnRate.dailyBurnRate, 1000);
    expect(i.burnRate.monthEndForecast, 31000);
    expect(i.burnRate.projectedSavings, 29000);
    expect(i.dailySpendThisMonth, hasLength(18));
    expect(i.dailySpendThisMonth[1], 9000);
    expect(i.dailySpendThisMonth[17], 9000);
  });

  test('budget pacing totals and per-category warnings, worst first', () {
    final i = HomeInsights(
      now: now,
      categoryName: _name,
      budgets: const [
        CategoryBudget(categoryId: 'food', amount: 10000),
        CategoryBudget(categoryId: 'fuel', amount: 4000),
        CategoryBudget(categoryId: 'rent', amount: 0),
      ],
      transactions: [
        _exp(7000, DateTime(2026, 3, 3)),
        _exp(3900, DateTime(2026, 3, 4), cat: 'fuel'),
        _exp(100, DateTime(2026, 3, 4), cat: 'other'),
      ],
    );
    final p = i.budgetPacing;
    expect(p.totalBudget, 14000);
    expect(p.spentMtd, 10900);
    expect(p.status, PacingStatus.warning);
    expect(p.categoryWarnings.map((w) => w.name), ['Fuel', 'Food']);
  });

  test('spending spike needs last-week spend and a 15% rise', () {
    final spike = HomeInsights(now: now, transactions: [
      _exp(1000, DateTime(2026, 3, 9)),
      _exp(1300, DateTime(2026, 3, 16)),
    ]);
    expect(card(spike, SmartInsightKind.spendingSpike)!.narrative,
        contains('30% higher'));

    final small = HomeInsights(now: now, transactions: [
      _exp(1000, DateTime(2026, 3, 14, 23, 59)),
      _exp(1100, DateTime(2026, 3, 15)),
    ]);
    expect(card(small, SmartInsightKind.spendingSpike), isNull);

    final noBase = HomeInsights(
        now: now, transactions: [_exp(1300, DateTime(2026, 3, 16))]);
    expect(card(noBase, SmartInsightKind.spendingSpike), isNull);
  });

  test('weekend share and top burner', () {
    final i = HomeInsights(now: now, categoryName: _name, transactions: [
      _exp(600, DateTime(2026, 3, 6)), // Friday
      _exp(300, DateTime(2026, 3, 7), cat: 'fuel'), // Saturday
      _exp(100, DateTime(2026, 3, 9)), // Monday
    ]);
    expect(card(i, SmartInsightKind.weekendSpending)!.narrative,
        startsWith('90%'));
    expect(card(i, SmartInsightKind.topBurner)!.narrative,
        startsWith('Food is your top spending category at 70%'));
  });

  test('rising category ignores tiny bases and caps the percentage', () {
    final noisy = HomeInsights(now: now, categoryName: _name, transactions: [
      _exp(50, DateTime(2026, 2, 25)),
      _exp(5000, DateTime(2026, 3, 10)),
    ]);
    expect(card(noisy, SmartInsightKind.risingCategory), isNull);

    final real = HomeInsights(now: now, categoryName: _name, transactions: [
      _exp(2000, DateTime(2026, 2, 25)),
      _exp(3000, DateTime(2026, 3, 10)),
    ]);
    expect(card(real, SmartInsightKind.risingCategory)!.narrative,
        'Food spending rose 50% in the last 14 days vs the prior 14 days.');

    final capped = HomeInsights(now: now, categoryName: _name, transactions: [
      _exp(1500, DateTime(2026, 2, 25)),
      _exp(15000, DateTime(2026, 3, 10)),
    ]);
    expect(card(capped, SmartInsightKind.risingCategory)!.narrative,
        contains('500%+'));
  });

  test('household split needs two members and sorts by spend', () {
    final txs = [
      _exp(300, DateTime(2026, 3, 2), user: 'a'),
      _exp(700, DateTime(2026, 3, 3), user: 'b'),
    ];
    final solo = HomeInsights(now: now, transactions: txs, memberIds: ['a']);
    expect(solo.householdSplit, isEmpty);

    final duo = HomeInsights(
      now: now,
      transactions: txs,
      memberIds: ['a', 'b'],
      memberName: (id) => id == 'b' ? 'Bina' : 'Arun',
    );
    expect(duo.householdSplit.first.name, 'Bina');
    expect(duo.householdSplit.first.percentage, 70);
    expect(card(duo, SmartInsightKind.householdSplit)!.narrative,
        startsWith('Bina accounts for 70%'));
  });

  test('recurring bills use a six-month window; recent list is newest first',
      () {
    final i = HomeInsights(now: now, categoryName: _name, transactions: [
      for (final m in [11, 12])
        _exp(15000, DateTime(2025, m, 3), cat: 'rent', note: 'rent'),
      for (final m in [1, 2, 3])
        _exp(15000, DateTime(2026, m, 3), cat: 'rent', note: 'rent'),
      _exp(15000, DateTime(2025, 6, 3), cat: 'rent', note: 'rent'),
      _exp(10, DateTime(2026, 3, 17)),
    ]);
    expect(i.recurringExpenses.single.occurrences, 5);
    expect(i.recurringExpenses.single.cadenceLabel, 'monthly');
    expect(i.recentTransactions.first.amount, 10);
    expect(i.recentTransactions, hasLength(5));
  });

  group('budget headline', () {
    HomeInsights build(List<Transaction> txs) => HomeInsights(
          now: now,
          categoryName: _name,
          transactions: txs,
          budgets: const [
            CategoryBudget(categoryId: 'food', amount: 12000),
            CategoryBudget(categoryId: 'rent', amount: 28000),
          ],
        );

    test('a bill paid in full exactly on budget is not a problem', () {
      final i = build([_exp(28000, DateTime(2026, 3, 3), cat: 'rent')]);
      expect(i.budgetPacing.categoryWarnings, hasLength(1));
      expect(i.budgetHeadline, isNull);
    });

    test('projects the crossing day from the pace so far', () {
      // 9,000 in 18 days is 500 a day, so 12,000 is reached on day 24.
      final i = build([
        _exp(28000, DateTime(2026, 3, 3), cat: 'rent'),
        for (final d in [2, 9, 16]) _exp(3000, DateTime(2026, 3, d)),
      ]);
      expect(i.budgetHeadline!.categoryName, 'Food');
      expect(i.budgetHeadline!.crossDay, 24);
      expect(i.budgetHeadline!.overBy, 0);
    });

    test('an actual overrun wins over a projection', () {
      final i = build([
        _exp(29500, DateTime(2026, 3, 3), cat: 'rent'),
        for (final d in [2, 9, 16]) _exp(3000, DateTime(2026, 3, d)),
      ]);
      expect(i.budgetHeadline!.categoryName, 'Rent');
      expect(i.budgetHeadline!.overBy, 1500);
      expect(i.budgetHeadline!.crossDay, isNull);
    });
  });
}
