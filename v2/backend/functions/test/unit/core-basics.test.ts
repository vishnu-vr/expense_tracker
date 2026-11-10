import { describe, expect, it } from "vitest";
import { buildTransactionsCsv, csvEscape } from "../../src/core/csv";
import {
  addDays, addMonths, dayBoundary, daysInMonth, diffDays, isValidDay, isValidTimeZone, monthRange,
  toLocalDay, weekdayIndex, weekStart,
} from "../../src/core/dates";
import { buildEmbeddingText } from "../../src/core/embedding-text";
import { matchMerchant, normalizeNote, recurringNoteKey } from "../../src/core/merchant";
import { formatINR, formatPct, median, pctChange, round2 } from "../../src/core/money";
import { buildTransactionNotification, hasMeaningfulChange, IMPORT_AGE_MS } from "../../src/core/notification";

describe("money", () => {
  it("formats INR with Indian digit grouping", () => {
    expect(formatINR(171518.44)).toBe("₹1,71,518.44");
    expect(formatINR(25000)).toBe("₹25,000");
    expect(formatINR(999)).toBe("₹999");
    expect(formatINR(1000)).toBe("₹1,000");
    expect(formatINR(100000)).toBe("₹1,00,000");
    expect(formatINR(12345678.9)).toBe("₹1,23,45,678.90");
    expect(formatINR(0)).toBe("₹0");
    expect(formatINR(-1500.5)).toBe("-₹1,500.50");
    expect(formatINR(0.004)).toBe("₹0");
  });
  it("rounds and compares", () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(pctChange(150, 100)).toBe(50);
    expect(pctChange(10, 0)).toBeNull();
    expect(formatPct(12.34)).toBe("+12.3%");
    expect(formatPct(-5)).toBe("-5%");
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe("dates", () => {
  it("maps instants to the local calendar day", () => {
    // 2026-03-31 20:00 UTC is already 1 April in India.
    expect(toLocalDay(new Date(Date.UTC(2026, 2, 31, 20, 0)), "Asia/Kolkata")).toBe("2026-04-01");
    expect(toLocalDay(new Date(Date.UTC(2026, 2, 31, 20, 0)), "UTC")).toBe("2026-03-31");
    expect(toLocalDay(new Date(Date.UTC(2026, 2, 31, 20, 0)), "America/Los_Angeles")).toBe("2026-03-31");
  });
  it("does day and month arithmetic", () => {
    expect(addDays("2026-02-27", 3)).toBe("2026-03-02");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(diffDays("2026-03-01", "2026-02-01")).toBe(28);
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(daysInMonth("2024-02")).toBe(29);
    expect(monthRange("2026-11")).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(weekdayIndex("2026-11-10")).toBe(1); // Tuesday
    expect(weekStart("2026-11-10")).toBe("2026-11-09");
    expect(weekStart("2026-11-08")).toBe("2026-11-02"); // Sunday belongs to the week that started Monday
  });
  it("validates input", () => {
    expect(isValidDay("2026-02-29")).toBe(false);
    expect(isValidDay("2024-02-29")).toBe(true);
    expect(isValidDay("2026-2-9")).toBe(false);
    expect(isValidTimeZone("Asia/Kolkata")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone(undefined)).toBe(false);
  });
  it("finds the instant a local day starts and ends", () => {
    expect(dayBoundary("2026-10-01", false, "Asia/Kolkata").toISOString()).toBe("2026-09-30T18:30:00.000Z");
    expect(dayBoundary("2026-10-31", true, "Asia/Kolkata").toISOString()).toBe("2026-10-31T18:29:59.999Z");
    expect(dayBoundary("2026-07-01", false, "America/New_York").toISOString()).toBe("2026-07-01T04:00:00.000Z");
    expect(dayBoundary("2026-01-01", false, "America/New_York").toISOString()).toBe("2026-01-01T05:00:00.000Z");
  });
});

describe("merchant dictionary", () => {
  it("normalises and matches", () => {
    expect(normalizeNote("  Café—Swiggy #123 ")).toBe("cafe swiggy 123");
    expect(matchMerchant("SWIGGY order 4521")).toBe("Swiggy");
    expect(matchMerchant("uber to airport")).toBe("Uber");
    expect(matchMerchant("Amazon Prime renewal")).toBe("Amazon"); // brand order: Amazon is listed first
    expect(matchMerchant("BESCOM electricity bill")).toBe("Electricity");
    expect(matchMerchant("random thing")).toBeNull();
    expect(matchMerchant(undefined)).toBeNull();
    // word boundaries: "cola" must not match Ola
    expect(matchMerchant("coca cola")).toBeNull();
  });
  it("builds recurring keys like v1 (digits and punctuation dropped)", () => {
    expect(recurringNoteKey("Netflix 649!")).toBe("netflix");
    expect(recurringNoteKey("")).toBe("");
  });
});

describe("embedding text", () => {
  it("is note | category | merchant | tags and never contains amount, date or type", () => {
    expect(buildEmbeddingText({ note: "Swiggy  dinner", categoryName: "Food", tagNames: ["Goa trip", "Work"] })).toBe(
      "Swiggy dinner | Food | Swiggy | Goa trip, Work",
    );
    expect(buildEmbeddingText({ note: "plumber", categoryName: "Home", tagNames: [] })).toBe("plumber | Home |  | ");
  });
  it("is null without a note", () => {
    expect(buildEmbeddingText({ note: "   ", categoryName: "Food", tagNames: ["x"] })).toBeNull();
    expect(buildEmbeddingText({ note: undefined, categoryName: "Food", tagNames: [] })).toBeNull();
  });
});

describe("csv", () => {
  it("escapes and formats rows in the caller's time zone", () => {
    expect(csvEscape('a "quoted", value')).toBe('"a ""quoted"", value"');
    const csv = buildTransactionsCsv(
      [{ amount: 250.5, categoryId: "food", date: new Date(Date.UTC(2026, 9, 1, 20, 0)), note: "tea, snacks", type: "expense", userId: "u1", userEmail: "a@x.com", tagIds: ["t1", "t2"] }],
      { categoryName: () => "Food", userName: () => "Asha", tagName: (id) => id.toUpperCase() },
      "Asia/Kolkata",
    );
    expect(csv).toBe('Date,Type,Amount,Category,Note,Tags,User,Email\n2026-10-02 01:30,expense,250.5,Food,"tea, snacks",T1; T2,Asha,a@x.com\n');
  });
});

describe("transaction notifications", () => {
  const base = { amount: 1200, categoryId: "food", note: "Dinner", type: "expense", userId: "u1", homeId: "h1", tagIds: [], dateMs: 1 };
  it("words create / update / delete like the v1 client", () => {
    expect(buildTransactionNotification(null, base, "Asha")).toEqual({
      type: "transaction_added", message: "Asha added a new expense of ₹1,200", homeId: "h1", createdBy: "u1",
    });
    expect(buildTransactionNotification(base, { ...base, amount: 1500 }, "Asha")?.message).toBe("Asha updated a transaction: Dinner - ₹1,500");
    expect(buildTransactionNotification(base, null, "Asha")).toMatchObject({ type: "transaction_deleted", message: "Asha deleted a transaction: Dinner - ₹1,200" });
    expect(buildTransactionNotification(null, { ...base, type: "income" }, "Asha")?.message).toContain("income");
  });
  it("stays silent when nothing visible changed, the doc is unusable, or it is an import", () => {
    expect(buildTransactionNotification(base, { ...base }, "Asha")).toBeNull();
    expect(hasMeaningfulChange(base, { ...base, tagIds: ["a"] })).toBe(true);
    expect(buildTransactionNotification(null, { ...base, homeId: undefined }, "Asha")).toBeNull();
    const now = 1_800_000_000_000;
    expect(buildTransactionNotification(null, { ...base, createdAtMs: now - IMPORT_AGE_MS - 1 }, "Asha", now)).toBeNull();
    expect(buildTransactionNotification(null, { ...base, createdAtMs: now - 1000 }, "Asha", now)).not.toBeNull();
  });
});
