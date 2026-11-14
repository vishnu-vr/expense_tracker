/**
 * Per-household activity for the admin dashboard: counts and dates only,
 * never amounts or notes (D-026).
 */

export interface HouseholdActivityRow {
  homeId: string;
  homeName: string;
  members: number;
  /** All entries ever recorded for the household. */
  entries: number;
  /** Entries dated in the selected month. */
  entriesInMonth: number;
  /** ISO date-time of the most recent entry, or null when there are none. */
  lastEntryAt: string | null;
}

export interface HouseholdActivitySummary {
  available: boolean;
  households: number;
  entries: number;
  entriesInMonth: number;
  /** Households with at least one entry dated in the selected month. */
  activeInMonth: number;
  byHousehold: HouseholdActivityRow[];
}

export const EMPTY_HOUSEHOLD_ACTIVITY: HouseholdActivitySummary = {
  available: false,
  households: 0,
  entries: 0,
  entriesInMonth: 0,
  activeInMonth: 0,
  byHousehold: [],
};

/** Totals plus rows sorted by entries in the month, then all-time entries, then name. */
export function shapeHouseholdActivity(rows: HouseholdActivityRow[]): HouseholdActivitySummary {
  const byHousehold = [...rows].sort(
    (a, b) =>
      b.entriesInMonth - a.entriesInMonth ||
      b.entries - a.entries ||
      a.homeName.localeCompare(b.homeName) ||
      a.homeId.localeCompare(b.homeId),
  );
  return {
    available: true,
    households: rows.length,
    entries: rows.reduce((s, r) => s + r.entries, 0),
    entriesInMonth: rows.reduce((s, r) => s + r.entriesInMonth, 0),
    activeInMonth: rows.filter((r) => r.entriesInMonth > 0).length,
    byHousehold,
  };
}
