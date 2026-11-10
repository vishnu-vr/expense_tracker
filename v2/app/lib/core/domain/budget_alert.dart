/// Budget warnings while drafting an expense.
/// Ported from `src/app/core/utils/budget-alert.ts`; months here are 1-based.
library;

import 'models.dart';

double spentForCategoryInMonth(
  Iterable<Transaction> transactions,
  String categoryId,
  int year,
  int month, {
  String? excludeTransactionId,
}) {
  var sum = 0.0;
  for (final t in transactions) {
    if (!t.isExpense || t.categoryId != categoryId) continue;
    if (excludeTransactionId != null &&
        excludeTransactionId.isNotEmpty &&
        t.id == excludeTransactionId) {
      continue;
    }
    if (t.date.year != year || t.date.month != month) continue;
    sum += t.amount;
  }
  return sum;
}

enum BudgetDraftAlertLevel { approach, over }

class BudgetDraftAlert {
  const BudgetDraftAlert({
    required this.level,
    required this.budget,
    required this.spentBefore,
    required this.draftAmount,
    required this.projected,
    required this.projectedPct,
  });

  final BudgetDraftAlertLevel level;
  final double budget;
  final double spentBefore;
  final double draftAmount;
  final double projected;
  final double projectedPct;
}

/// Warns when the month's category spend, including this draft, reaches
/// [approachThreshold] of the budget (default 90%) or would exceed it.
BudgetDraftAlert? budgetDraftAlert(
  double budget,
  double spentBefore,
  double draftAmount, {
  double approachThreshold = 0.9,
}) {
  if (!budget.isFinite || budget <= 0) return null;
  final draft = draftAmount.isFinite && draftAmount > 0 ? draftAmount : 0.0;
  final projected = spentBefore + draft;
  final projectedPct = (projected / budget) * 100;

  BudgetDraftAlert build(BudgetDraftAlertLevel level) => BudgetDraftAlert(
        level: level,
        budget: budget,
        spentBefore: spentBefore,
        draftAmount: draft,
        projected: projected,
        projectedPct: projectedPct,
      );

  if (projected > budget) return build(BudgetDraftAlertLevel.over);
  if (projected >= budget * approachThreshold) {
    return build(BudgetDraftAlertLevel.approach);
  }
  return null;
}
