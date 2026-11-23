import { matchMerchant } from "./merchant";

/**
 * Text embedded for semantic note search:
 *   "<note> | <category name> | <matched merchant> | <tag names>"
 * Amount, date and type are deliberately NOT embedded — they are structured
 * filters. Returns null when there is no note (nothing worth searching).
 */
export function buildEmbeddingText(input: {
  note?: string | null;
  categoryName: string;
  tagNames: string[];
}): string | null {
  const note = (input.note ?? "").replace(/\s+/g, " ").trim();
  if (!note) return null;
  const merchant = matchMerchant(note) ?? "";
  const tags = input.tagNames.map((t) => t.trim()).filter(Boolean).join(", ");
  return `${note} | ${input.categoryName} | ${merchant} | ${tags}`;
}
