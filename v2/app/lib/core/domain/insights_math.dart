/// Pure calculation helpers for insight metrics.
/// Ported from `src/app/core/utils/insights-math.ts`; months here are 1-based.
library;

/// Days elapsed in the calendar month (the day of month).
int daysElapsedInMonth(DateTime date) => date.day;

/// Total calendar days in [month] (1-12) of [year].
int totalDaysInMonth(int year, int month) => DateTime(year, month + 1, 0).day;

/// Daily burn rate = spent month-to-date / days elapsed.
double dailyBurnRate(double spentMtd, int daysElapsed) {
  if (!spentMtd.isFinite || spentMtd < 0) return 0;
  if (daysElapsed <= 0) return 0;
  return spentMtd / daysElapsed;
}

/// Month-end spend forecast = daily burn rate x total days in month.
double monthEndForecast(double burnRate, int totalDays) {
  if (!burnRate.isFinite || burnRate < 0) return 0;
  if (totalDays <= 0) return 0;
  return burnRate * totalDays;
}

/// (spent / budget) / (days elapsed / days in month).
/// Returns null when the inputs cannot produce a meaningful ratio.
double? budgetPacingRatio(
  double spentMtd,
  double totalBudget,
  int daysElapsed,
  int totalDays,
) {
  if (!totalBudget.isFinite || totalBudget <= 0) return null;
  if (daysElapsed <= 0 || totalDays <= 0) return null;
  final spendPct = spentMtd / totalBudget;
  final timePct = daysElapsed / totalDays;
  if (timePct == 0) return null;
  return spendPct / timePct;
}

enum PacingStatus { onTrack, warning, ahead }

PacingStatus pacingStatus(double? ratio) {
  if (ratio == null) return PacingStatus.onTrack;
  if (ratio > 1.1) return PacingStatus.warning;
  if (ratio <= 1.0) return PacingStatus.onTrack;
  return PacingStatus.ahead;
}

/// ((current - previous) / previous) x 100, or null when previous is zero.
double? periodOverPeriodDelta(double current, double previous) {
  if (!previous.isFinite || previous == 0) return null;
  return ((current - previous) / previous) * 100;
}
