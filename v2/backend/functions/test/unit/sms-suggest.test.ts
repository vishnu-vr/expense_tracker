import { describe, expect, it } from "vitest";
import { resolveSmsSuggestModel, SMS_SUGGEST } from "../../src/config";
import {
  buildSuggestPrompt,
  cleanText,
  parseSuggestAnswer,
  parseSuggestRequest,
  rateLimitDocId,
  SuggestItem,
  SuggestRequestError,
} from "../../src/core/sms-suggest";
import type { Category } from "../../src/core/types";

const cats: Category[] = [
  { id: "food", name: "Food", type: "expense" },
  { id: "transportation", name: "Transportation", type: "expense" },
  { id: "pets", name: "Pets", type: "expense" },
  { id: "salary", name: "Salary", type: "income" },
];
const item = (text: string, type: "expense" | "income" = "expense", kind: "payee" | "words" = "payee"): SuggestItem => ({ text, type, kind });

describe("suggestSmsCategory request (D-032)", () => {
  it("accepts up to 5 items of at most 80 characters, cleans text and defaults kind to payee", () => {
    expect(parseSuggestRequest({ items: [{ text: "  BLUE   TOKAI\nCOFFEE ", type: "expense" }], model: "flash" })).toEqual({
      items: [item("BLUE TOKAI COFFEE")],
      model: "flash",
    });
    expect(parseSuggestRequest({ items: [{ text: "auto to office", type: "expense", kind: "words" }] }).items[0].kind).toBe("words");
    expect(parseSuggestRequest({ items: [{ text: "x".repeat(80), type: "income" }] }).model).toBeUndefined();
  });

  it("rejects anything else", () => {
    const bad = (data: unknown) => expect(() => parseSuggestRequest(data)).toThrow(SuggestRequestError);
    bad(undefined);
    bad({ items: [] });
    bad({ items: Array.from({ length: SMS_SUGGEST.maxItems + 1 }, () => ({ text: "a", type: "expense" })) });
    bad({ items: [{ text: "x".repeat(81), type: "expense" }] });
    bad({ items: [{ text: "   ", type: "expense" }] });
    bad({ items: [{ text: 5, type: "expense" }] });
    bad({ items: [{ text: "a", type: "transfer" }] });
    bad({ items: [{ text: "a", type: "expense", kind: "sms" }] });
    bad({ items: [{ text: "a", type: "expense" }], model: "vertexai/gemini-3.8-flash" });
    bad({ items: [{ text: "a", type: "expense" }], model: 3 });
  });

  it("cleanText drops control characters", () => {
    expect(cleanText("a\u0000b\tc")).toBe("a b c");
  });
});

describe("suggestSmsCategory model choice", () => {
  it("defaults to Flash-Lite; flash is the assistant's default model", () => {
    expect(resolveSmsSuggestModel()).toMatchObject({ key: "flash-lite", id: "vertexai/gemini-3.5-flash-lite", label: "Gemini Flash-Lite" });
    expect(resolveSmsSuggestModel("retired")).toMatchObject({ key: "flash-lite" });
    expect(resolveSmsSuggestModel("flash")).toMatchObject({ key: "flash", id: "vertexai/gemini-3.8-flash", label: "Gemini Flash" });
  });
});

describe("suggestSmsCategory prompt and answer check", () => {
  it("lists only the needed directions' categories and quotes the items as data", () => {
    const p = buildSuggestPrompt([item('BLUE "TOKAI"'), item("auto to office", "expense", "words")], cats);
    expect(p).toContain("Expense categories: food (Food), transportation (Transportation), pets (Pets)");
    expect(p).not.toContain("Income categories");
    expect(p).toContain(`1. expense, payee: "BLUE 'TOKAI'"`);
    expect(p).toContain(`2. expense, words: "auto to office"`);
  });

  it("keeps only listed ids (or exact names) of the item's direction", () => {
    const items = [item("BLUE TOKAI"), item("ACME PAYROLL", "income"), item("Ramesh"), item("Zoo"), item("Uber")];
    const answer = "1: food\n2: food\n3: none\n4: groceries\n5. Transportation\n9: food\n1: pets";
    expect(parseSuggestAnswer(answer, items, cats)).toEqual(["food", null, null, null, "transportation"]);
  });

  it("tolerates list markers, backticks and quotes, ignores prose", () => {
    const items = [item("A"), item("B", "income")];
    expect(parseSuggestAnswer("Sure! Here you go:\n- `1: food`\n* 2) \"salary\".", items, cats)).toEqual(["food", "salary"]);
    expect(parseSuggestAnswer("", items, cats)).toEqual([null, null]);
    expect(parseSuggestAnswer("I think food", items, cats)).toEqual([null, null]);
  });

  it("rate limit doc ids are day and uid", () => {
    expect(rateLimitDocId("2026-11-17", "u1")).toBe("2026-11-17_u1");
  });
});
