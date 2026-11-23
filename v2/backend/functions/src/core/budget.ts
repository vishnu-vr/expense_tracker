import { categoryNameLookup } from "./categories";
import { daysInMonth, monthKey, monthLabel, parseDay } from "./dates";
import { formatINR, round2 } from "./money";
import { HomeData } from "./types";

// ---- insights-math.ts ports -------------------------------------------------

/** Daily Burn Rate = Spent MTD ÷ Days Elapsed */
export function dailyBurnRate(spentMtd: number, daysElapsed: number): number {
  if (!Number.isFinite(spentMtd) || spentMtd < 0) return 0;
  if (daysElapsed <= 0) return 0;
  return spentMtd / daysElapsed;
}

/** Month-End Spend Forecast = Daily Burn Rate × Total Days in Month */
export function monthEndForecast(burnRate: number, totalDays: number): number {
  if (!Number.isFinite(burnRate) || burnRate < 0) return 0;
  if (totalDays <= 0) return 0;
  return burnRate * totalDays;
}

/** (Spent MTD / Budget) / (Days Elapsed / Days in Month); null when inputs are invalid. */
export function budgetPacingRatio(
  spentMtd: number,
  totalBudget: number,
  daysElapsed: number,
  totalDays: number,
): number | null {
  if (!Number.isFinite(totalBudget) || totalBudget <= 0) return null;
  if (daysElapsed <= 0 || totalDays <= 0) return null;
  const timePct = daysElapsed / totalDays;
  if (timePct === 0) return null;
  return spentMtd / totalBudget / timePct;
}

export type PacingStatus = "on_track" | "warning" | "ahead";

export function pacingStatus(ratio: number | null): PacingStatus {
  if (ratio === null) return "on_track";
  if (ratio > 1.1) return "warning";
  if (ratio <= 1.0) return "on_track";
  return "ahead";
}

// ---- budget-alert.ts port ----------------------------------------------------

export interface BudgetDraftAlert {
  level: "approach" | "over";
  budget: number;
  spentBefore: number;
  draftAmount: number;
  projected: number;
  projectedPct: number;
}

export function budgetDraftAlert(
  budget: number,
  spentBefore: number,
  draftAmount: number,
  options?: { approachThreshold?: number },
): BudgetDraftAlert | null {
  if (!Number.isFinite(budget) || budget <= 0) return null;
  const draft = Number.isFinite(draftAmount) && draftAmount > 0 ? draftAmount : 0;
  const projected = spentBefore + draft;
  const threshold = options?.approachThreshold ?? 0.9;
  const projectedPct = (projected / budget) * 100;
  if (projected > budget) return { level: "over", budget, spentBefore, draftAmount: draft, projected, projectedPct };
  if (projected >= budget * threshold) {
    return { level: "approach", budget, spentBefore, draftAmount: draft, projected, projectedPct };
  }
  return null;
}

// ---- budget_status tool ------------------------------------------------------

export interface BudgetLine {
  categoryId: string;
  categoryName: string;
  budget: number;
  budgetDisplay: string;
  spent: number;
  spentDisplay: string;
  /** budget − spent (negative when over). */
  remaining: number;
  remainingDisplay: string;
  /** Percent of budget used (one decimal). */
  usedPct: number;
  /** >1 means spending faster than the month is passing. Two decimals; null if not computable. */
  pacingRatio: number | null;
  pacing: PacingStatus;
  dailyBurn: number;
  dailyBurnDisplay: string;
  /** Projected spend by month end at the current daily burn. */
  forecast: number;
  forecastDisplay: string;
  forecastOverBudget: boolean;
  status: "over" | "will_cross" | "within";
  /**
   * Day of month the budget was crossed (status "over", from actual entries)
   * or is projected to be crossed (status "will_cross"); null otherwise.
   */
  crossingDay: number | null;
  crossingDate: string | null;
}

export interface BudgetStatusResult {
  month: string;
  monthLabel: string;
  asOf: string;
  daysElapsed: number;
  daysInMonth: number;
  isCurrentMonth: boolean;
  hasBudgets: boolean;
  lines: BudgetLine[];
  totals: {
    budget: number;
    budgetDisplay: string;
    spent: number;
    spentDisplay: string;
    remaining: number;
    remainingDisplay: string;
    usedPct: number;
    pacingRatio: number | null;
    forecast: number;
    forecastDisplay: string;
  };
  /** Expense categories with spend this month but no budget. */
  unbudgeted: { categoryId: string; categoryName: string; spent: number; spentDisplay: string }[];
}

/**
 * Budget position for `month` (YYYY-MM) as seen on `today` (YYYY-MM-DD).
 * For a past month the whole month counts as elapsed; for a future month nothing has.
 */
export function budgetStatus(
  data: HomeData,
  today: string,
  month: string = monthKey(today),
  categoryIds?: string[],
): BudgetStatusResult {
  const totalDays = daysInMonth(month);
  const currentMonth = monthKey(today);
  const isCurrent = month === currentMonth;
  const daysElapsed = isCurrent ? parseDay(today).date : month < currentMonth ? totalDays : 0;
  const catName = categoryNameLookup(data.categories);
  const only = categoryIds?.length ? new Set(categoryIds) : null;

  const monthExpenses = data.transactions.filter(
    (t) => t.type === "expense" && monthKey(t.day) === month && (!isCurrent || t.day <= today),
  );
  const byCat = new Map<string, { total: number; perDay: Map<number, number> }>();
  for (const t of monthExpenses) {
    const e = byCat.get(t.categoryId) ?? { total: 0, perDay: new Map<number, number>() };
    e.total += t.amount;
    const d = parseDay(t.day).date;
    e.perDay.set(d, (e.perDay.get(d) ?? 0) + t.amount);
    byCat.set(t.categoryId, e);
  }

  const pad = (n: number) => String(n).padStart(2, "0");
  const budgets = data.budgets.filter((b) => b.amount > 0 && (!only || only.has(b.categoryId)));

  const lines: BudgetLine[] = budgets
    .map((b) => {
      const entry = byCat.get(b.categoryId);
      const spent = round2(entry?.total ?? 0);
      const burn = dailyBurnRate(spent, daysElapsed);
      const forecast = isCurrent ? round2(monthEndForecast(burn, totalDays)) : spent;
      const ratio = budgetPacingRatio(spent, b.amount, daysElapsed, totalDays);

      let status: BudgetLine["status"] = "within";
      let crossingDay: number | null = null;
      if (spent > b.amount) {
        status = "over";
        let running = 0;
        for (let d = 1; d <= totalDays; d++) {
          running += entry?.perDay.get(d) ?? 0;
          if (running > b.amount) {
            crossingDay = d;
            break;
          }
        }
      } else if (isCurrent && burn > 0) {
        // First day on which burn × day exceeds the budget.
        const day = Math.floor(b.amount / burn) + 1;
        if (day <= totalDays) {
          status = "will_cross";
          crossingDay = day;
        }
      }

      return {
        categoryId: b.categoryId,
        categoryName: catName(b.categoryId),
        budget: round2(b.amount),
        budgetDisplay: formatINR(b.amount),
        spent,
        spentDisplay: formatINR(spent),
        remaining: round2(b.amount - spent),
        remainingDisplay: formatINR(b.amount - spent),
        usedPct: Math.round((spent / b.amount) * 1000) / 10,
        pacingRatio: ratio === null ? null : Math.round(ratio * 100) / 100,
        pacing: pacingStatus(ratio),
        dailyBurn: round2(burn),
        dailyBurnDisplay: formatINR(burn),
        forecast,
        forecastDisplay: formatINR(forecast),
        forecastOverBudget: forecast > b.amount,
        status,
        crossingDay,
        crossingDate: crossingDay === null ? null : `${month}-${pad(crossingDay)}`,
      };
    })
    .sort((a, b) => b.usedPct - a.usedPct || (a.categoryName < b.categoryName ? -1 : 1));

  const totalBudget = round2(lines.reduce((s, l) => s + l.budget, 0));
  const totalSpent = round2(lines.reduce((s, l) => s + l.spent, 0));
  const totalRatio = budgetPacingRatio(totalSpent, totalBudget, daysElapsed, totalDays);
  const totalForecast = round2(lines.reduce((s, l) => s + l.forecast, 0));

  const budgeted = new Set(data.budgets.filter((b) => b.amount > 0).map((b) => b.categoryId));
  const unbudgeted = [...byCat.entries()]
    .filter(([id]) => !budgeted.has(id) && (!only || only.has(id)))
    .map(([categoryId, v]) => ({
      categoryId,
      categoryName: catName(categoryId),
      spent: round2(v.total),
      spentDisplay: formatINR(v.total),
    }))
    .sort((a, b) => b.spent - a.spent);

  return {
    month,
    monthLabel: monthLabel(month),
    asOf: today,
    daysElapsed,
    daysInMonth: totalDays,
    isCurrentMonth: isCurrent,
    hasBudgets: lines.length > 0,
    lines,
    totals: {
      budget: totalBudget,
      budgetDisplay: formatINR(totalBudget),
      spent: totalSpent,
      spentDisplay: formatINR(totalSpent),
      remaining: round2(totalBudget - totalSpent),
      remainingDisplay: formatINR(totalBudget - totalSpent),
      usedPct: totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 1000) / 10 : 0,
      pacingRatio: totalRatio === null ? null : Math.round(totalRatio * 100) / 100,
      forecast: totalForecast,
      forecastDisplay: formatINR(totalForecast),
    },
    unbudgeted,
  };
}
