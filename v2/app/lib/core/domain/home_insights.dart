/// Home dashboard insights, computed from plain data with an explicit clock.
/// Ported from `src/app/core/services/insights.service.ts`.
library;

import 'dart:math' as math;

import 'budget_alert.dart';
import 'insights_math.dart';
import 'models.dart';
import 'recurring_expenses.dart';

/// Skip rising-category noise when prior 14-day spend is below this floor.
const double risingCategoryMinPrior = 1000;

/// Also require prior spend to be this fraction of current-month expenses.
const double risingCategoryMinPriorFraction = 0.05;

/// Cap on the displayed rising-category percentage ("500%+").
const double risingCategoryMaxPct = 500;

class FinancialHealth {
  const FinancialHealth({
    required this.income,
    required this.expense,
    required this.netCashFlow,
    required this.lastMonthNetCashFlow,
    required this.periodDeltaPct,
  });

  final double income;
  final double expense;
  final double netCashFlow;
  final double lastMonthNetCashFlow;
  final double? periodDeltaPct;
}

class BurnRateInsight {
  const BurnRateInsight({
    required this.spentMtd,
    required this.dailyBurnRate,
    required this.monthEndForecast,
    required this.daysElapsed,
    required this.totalDays,
    required this.projectedSavings,
  });

  final double spentMtd;
  final double dailyBurnRate;
  final double monthEndForecast;
  final int daysElapsed;
  final int totalDays;
  final double projectedSavings;
}

class CategoryPacingWarning {
  const CategoryPacingWarning({
    required this.categoryId,
    required this.name,
    required this.spent,
    required this.budget,
    required this.ratio,
    required this.status,
  });

  final String categoryId;
  final String name;
  final double spent;
  final double budget;
  final double ratio;
  final PacingStatus status;
}

class BudgetPacingInsight {
  const BudgetPacingInsight({
    required this.spentMtd,
    required this.totalBudget,
    required this.budgetUsedPct,
    required this.ratio,
    required this.status,
    required this.daysElapsed,
    required this.totalDays,
    required this.timePct,
    required this.categoryWarnings,
  });

  final double spentMtd;
  final double totalBudget;
  final double budgetUsedPct;
  final double? ratio;
  final PacingStatus status;
  final int daysElapsed;
  final int totalDays;
  final double timePct;
  final List<CategoryPacingWarning> categoryWarnings;
}

enum SmartInsightKind {
  spendingSpike,
  weekendSpending,
  topBurner,
  risingCategory,
  householdSplit,
}

class SmartInsightCard {
  const SmartInsightCard({
    required this.kind,
    required this.title,
    required this.narrative,
  });

  /// The UI maps this to an icon and colour.
  final SmartInsightKind kind;
  final String title;
  final String narrative;
}

class HouseholdMemberSpend {
  const HouseholdMemberSpend({
    required this.userId,
    required this.name,
    required this.amount,
    required this.percentage,
  });

  final String userId;
  final String name;
  final double amount;
  final double percentage;
}

/// A budget that is already exceeded, or will be at the current pace.
class BudgetHeadline {
  const BudgetHeadline({
    required this.categoryName,
    required this.budget,
    required this.overBy,
    required this.crossDay,
  });

  final String categoryName;
  final double budget;

  /// Amount over budget so far; zero when the budget is not yet exceeded.
  final double overBy;

  /// Day of month the budget is projected to be crossed; null when [overBy] > 0.
  final int? crossDay;
}

class HomeInsights {
  HomeInsights({
    required List<Transaction> transactions,
    required this.now,
    this.budgets = const [],
    this.memberIds = const [],
    String? Function(String categoryId)? categoryName,
    String Function(String userId)? memberName,
  })  : _txs = transactions,
        _categoryName = categoryName ?? ((_) => null),
        _memberName = memberName ?? ((id) => id);

  final List<Transaction> _txs;
  final DateTime now;
  final List<CategoryBudget> budgets;
  final List<String> memberIds;
  final String? Function(String) _categoryName;
  final String Function(String) _memberName;

  int get _year => now.year;
  int get _month => now.month;

  bool _inMonth(Transaction t, int year, int month) =>
      t.date.year == year && t.date.month == month;

  double _monthTotal(TransactionType type, int year, int month) => _txs
      .where((t) => t.type == type && _inMonth(t, year, month))
      .fold(0.0, (sum, t) => sum + t.amount);

  Iterable<Transaction> get _monthExpenses =>
      _txs.where((t) => t.isExpense && _inMonth(t, _year, _month));

  late final double _monthExpenseTotal =
      _monthTotal(TransactionType.expense, _year, _month);
  late final double _monthIncomeTotal =
      _monthTotal(TransactionType.income, _year, _month);

  late final FinancialHealth financialHealth = () {
    final last = DateTime(_year, _month - 1, 1);
    final net = _monthIncomeTotal - _monthExpenseTotal;
    final lastNet =
        _monthTotal(TransactionType.income, last.year, last.month) -
            _monthTotal(TransactionType.expense, last.year, last.month);
    return FinancialHealth(
      income: _monthIncomeTotal,
      expense: _monthExpenseTotal,
      netCashFlow: net,
      lastMonthNetCashFlow: lastNet,
      periodDeltaPct: periodOverPeriodDelta(net, lastNet),
    );
  }();

  late final BurnRateInsight burnRate = () {
    final daysElapsed = daysElapsedInMonth(now);
    final totalDays = totalDaysInMonth(_year, _month);
    final burn = dailyBurnRate(_monthExpenseTotal, daysElapsed);
    final forecast = monthEndForecast(burn, totalDays);
    return BurnRateInsight(
      spentMtd: _monthExpenseTotal,
      dailyBurnRate: burn,
      monthEndForecast: forecast,
      daysElapsed: daysElapsed,
      totalDays: totalDays,
      projectedSavings: _monthIncomeTotal - forecast,
    );
  }();

  /// Spend per day from the 1st to today, for the burn sparkline.
  late final List<double> dailySpendThisMonth = () {
    final days = List<double>.filled(now.day, 0);
    for (final t in _monthExpenses) {
      if (t.date.day <= now.day) days[t.date.day - 1] += t.amount;
    }
    return days;
  }();

  late final BudgetPacingInsight budgetPacing = () {
    final daysElapsed = daysElapsedInMonth(now);
    final totalDays = totalDaysInMonth(_year, _month);
    final timePct = totalDays > 0 ? (daysElapsed / totalDays) * 100 : 0.0;

    var totalBudget = 0.0;
    var spentMtd = 0.0;
    final warnings = <CategoryPacingWarning>[];

    for (final b in budgets) {
      if (b.amount <= 0) continue;
      totalBudget += b.amount;
      final spent = spentForCategoryInMonth(_txs, b.categoryId, _year, _month);
      spentMtd += spent;

      final ratio = budgetPacingRatio(spent, b.amount, daysElapsed, totalDays);
      if (ratio != null && ratio > 1.0) {
        warnings.add(CategoryPacingWarning(
          categoryId: b.categoryId,
          name: _categoryName(b.categoryId) ?? 'Category',
          spent: spent,
          budget: b.amount,
          ratio: ratio,
          status: pacingStatus(ratio),
        ));
      }
    }
    warnings.sort((a, b) => b.ratio.compareTo(a.ratio));

    final ratio =
        budgetPacingRatio(spentMtd, totalBudget, daysElapsed, totalDays);
    return BudgetPacingInsight(
      spentMtd: spentMtd,
      totalBudget: totalBudget,
      budgetUsedPct: totalBudget > 0 ? (spentMtd / totalBudget) * 100 : 0,
      ratio: ratio,
      status: pacingStatus(ratio),
      daysElapsed: daysElapsed,
      totalDays: totalDays,
      timePct: timePct,
      categoryWarnings: warnings,
    );
  }();

  /// The most pressing budget problem, if any: the largest overrun, else the
  /// earliest projected crossing. Projection needs at least three entries in
  /// the category this month, so a single bill paid in full (rent) does not
  /// read as runaway spending.
  late final BudgetHeadline? budgetHeadline = () {
    final warnings = budgetPacing.categoryWarnings;
    final over = warnings.where((w) => w.spent > w.budget).toList()
      ..sort((a, b) => (b.spent - b.budget).compareTo(a.spent - a.budget));
    if (over.isNotEmpty) {
      final w = over.first;
      return BudgetHeadline(
        categoryName: w.name,
        budget: w.budget,
        overBy: w.spent - w.budget,
        crossDay: null,
      );
    }

    BudgetHeadline? best;
    for (final w in warnings) {
      final count =
          _monthExpenses.where((t) => t.categoryId == w.categoryId).length;
      if (count < 3 || w.spent <= 0) continue;
      final perDay = w.spent / budgetPacing.daysElapsed;
      final crossDay = (w.budget / perDay).ceil();
      if (crossDay > budgetPacing.totalDays) continue;
      if (best == null || crossDay < best.crossDay!) {
        best = BudgetHeadline(
          categoryName: w.name,
          budget: w.budget,
          overBy: 0,
          crossDay: crossDay,
        );
      }
    }
    return best;
  }();

  late final List<HouseholdMemberSpend> householdSplit = () {
    if (memberIds.length < 2) return <HouseholdMemberSpend>[];

    final byUser = <String, double>{};
    for (final t in _monthExpenses) {
      final uid = t.userId;
      if (uid == null || uid.isEmpty) continue;
      byUser[uid] = (byUser[uid] ?? 0) + t.amount;
    }
    final total = byUser.values.fold(0.0, (a, b) => a + b);
    if (total <= 0) return <HouseholdMemberSpend>[];

    return [
      for (final e in byUser.entries)
        HouseholdMemberSpend(
          userId: e.key,
          name: _memberName(e.key),
          amount: e.value,
          percentage: (e.value / total) * 100,
        ),
    ]..sort((a, b) => b.amount.compareTo(a.amount));
  }();

  late final List<SmartInsightCard> smartInsights = () {
    final cards = <SmartInsightCard>[];
    final expenses = _txs.where((t) => t.isExpense).toList();

    // Spike: this week (from Sunday) vs last week.
    final weekStart = DateTime(now.year, now.month, now.day - now.weekday % 7);
    final prevWeekStart =
        DateTime(weekStart.year, weekStart.month, weekStart.day - 7);
    var thisWeek = 0.0;
    var lastWeek = 0.0;
    for (final t in expenses) {
      if (!t.date.isBefore(weekStart)) {
        thisWeek += t.amount;
      } else if (!t.date.isBefore(prevWeekStart)) {
        lastWeek += t.amount;
      }
    }
    if (lastWeek > 0 && thisWeek > lastWeek) {
      final spikePct = periodOverPeriodDelta(thisWeek, lastWeek);
      if (spikePct != null && spikePct >= 15) {
        cards.add(SmartInsightCard(
          kind: SmartInsightKind.spendingSpike,
          title: 'Spending Spike',
          narrative:
              'Spending is ${spikePct.round()}% higher this week compared to last week.',
        ));
      }
    }

    // Friday + Saturday share of this month's spend.
    var friSat = 0.0;
    final categoryTotals = <String, double>{};
    for (final t in _monthExpenses) {
      if (t.date.weekday == DateTime.friday ||
          t.date.weekday == DateTime.saturday) {
        friSat += t.amount;
      }
      categoryTotals[t.categoryId] =
          (categoryTotals[t.categoryId] ?? 0) + t.amount;
    }
    if (_monthExpenseTotal > 0) {
      final pct = (friSat / _monthExpenseTotal) * 100;
      if (pct >= 40) {
        cards.add(SmartInsightCard(
          kind: SmartInsightKind.weekendSpending,
          title: 'Weekend Spending',
          narrative:
              '${pct.round()}% of your discretionary spending this month occurs on Fridays & Saturdays.',
        ));
      }

      // Top category this month.
      final top = categoryTotals.entries
          .reduce((a, b) => b.value > a.value ? b : a);
      final share = (top.value / _monthExpenseTotal) * 100;
      cards.add(SmartInsightCard(
        kind: SmartInsightKind.topBurner,
        title: 'Top Burner',
        narrative:
            '${_categoryName(top.key) ?? 'Unknown'} is your top spending category at ${share.round()}% of monthly expenses.',
      ));
    }

    // Rising category: last 14 days vs the 14 days before.
    DateTime daysAgo(int n) => DateTime(now.year, now.month, now.day - n,
        now.hour, now.minute, now.second, now.millisecond);
    final fourteenAgo = daysAgo(14);
    final twentyEightAgo = daysAgo(28);
    final recentByCat = <String, double>{};
    final priorByCat = <String, double>{};
    for (final t in expenses) {
      if (!t.date.isBefore(fourteenAgo)) {
        recentByCat[t.categoryId] = (recentByCat[t.categoryId] ?? 0) + t.amount;
      } else if (!t.date.isBefore(twentyEightAgo)) {
        priorByCat[t.categoryId] = (priorByCat[t.categoryId] ?? 0) + t.amount;
      }
    }
    final minPrior = math.max(
      risingCategoryMinPrior,
      _monthExpenseTotal * risingCategoryMinPriorFraction,
    );
    String? riseName;
    double? risePct;
    recentByCat.forEach((catId, recent) {
      final prior = priorByCat[catId] ?? 0;
      // Near-zero bases inflate percentages into noise.
      if (prior < minPrior || recent <= prior) return;
      final pct = periodOverPeriodDelta(recent, prior);
      if (pct != null && pct >= 20 && (risePct == null || pct > risePct!)) {
        riseName = _categoryName(catId) ?? 'Category';
        risePct = pct;
      }
    });
    if (risePct != null) {
      final label = risePct! > risingCategoryMaxPct
          ? '${risingCategoryMaxPct.round()}%+'
          : '${risePct!.round()}%';
      cards.add(SmartInsightCard(
        kind: SmartInsightKind.risingCategory,
        title: 'Rising Category',
        narrative:
            '$riseName spending rose $label in the last 14 days vs the prior 14 days.',
      ));
    }

    if (householdSplit.length >= 2) {
      final top = householdSplit.first;
      cards.add(SmartInsightCard(
        kind: SmartInsightKind.householdSplit,
        title: 'Household Split',
        narrative:
            '${top.name} accounts for ${top.percentage.round()}% of household spending this month.',
      ));
    }

    return cards.take(6).toList();
  }();

  /// Recurring bills detected over the last six calendar months.
  late final List<RecurringExpenseInsight> recurringExpenses = () {
    final rangeStart = DateTime(now.year, now.month - 5, 1);
    final rangeEnd = DateTime(now.year, now.month + 1, 1);
    return detectRecurringExpenses(
      _txs.where(
          (t) => !t.date.isBefore(rangeStart) && t.date.isBefore(rangeEnd)),
      (id) => _categoryName(id) ?? 'Uncategorized',
      maxResults: 4,
    );
  }();

  late final List<Transaction> recentTransactions =
      ([..._txs]..sort((a, b) => b.date.compareTo(a.date))).take(5).toList();
}
