/**
 * Pure shaping for the admin billing dashboard (D-024). Rows come from the
 * Cloud Billing export and Cloud Monitoring (see data/billing.ts); every
 * number the screen shows is computed here, never by a model.
 */

/** A calendar month in India time, with the UTC instants that bound it. */
export interface MonthWindow {
  /** "2026-11" */
  month: string;
  /** Billing export `invoice.month`, e.g. "202611". */
  invoiceMonth: string;
  previousInvoiceMonth: string;
  /** First instant of the month (inclusive). */
  start: Date;
  /** First instant of the next month (exclusive). */
  end: Date;
  daysInMonth: number;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Year and month (1-12) of [date] in a fixed-offset zone. */
export function zonedYearMonthDay(date: Date, offsetMinutes: number): { year: number; month: number; day: number } {
  const shifted = new Date(date.getTime() + offsetMinutes * 60_000);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Parses "YYYY-MM". Returns null for anything malformed or for a month after
 * the current one (in the given zone).
 */
export function parseMonth(raw: unknown, now: Date, offsetMinutes: number): MonthWindow | null {
  if (typeof raw !== "string") return null;
  const m = /^(\d{4})-(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12 || year < 2020) return null;
  const today = zonedYearMonthDay(now, offsetMinutes);
  if (year * 12 + month > today.year * 12 + today.month) return null;
  const offsetMs = offsetMinutes * 60_000;
  const prevYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;
  return {
    month: `${year}-${pad2(month)}`,
    invoiceMonth: `${year}${pad2(month)}`,
    previousInvoiceMonth: `${prevYear}${pad2(prevMonth)}`,
    start: new Date(Date.UTC(year, month - 1, 1) - offsetMs),
    end: new Date(Date.UTC(year, month, 1) - offsetMs),
    daysInMonth: daysInMonth(year, month),
  };
}

// ---------------------------------------------------------------------------
// Billing

export interface ServiceCostRow { service: string; cost: number; credits: number }
export interface SkuCostRow { service: string; sku: string; cost: number; credits: number; usage: number; unit: string }
export interface DailyCostRow { date: string; cost: number; credits: number }
export interface MonthTotalRow { invoiceMonth: string; currency: string; cost: number; credits: number; exportTime: string | null }

export interface BillingRows {
  services: ServiceCostRow[];
  skus: SkuCostRow[];
  daily: DailyCostRow[];
  /** One row per invoice month found (the requested month and the one before). */
  totals: MonthTotalRow[];
}

export type BillingSummary =
  | {
      configured: true;
      currency: string;
      /** Newest `export_time` for the month, ISO 8601. */
      dataAsOf: string | null;
      /** gross + credits (credits are negative). */
      net: number;
      gross: number;
      credits: number;
      previousMonthNet: number | null;
      /** Month-end estimate, current month only. */
      forecastNet: number | null;
      /** (forecastNet ?? net) − previousMonthNet. */
      changeVsPreviousMonth: number | null;
      byService: { service: string; amount: number }[];
      topSkus: { service: string; sku: string; amount: number; usage: number; unit: string }[];
      daily: { date: string; amount: number }[];
    }
  | {
      configured: false;
      /** not_set_up: no export dataset/table yet; no_data: nothing exported for this month; unavailable: query failed. */
      reason: "not_set_up" | "no_data" | "unavailable";
    };

/** Rounds to paise / cents. */
export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Sorts descending by amount and sums everything after the first [top] into "Other". */
export function groupOther<T extends { amount: number }>(
  rows: T[],
  top: number,
  makeOther: (amount: number) => T,
): T[] {
  const sorted = [...rows].sort((a, b) => b.amount - a.amount);
  // Folding a single leftover into "Other" would only hide its name.
  if (sorted.length <= top + 1) return sorted;
  const rest = sorted.slice(top).reduce((s, r) => s + r.amount, 0);
  return [...sorted.slice(0, top), makeOther(round2(rest))];
}

/**
 * Month-end estimate: average daily net so far × days in the month. Only for
 * the current month, and only once at least one day has started.
 */
export function forecastMonthEnd(net: number, window: MonthWindow, now: Date, offsetMinutes: number): number | null {
  if (now < window.start || now >= window.end) return null;
  const today = zonedYearMonthDay(now, offsetMinutes);
  const elapsedDays = today.day; // today counts as a (partial) day
  if (elapsedDays < 1) return null;
  return round2((net / elapsedDays) * window.daysInMonth);
}

export function shapeBilling(
  rows: BillingRows,
  window: MonthWindow,
  now: Date,
  opts: { topServices: number; offsetMinutes: number },
): BillingSummary {
  const current = rows.totals.find((t) => t.invoiceMonth === window.invoiceMonth);
  if (!current && rows.services.length === 0) return { configured: false, reason: "no_data" };

  const gross = round2(current ? num(current.cost) : rows.services.reduce((s, r) => s + num(r.cost), 0));
  const credits = round2(current ? num(current.credits) : rows.services.reduce((s, r) => s + num(r.credits), 0));
  const net = round2(gross + credits);
  const previous = rows.totals.find((t) => t.invoiceMonth === window.previousInvoiceMonth);
  const previousMonthNet = previous ? round2(num(previous.cost) + num(previous.credits)) : null;
  const forecastNet = forecastMonthEnd(net, window, now, opts.offsetMinutes);
  const changeVsPreviousMonth = previousMonthNet === null ? null : round2((forecastNet ?? net) - previousMonthNet);

  const byService = groupOther(
    rows.services
      .map((r) => ({ service: r.service || "Unknown", amount: round2(num(r.cost) + num(r.credits)) }))
      .filter((r) => r.amount !== 0),
    opts.topServices,
    (amount) => ({ service: "Other", amount }),
  );

  const topSkus = [...rows.skus]
    .sort((a, b) => num(b.cost) - num(a.cost))
    .map((r) => ({
      service: r.service || "Unknown",
      sku: r.sku || "Unknown",
      amount: round2(num(r.cost) + num(r.credits)),
      usage: num(r.usage),
      unit: r.unit ?? "",
    }));

  const daily = [...rows.daily]
    .map((r) => ({ date: r.date, amount: round2(num(r.cost) + num(r.credits)) }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    configured: true,
    currency: current?.currency || "INR",
    dataAsOf: current?.exportTime ?? null,
    net,
    gross,
    credits,
    previousMonthNet,
    forecastNet,
    changeVsPreviousMonth,
    byService,
    topSkus,
    daily,
  };
}

// ---------------------------------------------------------------------------
// Usage

export interface UsageSeries {
  /** `token_count` summed per model and type ("input" / "output"). */
  tokens: { model: string; type: string; count: number }[];
  /** Cloud Run `request_count` per service (each 2nd-gen function is a service). */
  requests: { service: string; count: number }[];
  firestore: { reads: number; writes: number; deletes: number };
}

export interface UsageSummary {
  /** False when the month is older than Monitoring keeps. */
  available: boolean;
  assistantQuestions: number;
  functionCalls: { name: string; count: number }[];
  firestore: { reads: number; writes: number; deletes: number };
  tokens: { model: string; input: number; output: number }[];
}

export const EMPTY_USAGE: UsageSummary = {
  available: false,
  assistantQuestions: 0,
  functionCalls: [],
  firestore: { reads: 0, writes: 0, deletes: 0 },
  tokens: [],
};

/** Monitoring only covers the month fully when its start is within retention. */
export function usageAvailable(window: MonthWindow, now: Date, retentionDays: number): boolean {
  return window.start.getTime() >= now.getTime() - retentionDays * 86_400_000;
}

/** Cloud Run service name of the askAgent function. */
export const ASSISTANT_SERVICE = "askagent";

export function shapeUsage(series: UsageSeries): UsageSummary {
  const byService = new Map<string, number>();
  for (const r of series.requests) byService.set(r.service, (byService.get(r.service) ?? 0) + num(r.count));
  const functionCalls = [...byService]
    .map(([name, count]) => ({ name, count }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const byModel = new Map<string, { input: number; output: number }>();
  for (const t of series.tokens) {
    const entry = byModel.get(t.model) ?? { input: 0, output: 0 };
    if (t.type === "input") entry.input += num(t.count);
    else if (t.type === "output") entry.output += num(t.count);
    byModel.set(t.model, entry);
  }
  const tokens = [...byModel]
    .map(([model, v]) => ({ model, ...v }))
    .filter((r) => r.input + r.output > 0)
    .sort((a, b) => b.input + b.output - (a.input + a.output) || a.model.localeCompare(b.model));

  return {
    available: true,
    assistantQuestions: byService.get(ASSISTANT_SERVICE) ?? 0,
    functionCalls,
    firestore: {
      reads: num(series.firestore.reads),
      writes: num(series.firestore.writes),
      deletes: num(series.firestore.deletes),
    },
    tokens,
  };
}
