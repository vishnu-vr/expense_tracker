import { InsightCard } from "./detectors";

export interface Phrasing {
  title: string;
  body: string;
}

/** Optional model-backed rewriter. Returns null (or throws) to keep the template. */
export type Phraser = (card: InsightCard) => Promise<Phrasing | null>;

/**
 * Every number that appears in a text, normalised: grouping commas removed
 * and trailing decimal zeros dropped ("₹1,71,518.40" -> "171518.4", "12.0%" -> "12").
 */
export function numbersIn(text: string): string[] {
  return (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) =>
    n.replace(/,/g, "").replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, ""),
  );
}

/** Numbers in `text` that are not in `allowed` (an empty list means the text is safe). */
export function disallowedNumbers(text: string, allowed: ReadonlySet<string>): string[] {
  return numbersIn(text).filter((n) => !allowed.has(n));
}

/** True when every number in `text` is in `allowed` (built with `numbersIn`). */
export function numbersAllowed(text: string, allowed: ReadonlySet<string>): boolean {
  return disallowedNumbers(text, allowed).length === 0;
}

/**
 * A rewrite is accepted only if it introduces no number that is not already
 * in the deterministic template, and stays within length limits. This keeps
 * the model strictly to wording.
 */
export function isSafePhrasing(card: InsightCard, phrasing: Phrasing | null | undefined): phrasing is Phrasing {
  if (!phrasing) return false;
  const title = phrasing.title?.trim();
  const body = phrasing.body?.trim();
  if (!title || !body || title.length > 90 || body.length > 420) return false;
  return numbersAllowed(`${title} ${body}`, new Set(numbersIn(`${card.title} ${card.body}`)));
}

/**
 * Apply the optional phraser; any failure or unsafe rewrite falls back to the
 * template text the detector produced, so cards work with no model at all.
 */
export async function phraseCards(cards: InsightCard[], phraser?: Phraser | null): Promise<InsightCard[]> {
  if (!phraser) return cards;
  const out: InsightCard[] = [];
  for (const c of cards) {
    let phrasing: Phrasing | null = null;
    try {
      phrasing = await phraser(c);
    } catch {
      phrasing = null;
    }
    out.push(isSafePhrasing(c, phrasing) ? { ...c, title: phrasing.title.trim(), body: phrasing.body.trim() } : c);
  }
  return out;
}
