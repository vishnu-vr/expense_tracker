/** Round to paise. Every figure a tool returns goes through this. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Format as Indian Rupees with Indian digit grouping: 171518.44 -> "₹1,71,518.44".
 * Whole amounts drop the decimals: 25000 -> "₹25,000". Implemented by hand so
 * the output never depends on the runtime's ICU data.
 */
export function formatINR(value: number): string {
  if (!Number.isFinite(value)) return "₹0";
  const rounded = round2(Math.abs(value));
  const sign = value < 0 && rounded !== 0 ? "-" : "";
  const fixed = rounded.toFixed(2);
  const [whole, fraction] = fixed.split(".");
  let grouped: string;
  if (whole.length <= 3) {
    grouped = whole;
  } else {
    const last3 = whole.slice(-3);
    const rest = whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
    grouped = `${rest},${last3}`;
  }
  return `${sign}₹${grouped}${fraction === "00" ? "" : `.${fraction}`}`;
}

/** Signed percentage with one decimal: 12.34 -> "+12.3%". */
export function formatPct(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  const r = Math.round(value * 10) / 10;
  return `${r > 0 ? "+" : ""}${r}%`;
}

export function sum(values: number[]): number {
  let s = 0;
  for (const v of values) s += v;
  return s;
}

export function mean(values: number[]): number {
  return values.length === 0 ? 0 : sum(values) / values.length;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Population standard deviation. */
export function stdDev(values: number[], m = mean(values)): number {
  if (values.length === 0) return 0;
  return Math.sqrt(sum(values.map((v) => (v - m) * (v - m))) / values.length);
}

/** Percentage change, null when the base is zero. */
export function pctChange(current: number, previous: number): number | null {
  if (!Number.isFinite(previous) || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}
