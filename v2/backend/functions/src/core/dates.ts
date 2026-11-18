/**
 * Calendar helpers. All analysis works on calendar days in the household's
 * time zone, represented as `YYYY-MM-DD` strings, so results do not depend on
 * the server's own time zone.
 */

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export function isValidTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== "string" || !timeZone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Calendar day (`YYYY-MM-DD`) of an instant in a time zone. */
export function toLocalDay(date: Date, timeZone: string): string {
  const parts = formatterFor(timeZone).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidDay(day: unknown): day is string {
  if (typeof day !== "string") return false;
  const m = DAY_RE.exec(day);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

export function parseDay(day: string): { year: number; month: number; date: number } {
  const m = DAY_RE.exec(day);
  if (!m) throw new Error(`Invalid day: ${day}`);
  return { year: +m[1], month: +m[2], date: +m[3] };
}

const pad = (n: number) => String(n).padStart(2, "0");

export function makeDay(year: number, month: number, date: number): string {
  const d = new Date(Date.UTC(year, month - 1, date));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Days since the Unix epoch for a calendar day (for day arithmetic). */
export function dayNumber(day: string): number {
  const { year, month, date } = parseDay(day);
  return Math.round(Date.UTC(year, month - 1, date) / 86400000);
}

export function addDays(day: string, n: number): string {
  const { year, month, date } = parseDay(day);
  return makeDay(year, month, date + n);
}

export function diffDays(later: string, earlier: string): number {
  return dayNumber(later) - dayNumber(earlier);
}

/** `YYYY-MM` */
export function monthKey(day: string): string {
  return day.slice(0, 7);
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function monthRange(month: string): { from: string; to: string } {
  return { from: `${month}-01`, to: `${month}-${pad(daysInMonth(month))}` };
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "March 2026" */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

/** "3 Mar 2026" */
export function dayLabel(day: string): string {
  const { year, month, date } = parseDay(day);
  return `${date} ${MONTH_NAMES[month - 1].slice(0, 3)} ${year}`;
}

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

/** 0 = Monday … 6 = Sunday */
export function weekdayIndex(day: string): number {
  const { year, month, date } = parseDay(day);
  return (new Date(Date.UTC(year, month - 1, date)).getUTCDay() + 6) % 7;
}

/** The Monday that starts the week containing `day`. */
export function weekStart(day: string): string {
  return addDays(day, -weekdayIndex(day));
}

/**
 * The instant at which a calendar day starts (or ends, 23:59:59.999) in a
 * time zone. Used to turn day ranges into Firestore Timestamp bounds.
 */
export function dayBoundary(day: string, endOfDay: boolean, timeZone: string): Date {
  const { year, month, date } = parseDay(day);
  const naive = endOfDay
    ? Date.UTC(year, month - 1, date, 23, 59, 59, 999)
    : Date.UTC(year, month - 1, date, 0, 0, 0, 0);
  // Two passes so days around a DST change resolve correctly.
  let guess = naive - offsetMs(new Date(naive), timeZone);
  guess = naive - offsetMs(new Date(guess), timeZone);
  return new Date(guess);
}

function offsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** `YYYY-MM-DD HH:mm` in a time zone (CSV export). */
export function formatDateTime(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}
