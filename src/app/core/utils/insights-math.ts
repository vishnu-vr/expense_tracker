/**
 * Pure calculation utilities for insights metrics.
 * Formulas match Section 5 of the UI/UX redesign plan.
 */

/** Days elapsed in the calendar month (1-based day of month). */
export function daysElapsedInMonth(date: Date): number {
    return date.getDate();
}

/** Total calendar days in a month (handles leap years). */
export function totalDaysInMonth(year: number, month: number): number {
    return new Date(year, month + 1, 0).getDate();
}

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

/**
 * Budget Pacing Ratio = (Spent MTD / Total Budget) / (Days Elapsed / Total Days in Month)
 * Returns null when inputs are invalid (zero budget, zero days, etc.).
 */
export function budgetPacingRatio(
    spentMtd: number,
    totalBudget: number,
    daysElapsed: number,
    totalDays: number
): number | null {
    if (!Number.isFinite(totalBudget) || totalBudget <= 0) return null;
    if (daysElapsed <= 0 || totalDays <= 0) return null;
    const spendPct = spentMtd / totalBudget;
    const timePct = daysElapsed / totalDays;
    if (timePct === 0) return null;
    return spendPct / timePct;
}

export type PacingStatus = 'on_track' | 'warning' | 'ahead';

/** Interpret pacing ratio per plan thresholds. */
export function pacingStatus(ratio: number | null): PacingStatus {
    if (ratio === null) return 'on_track';
    if (ratio > 1.1) return 'warning';
    if (ratio <= 1.0) return 'on_track';
    return 'ahead';
}

/**
 * Period-over-Period Delta = ((Current - Previous) / Previous) × 100
 * Returns null when previous period is zero (zero-division protection).
 */
export function periodOverPeriodDelta(current: number, previous: number): number | null {
    if (!Number.isFinite(previous) || previous === 0) {
        return null;
    }
    return ((current - previous) / previous) * 100;
}
