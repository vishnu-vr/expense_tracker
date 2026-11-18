import { InsightCard } from "./detectors";

export interface Phrasing {
  title: string;
  body: string;
}

/** Optional model-backed rewriter. Returns null (or throws) to keep the template. */
export type Phraser = (card: InsightCard) => Promise<Phrasing | null>;

/** Every number that appears in a text, with grouping commas removed. */
export function numbersIn(text: string): string[] {
  return (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, "").replace(/\.0+$/, ""));
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
  const allowed = new Set(numbersIn(`${card.title} ${card.body}`));
  return numbersIn(`${title} ${body}`).every((n) => allowed.has(n));
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
