import { describe, expect, it } from "vitest";
import { coerceDate, summarizeByHome, totalsEqual, transformTransaction } from "../../src/scripts/migrate-transform";

const v1 = {
  amount: 1250.5,
  categoryId: "food",
  date: "2025-08-14T18:45:10.000Z",
  note: "  Dinner  ",
  type: "expense",
  userId: "u1",
  userEmail: "a@example.com",
  homeId: "h1",
  accountId: "cash",
  embedding: [0.1, 0.2, 0.3],
  tagIds: ["trip"],
};

describe("transformTransaction", () => {
  it("turns the ISO date into a Date (stored as Timestamp) and drops accountId and embedding", () => {
    const r = transformTransaction(v1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.date).toBeInstanceOf(Date);
    expect(r.doc.date.toISOString()).toBe("2025-08-14T18:45:10.000Z");
    expect(r.doc).not.toHaveProperty("accountId");
    expect(r.doc).not.toHaveProperty("embedding");
    expect(r.doc).toEqual({
      amount: 1250.5,
      categoryId: "food",
      date: new Date("2025-08-14T18:45:10.000Z"),
      note: "Dinner",
      type: "expense",
      userId: "u1",
      userEmail: "a@example.com",
      homeId: "h1",
      tagIds: ["trip"],
      createdAt: new Date("2025-08-14T18:45:10.000Z"),
      updatedAt: new Date("2025-08-14T18:45:10.000Z"),
    });
  });

  it("only ever emits schema v2 fields", () => {
    const r = transformTransaction({ ...v1, somethingElse: true, id: "x" });
    expect(r.ok && Object.keys(r.doc).sort()).toEqual(
      ["amount", "categoryId", "createdAt", "date", "homeId", "note", "tagIds", "type", "updatedAt", "userEmail", "userId"],
    );
  });

  it("defaults tagIds, omits an empty note, keeps existing createdAt / updatedAt", () => {
    const stamp = { toDate: () => new Date("2025-08-15T00:00:00.000Z") };
    const r = transformTransaction({ ...v1, note: "", tagIds: undefined, createdAt: stamp, updatedAt: "2025-09-01T00:00:00.000Z" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.tagIds).toEqual([]);
    expect(r.doc).not.toHaveProperty("note");
    expect(r.doc.createdAt.toISOString()).toBe("2025-08-15T00:00:00.000Z");
    expect(r.doc.updatedAt.toISOString()).toBe("2025-09-01T00:00:00.000Z");
  });

  it("accepts dates that are already Timestamps or date-only strings, and numeric-string amounts", () => {
    const r = transformTransaction({ ...v1, date: { toDate: () => new Date("2025-01-02T03:04:05.000Z") }, amount: "99.5" });
    expect(r.ok && r.doc.date.toISOString()).toBe("2025-01-02T03:04:05.000Z");
    expect(r.ok && r.doc.amount).toBe(99.5);
    expect(coerceDate("2025-03-04")?.toISOString()).toBe("2025-03-04T00:00:00.000Z");
  });

  it("reports documents it cannot migrate instead of guessing", () => {
    expect(transformTransaction({ ...v1, date: "not a date" })).toEqual({ ok: false, reason: 'invalid date: "not a date"' });
    expect(transformTransaction({ ...v1, date: undefined }).ok).toBe(false);
    expect(transformTransaction({ ...v1, amount: "abc" }).ok).toBe(false);
    expect(transformTransaction({ ...v1, amount: -1 }).ok).toBe(false);
    expect(transformTransaction({ ...v1, type: "transfer" }).ok).toBe(false);
    expect(transformTransaction({ ...v1, homeId: "" })).toEqual({ ok: false, reason: "missing homeId" });
    expect(transformTransaction({ ...v1, userId: undefined })).toEqual({ ok: false, reason: "missing userId" });
  });
});

describe("summarizeByHome", () => {
  it("gives identical per-home counts and sums before and after the transform", () => {
    const source = [
      v1,
      { ...v1, amount: 0.1, homeId: "h1" },
      { ...v1, amount: 0.2, homeId: "h1" },
      { ...v1, amount: 50000, type: "income", homeId: "h1" },
      { ...v1, amount: 300, homeId: "h2" },
    ];
    const target = source.map((s) => transformTransaction(s)).map((r) => (r.ok ? r.doc : null)).filter((d) => d !== null);
    const a = summarizeByHome(source);
    const b = summarizeByHome(target);
    expect(a.get("h1")).toEqual({ count: 4, income: 50000, expense: 1250.8 });
    expect(a.get("h2")).toEqual({ count: 1, income: 0, expense: 300 });
    for (const [homeId, totals] of a) expect(totalsEqual(totals, b.get(homeId))).toBe(true);
    expect(totalsEqual(a.get("h1"), a.get("h2"))).toBe(false);
    expect(totalsEqual(a.get("h1"), undefined)).toBe(false);
  });
});
