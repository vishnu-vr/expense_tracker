import { Block } from "../src/core/blocks";
import { ProposalDraft } from "../src/core/proposals";
import { Golden } from "./golden";

/** All the text a user would see, block by block. */
export function flattenBlocks(blocks: Block[]): string {
  return blocks
    .map((b) => {
      switch (b.type) {
        case "text":
          return b.text;
        case "stat":
          return `${b.label} ${b.value} ${b.caption ?? ""}`;
        case "bars":
          return `${b.title ?? ""} ${b.items.map((i) => `${i.label} ${i.display} ${i.value}`).join(" | ")}`;
        case "transactions":
          return b.items.map((i) => `${i.note} ${i.categoryName} ${i.amount}`).join(" | ");
        case "proposal":
          return b.summary;
      }
    })
    .join("\n");
}

/** Every number in a text: grouping commas removed, sign dropped. */
export function extractNumbers(text: string): number[] {
  return (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? [])
    .map((n) => Number(n.replace(/,/g, "")))
    .filter((n) => Number.isFinite(n));
}

export interface Score {
  /** All expected numbers present exactly (±0.01), expected text present, proposal correct. */
  pass: boolean;
  numbersExpected: number;
  /** Matched to the paisa. */
  numbersExact: number;
  /** Matched after rounding to the rupee (shows whether a miss is just rounding). */
  numbersRounded: number;
  missing: string[];
}

const same = (a: unknown, b: unknown): boolean => {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && [...a].map(String).sort().join("|") === [...b].map(String).sort().join("|");
  }
  return a === b;
};

const MALAYALAM = /[\u0D00-\u0D7F]/;

/** Sentences in a spoken answer; a "." inside a figure (₹1,518.44) does not end one. */
export function sentenceCount(text: string): number {
  return text.split(/[.!?।]+(?=\s|$)/).filter((s) => s.trim()).length;
}

/** Voice-mode and language checks (D-028); returns what is missing. */
export function spokenProblems(golden: Golden, blocks: Block[]): string[] {
  const problems: string[] = [];
  if (golden.reply === "voice") {
    const first = blocks[0];
    if (!first || first.type !== "text") {
      problems.push("first block is not a spoken text answer");
    } else {
      if (sentenceCount(first.text) > 2 || first.text.length > 320) problems.push("spoken answer longer than 2 sentences");
      const spoken = extractNumbers(first.text);
      if (golden.numbers.length && !golden.numbers.some((n) => spoken.some((f) => Math.abs(f - Math.abs(n.value)) <= 0.01))) {
        problems.push("spoken answer carries none of the expected figures");
      }
    }
  }
  if (golden.language === "ml") {
    const text = blocks.find((b) => b.type === "text");
    if (!text || text.type !== "text" || !MALAYALAM.test(text.text)) problems.push("answer is not in Malayalam");
  }
  return problems;
}

/** Deterministic scoring — no model judges the answer. */
export function scoreAnswer(golden: Golden, blocks: Block[], proposals: ProposalDraft[]): Score {
  const text = flattenBlocks(blocks);
  const found = extractNumbers(text);
  const missing: string[] = [];
  let exact = 0;
  let rounded = 0;
  for (const n of golden.numbers) {
    const target = Math.abs(n.value);
    const isExact = found.some((f) => Math.abs(f - target) <= 0.01);
    const isRounded = isExact || found.some((f) => Math.abs(f - target) < 0.5);
    if (isExact) exact++;
    else missing.push(`${n.label} = ${n.value}`);
    if (isRounded) rounded++;
  }
  for (const t of golden.text ?? []) {
    if (!text.toLowerCase().includes(t.toLowerCase())) missing.push(`text "${t}"`);
  }
  if (golden.noData) {
    const admits = /\b(no|not|none|nothing|zero|didn't|did not|don't|do not|haven't|have not|isn't|aren't|₹0)\b|₹0/i.test(text);
    const invents = found.some((f) => f >= 100 && f !== 2026);
    if (!admits || invents) missing.push("should say there is no data");
  }
  if (golden.proposal) {
    const shown = blocks.some((b) => b.type === "proposal" && b.action === golden.proposal!.action);
    const stored = proposals.some(
      (p) =>
        p.action === golden.proposal!.action &&
        Object.entries(golden.proposal!.params).every(([k, v]) => same((p.params as Record<string, unknown>)[k], v)),
    );
    if (!shown) missing.push("proposal block missing");
    if (!stored) missing.push("proposal not stored with the expected params");
  }
  missing.push(...spokenProblems(golden, blocks));
  return {
    pass: missing.length === 0,
    numbersExpected: golden.numbers.length,
    numbersExact: exact,
    numbersRounded: rounded,
    missing,
  };
}
