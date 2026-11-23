/**
 * Deterministic fixture household for the agent evaluation and unit tests.
 *
 * Two members, 8 full months (March–October 2026) plus the first 10 days of
 * November 2026. "Today" is fixed at 2026-11-10 in Asia/Kolkata. Everything is
 * generated from a seeded PRNG, so the data — and every golden number — is
 * identical on every run.
 *
 * Planted on purpose:
 *  - anomaly:      "Anniversary dinner at Taj" ₹18,500 (food) on 2026-10-18
 *  - duplicate:    "Uber to airport" ₹742 (transportation) logged twice on 2026-10-22
 *  - price change: Netflix ₹649 -> ₹799 from October
 *  - missed bill:  "Airtel broadband" ₹1,179 on the 1st, not logged in November
 *  - new series:   Spotify ₹119 from August
 *  - stopped:      Gym membership ₹1,500, last paid in June
 *  - drift:        Education rising every month July–October
 *  - habit:        Swiggy orders roughly double in October
 */
import { mergeCategories } from "../src/core/categories";
import { prepareTransactions } from "../src/core/prepare";
import { Budget, Category, HomeData, Member, Tag, Tx, TxType } from "../src/core/types";

export const FIXTURE_TIME_ZONE = "Asia/Kolkata";
export const FIXTURE_TODAY = "2026-11-10";
/** 2026-11-10 10:00 IST */
export const FIXTURE_NOW = new Date(Date.UTC(2026, 10, 10, 4, 30));
export const FIXTURE_HOME_ID = "home_fixture";

export const ASHA = "u_asha";
export const VIKRAM = "u_vikram";

export const FIXTURE_MEMBERS: Member[] = [
  { id: ASHA, name: "Asha", email: "asha@example.com" },
  { id: VIKRAM, name: "Vikram", email: "vikram@example.com" },
];

export const FIXTURE_TAGS: Tag[] = [
  { id: "tag_goa", name: "Goa trip" },
  { id: "tag_work", name: "Work" },
];

export const FIXTURE_HOME_CATEGORIES: Category[] = [{ id: "pets", name: "Pets", type: "expense" }];

export const FIXTURE_BUDGETS: Budget[] = [
  { categoryId: "food", amount: 12000 },
  { categoryId: "grocery", amount: 15000 },
  { categoryId: "transportation", amount: 6000 },
  { categoryId: "shopping", amount: 8000 },
  { categoryId: "entertainment", amount: 2000 },
];

/** mulberry32 — small, fast, deterministic PRNG. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MONTHS = ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"];
const DAYS_IN = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

export function generateFixtureTransactions(): Tx[] {
  const rand = prng(20261110);
  const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)];
  const out: Tx[] = [];
  const taken = new Set<string>();
  let seq = 0;

  const add = (
    day: string,
    type: TxType,
    categoryId: string,
    amount: number,
    note: string | undefined,
    userId: string,
    tagIds: string[] = [],
    allowDuplicate = false,
  ) => {
    if (day > FIXTURE_TODAY) return;
    let amt = amount;
    const key = () => `${type}|${day}|${categoryId}|${amt}|${(note ?? "").toLowerCase()}`;
    // Never create an accidental duplicate; only the planted one may repeat.
    while (!allowDuplicate && taken.has(key())) amt += 1;
    taken.add(key());
    seq += 1;
    const [y, m, d] = day.split("-").map(Number);
    out.push({
      id: `tx_${String(seq).padStart(4, "0")}`,
      amount: amt,
      categoryId,
      // Spread through the local day (09:00–21:00 IST) without crossing midnight.
      date: new Date(Date.UTC(y, m - 1, d, 3, 30 + ((seq * 37) % 720))),
      note,
      type,
      userId,
      userEmail: userId === ASHA ? "asha@example.com" : "vikram@example.com",
      tagIds,
    });
  };
  const dayOf = (month: string, d: number) => `${month}-${String(Math.min(d, DAYS_IN(month))).padStart(2, "0")}`;
  const who = () => (rand() < 0.55 ? ASHA : VIKRAM);

  MONTHS.forEach((month, mi) => {
    const isNov = month === "2026-11";
    const lastDay = isNov ? 10 : DAYS_IN(month);
    const anyDay = () => dayOf(month, int(1, lastDay));

    // ---- income
    add(dayOf(month, 1), "income", "salary", 85000, "Salary", ASHA);
    add(dayOf(month, 1), "income", "salary", 62000, "Salary", VIKRAM);
    if (month === "2026-05" || month === "2026-08") add(dayOf(month, 16), "income", "business", 15000, "Freelance project", VIKRAM, ["tag_work"]);

    // ---- recurring
    add(dayOf(month, 3), "expense", "home", 25000, "House rent", ASHA);
    add(dayOf(month, 5), "expense", "entertainment", mi >= 7 ? 799 : 649, "Netflix", VIKRAM);
    if (!isNov) add(dayOf(month, 1), "expense", "bills", 1179, "Airtel broadband", VIKRAM);
    if (!isNov) add(dayOf(month, 12), "expense", "bills", int(1800, 2600), "BESCOM electricity bill", VIKRAM);
    if (mi <= 3) add(dayOf(month, 10), "expense", "sport", 1500, "Gym membership", ASHA);
    if (mi >= 5 && !isNov) add(dayOf(month, 20), "expense", "entertainment", 119, "Spotify", ASHA);
    if (!isNov) add(dayOf(month, 8), "expense", "pets", int(1100, 1300), "Dog food", ASHA);

    // ---- everyday spending (scaled down for the 10 days of November)
    const scale = isNov ? 0.35 : 1;
    const times = (min: number, max: number) => Math.max(1, Math.round(int(min, max) * scale));

    for (let i = times(6, 8); i > 0; i--) {
      add(anyDay(), "expense", "grocery", int(300, 2500), pick(["BigBasket order", "DMart groceries", "Zepto", "Vegetables", "Blinkit"]), who());
    }
    const swiggy = month === "2026-10" ? 12 : times(4, 6);
    for (let i = swiggy; i > 0; i--) add(anyDay(), "expense", "food", int(180, 650), "Swiggy", who());
    for (let i = times(4, 6); i > 0; i--) {
      add(anyDay(), "expense", "food", int(150, 900), pick(["Zomato", "Lunch", "Dinner out", "Coffee"]), who());
    }
    for (let i = times(5, 8); i > 0; i--) {
      // Uber fares carry paise so decimal handling is exercised.
      add(anyDay(), "expense", "transportation", int(80, 600) + pick([0, 0.5, 0.25, 0.75]), pick(["Uber", "Ola", "Metro card recharge"]), who());
    }
    add(anyDay(), "expense", "transportation", int(1500, 2500), "Petrol", VIKRAM);
    for (let i = times(2, 4); i > 0; i--) {
      add(anyDay(), "expense", "shopping", int(500, 4000), pick(["Amazon", "Myntra", "Flipkart"]), who());
    }
    if (!isNov) add(anyDay(), "expense", "entertainment", int(400, 900), "PVR movie", who());
    if (rand() < 0.6 && !isNov) add(anyDay(), "expense", "health", int(200, 1500), pick(["Pharmacy", "Doctor visit"]), who());

    // ---- drift: education rises every month from July
    const course: Record<string, number> = { "2026-07": 2000, "2026-08": 2400, "2026-09": 2900, "2026-10": 3500 };
    if (course[month]) add(dayOf(month, 15), "expense", "education", course[month], "Online course", VIKRAM);
  });

  // ---- Goa trip (tagged), May
  add("2026-05-21", "expense", "transportation", 11840, "Flight to Goa", ASHA, ["tag_goa"]);
  add("2026-05-22", "expense", "fun_activities", 14500, "Beach resort stay", ASHA, ["tag_goa"]);
  add("2026-05-23", "expense", "food", 3260, "Seafood dinner", VIKRAM, ["tag_goa"]);
  add("2026-05-23", "expense", "fun_activities", 2400, "Scuba diving", VIKRAM, ["tag_goa"]);
  add("2026-05-24", "expense", "shopping", 1875, "Souvenirs", ASHA, ["tag_goa"]);

  // ---- planted anomaly
  add("2026-10-18", "expense", "food", 18500, "Anniversary dinner at Taj", ASHA);
  // ---- planted duplicate (same day, amount, category, note)
  add("2026-10-22", "expense", "transportation", 742, "Uber to airport", ASHA, [], true);
  add("2026-10-22", "expense", "transportation", 742, "Uber to airport", ASHA, [], true);

  return out.sort((a, b) => a.date.getTime() - b.date.getTime() || (a.id < b.id ? -1 : 1));
}

let cached: HomeData | null = null;

export function fixtureHomeData(): HomeData {
  if (!cached) {
    cached = {
      transactions: prepareTransactions(generateFixtureTransactions(), FIXTURE_TIME_ZONE),
      categories: mergeCategories(FIXTURE_HOME_CATEGORIES),
      budgets: FIXTURE_BUDGETS,
      tags: FIXTURE_TAGS,
      members: FIXTURE_MEMBERS,
    };
  }
  return cached;
}
