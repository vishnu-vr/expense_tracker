/**
 * ============================================================================
 * note-grouping.ts — Rule-based clustering of transaction notes (Pass A)
 * ============================================================================
 *
 * Groups a category's transactions by their `note` field so the UI can show
 * a "Breakdown by description" donut chart. The pipeline runs synchronously
 * and produces results instantly when a category panel opens.
 *
 * ## Pipeline overview
 *
 *   Step 1 — Normalize note text (lowercase, strip diacritics, collapse spaces).
 *   Step 2 — Match against a curated merchant/brand dictionary (highest priority).
 *   Step 3 — Detect frequent bigram phrases among untagged notes.
 *   Step 4 — Tokenize + drop stop-words + light stem.
 *   Step 5 — Pick the highest-frequency token per note as its bucket key.
 *   Step 6 — Fuzzy-merge similar buckets (edit distance, phonetic, prefix).
 *   Step 7 — Pick a pretty display name per bucket.
 *   Step 8 — Keep top 5 buckets, roll the rest into "Other".
 *
 * ## Worked example
 *
 * Input: 11 transactions from the Transportation category, April 2026.
 *
 *   note                amount
 *   ──────────────────────────
 *   "Uber"               100
 *   "uber"               200
 *   "Uber to office"     300
 *   "Ubr"                 50     ← typo
 *   "uber123"             80     ← no word boundary, dictionary misses it
 *   "Petrol pump"        150
 *   "Petrol pump"        180
 *   "petrol HP"          120
 *   "Movie"               50
 *   "Cinema"              70
 *   ""                    40     ← empty note
 *
 * ### Step 1 — Normalize
 *
 *   "Uber"           → "uber"
 *   "Uber to office" → "uber to office"
 *   "Ubr"            → "ubr"
 *   "uber123"        → "uber123"
 *   "Petrol pump"    → "petrol pump"
 *   "petrol HP"      → "petrol hp"
 *   ""               → ""  (empty → assigned to __no_note__ bucket immediately)
 *
 * ### Step 2 — Merchant dictionary
 *
 *   "uber"             matches /\b(uber|ubr|ubre)\b/ → key "m:uber", display "Uber"
 *   "uber"             same → "m:uber"
 *   "uber to office"   "uber" in note → "m:uber"
 *   "ubr"              matches /\b(uber|ubr|ubre)\b/ → "m:uber"
 *   "uber123"          no word boundary (\b fails on "uber123") → UNTAGGED
 *   "petrol pump"      "petrol" matches → "m:petrol"... wait, "petrol pump"
 *                      actually matches /\b(petrol|...)\b/ → "m:petrol"
 *   "petrol pump"      same → "m:petrol"
 *   "petrol hp"        "petrol" matches → "m:petrol"
 *
 *   After Step 2:
 *     Tagged:   t1-t4 → m:uber (4 txns), t6-t8 → m:petrol (3 txns), t11 → __no_note__
 *     Untagged: t5("uber123"), t9("movie"), t10("cinema")
 *
 * ### Step 3 — Bigram phrases (only over untagged)
 *
 *   Untagged notes: ["uber123", "movie", "cinema"]
 *   All are single tokens after tokenization — no bigrams possible.
 *   phraseSet = {} (empty)
 *
 * ### Step 4+5 — Tokenize, count frequencies, assign keys
 *
 *   Tokens per untagged note:
 *     "uber123" → ["uber123"]
 *     "movie"   → ["movie"]
 *     "cinema"  → ["cinema"]
 *
 *   Global token frequencies: uber123=1, movie=1, cinema=1
 *   Each note has only one token, so that token wins:
 *     t5  → key "t:uber123"
 *     t9  → key "t:movie"
 *     t10 → key "t:cinema"
 *
 * ### Aggregation
 *
 *   key            total   count
 *   m:uber          650     4     (100+200+300+50)
 *   m:petrol        450     3     (150+180+120)
 *   t:uber123        80     1
 *   t:cinema         70     1
 *   t:movie          50     1
 *   __no_note__      40     1
 *
 * ### Step 6 — Fuzzy merge (biggest-first, smaller gets absorbed)
 *
 *   t:uber123 vs m:uber → stripped keys "uber123" vs "uber"
 *     Edit distance: 3 (fails)
 *     Phonetic: different (fails)
 *     Prefix: "uber123".startsWith("uber") and "uber".length >= 4 → YES
 *     → t:uber123 absorbed into m:uber. New total: 650+80 = 730.
 *
 *   t:cinema vs t:movie → "cinema" vs "movie"
 *     Edit distance: 4 (fails). Phonetic: different. Prefix: no.
 *     → not merged (will be handled by Pass B semantic embeddings instead).
 *
 * ### Step 7 — Display names
 *
 *   Merchant buckets keep their canonical name ("Uber", "Petrol").
 *   t:cinema → raw note "Cinema" appears 1/1 = 100% ≥ 60% → display "Cinema".
 *   t:movie  → raw note "Movie" appears 1/1 = 100% → display "Movie".
 *
 * ### Step 8 — Top-N + Other
 *
 *   5 buckets total (≤ TOP_N+1=6), so no "Other" needed.
 *
 *   Final output:
 *     displayName     total   percentage   color
 *     Uber             730     54%         #6366f1  (indigo)
 *     Petrol           450     33%         #10b981  (emerald)
 *     Cinema            70      5%         #f59e0b  (amber)
 *     Movie             50      4%         #ef4444  (red)
 *     No description    40      3%         (default)
 *
 *   Pass B (embedding-clustering.ts) may later merge Cinema + Movie if their
 *   384-D vectors are close enough (cosine similarity ≥ 0.72).
 */

import { Transaction } from '../models/models';
import { matchMerchant, MERCHANT_CANONICAL_NAMES } from './merchant-dictionary';

/**
 * One grouped bucket of transactions that share a similar `note`.
 * Produced by the synchronous rule-based pipeline (Pass A) and may be further
 * merged by the on-device embedding pipeline (Pass B).
 */
export interface NoteBucket {
    /** Stable, normalized key used for tracking + de-duping. Lowercase, no spaces. */
    key: string;
    /** What the UI shows in the legend / tooltip. */
    displayName: string;
    /** Sum of `amount` across the bucket's transactions. */
    total: number;
    /** Number of transactions in the bucket. */
    count: number;
    /** Share of the *category* total this bucket represents, 0-100. */
    percentage: number;
    /** Color from the palette below, assigned by rank. */
    color: string;
    /** IDs of the underlying transactions (handy for future drill-down). */
    transactionIds: string[];
    /** True when the bucket key came from the merchant dictionary. The semantic
     *  merge pass leaves these alone so brand identity is preserved. */
    fromMerchantDictionary: boolean;
    /** A few representative raw notes (most frequent first), used by the
     *  embedding pass to enrich the text it feeds the model. May be empty
     *  for the merchant-tagged or no-description buckets. */
    sampleRawNotes: string[];
}

/** Color palette for buckets (top-N by amount). "Other" always gets `OTHER_COLOR`. */
export const BUCKET_PALETTE: readonly string[] = [
    '#6366f1', // indigo
    '#10b981', // emerald
    '#f59e0b', // amber
    '#ef4444', // red
    '#8b5cf6', // violet
    '#06b6d4', // cyan
];
export const OTHER_COLOR = '#9ca3af'; // gray-400
export const NO_NOTE_KEY = '__no_note__';

/** Max number of named buckets shown before rolling the rest into "Other". */
export const TOP_N = 5;

/** Stop-words dropped before token-frequency clustering. */
const STOP_WORDS = new Set<string>([
    'to', 'from', 'for', 'at', 'in', 'on', 'of', 'with', 'and', 'or', 'by',
    'via', 'near', 'the', 'a', 'an', 'my', 'our', 'your', 'his', 'her',
    'am', 'pm', 'rs', 'rupees', 'inr',
]);

// =============================================================================
// Public API
// =============================================================================

/**
 * Synchronously cluster the given expense transactions by their `note` field
 * using the multi-step rule pipeline:
 *
 *   1. Normalize note text.
 *   2. Tag against merchant dictionary (highest priority).
 *   3. Detect frequent bigram phrases ("petrol pump", "auto rickshaw").
 *   4. Tokenize + drop stop-words + light stem.
 *   5. Token-frequency clustering for what remains.
 *   6. Multi-strategy fuzzy merge (edit distance / phonetic / prefix).
 *   7. Pick a display name per bucket.
 *   8. Top-N + Other (when `options.applyTopN !== false`).
 *
 * The result is sorted by `total` desc and ready to render.
 *
 * Pass `applyTopN: false` if you want the *full* bucket list without rolling
 * the tail into "Other" - the semantic-merge pass needs this so it can
 * cluster across the entire tail before re-applying its own cap.
 */
export function groupTransactionsByNoteRules(
    transactions: readonly Transaction[],
    options: { applyTopN?: boolean } = {},
): NoteBucket[] {
    if (transactions.length === 0) return [];

    const grandTotal = transactions.reduce((sum, t) => sum + t.amount, 0) || 1;

    interface Working {
        bucketKey: string;
        bucketDisplay: string;
        fromMerchantDictionary: boolean;
        rawNote: string;
        normalizedNote: string;
    }

    const working: Working[] = transactions.map((t) => {
        const raw = t.note ?? '';
        const normalized = normalizeNote(raw);
        if (!normalized) {
            return {
                bucketKey: NO_NOTE_KEY,
                bucketDisplay: 'No description',
                fromMerchantDictionary: false,
                rawNote: raw,
                normalizedNote: '',
            };
        }
        // Step 2: merchant dictionary
        const canonical = matchMerchant(normalized);
        if (canonical) {
            return {
                bucketKey: 'm:' + canonical.toLowerCase(),
                bucketDisplay: canonical,
                fromMerchantDictionary: true,
                rawNote: raw,
                normalizedNote: normalized,
            };
        }
        return {
            bucketKey: '',
            bucketDisplay: '',
            fromMerchantDictionary: false,
            rawNote: raw,
            normalizedNote: normalized,
        };
    });

    // Step 3-5 only runs over the items that the dictionary didn't tag and
    // that aren't `__no_note__`.
    const untagged = working.filter((w) => !w.bucketKey);

    if (untagged.length > 0) {
        // Step 3: detect frequent bigram phrases
        const phraseSet = detectBigramPhrases(untagged.map((w) => w.normalizedNote));

        // Tokenize each note (Step 4) and assign by phrase (Step 3) or token frequency (Step 5).
        const tokensPerNote: string[][] = untagged.map((w) => tokenizeAndStem(w.normalizedNote));
        const tokenFreq = new Map<string, number>();
        for (const tokens of tokensPerNote) {
            const seen = new Set<string>();
            for (const tok of tokens) {
                if (seen.has(tok)) continue;
                seen.add(tok);
                tokenFreq.set(tok, (tokenFreq.get(tok) ?? 0) + 1);
            }
        }

        for (let i = 0; i < untagged.length; i++) {
            const w = untagged[i];
            const tokens = tokensPerNote[i];

            // Step 3: bigram phrase wins if present
            const phrase = findContainingPhrase(tokens, phraseSet);
            if (phrase) {
                w.bucketKey = 'p:' + phrase;
                w.bucketDisplay = titleCase(phrase);
                continue;
            }

            // Step 5: highest-frequency token across the corpus
            if (tokens.length === 0) {
                // No surviving tokens - fall back to the normalized note as-is so it
                // still has a stable bucket. Empty case already handled above.
                w.bucketKey = 'r:' + w.normalizedNote;
                w.bucketDisplay = titleCase(w.normalizedNote);
                continue;
            }
            let best = tokens[0];
            let bestFreq = tokenFreq.get(best) ?? 0;
            for (const tok of tokens) {
                const f = tokenFreq.get(tok) ?? 0;
                if (
                    f > bestFreq ||
                    (f === bestFreq && tok.length > best.length) ||
                    (f === bestFreq && tok.length === best.length && tok < best)
                ) {
                    best = tok;
                    bestFreq = f;
                }
            }
            w.bucketKey = 't:' + best;
            w.bucketDisplay = titleCase(best);
        }
    }

    // Aggregate into buckets.
    interface Aggregated {
        key: string;
        displayName: string;
        fromMerchantDictionary: boolean;
        total: number;
        count: number;
        transactionIds: string[];
        rawNoteCounts: Map<string, number>;
    }
    const buckets = new Map<string, Aggregated>();
    for (let i = 0; i < transactions.length; i++) {
        const t = transactions[i];
        const w = working[i];
        let agg = buckets.get(w.bucketKey);
        if (!agg) {
            agg = {
                key: w.bucketKey,
                displayName: w.bucketDisplay,
                fromMerchantDictionary: w.fromMerchantDictionary,
                total: 0,
                count: 0,
                transactionIds: [],
                rawNoteCounts: new Map(),
            };
            buckets.set(w.bucketKey, agg);
        }
        agg.total += t.amount;
        agg.count += 1;
        agg.transactionIds.push(t.id);
        if (w.rawNote) {
            agg.rawNoteCounts.set(w.rawNote, (agg.rawNoteCounts.get(w.rawNote) ?? 0) + 1);
        }
    }

    let aggregated = Array.from(buckets.values()).sort((a, b) => b.total - a.total);

    // Step 6: multi-strategy fuzzy merge. Walk in descending-total order so larger
    // buckets absorb smaller similar ones.
    aggregated = fuzzyMergeBuckets(aggregated);

    // Step 7: pick the final display name per bucket.
    for (const agg of aggregated) {
        if (agg.fromMerchantDictionary || agg.key === NO_NOTE_KEY) continue; // already canonical
        agg.displayName = pickDisplayName(agg.displayName, agg.rawNoteCounts, agg.count);
    }

    aggregated.sort((a, b) => b.total - a.total);

    const fullList = aggregated.map((agg, i) => toBucket(agg, i, grandTotal));
    if (options.applyTopN === false) {
        return fullList;
    }
    return applyTopNAndOther(fullList, grandTotal);
}

/**
 * Cap a bucket list at TOP_N named entries and roll the rest into a single
 * grey "Other" bucket. Used by both the rule pipeline and the semantic merge
 * pass after clustering.
 */
export function applyTopNAndOther(buckets: NoteBucket[], grandTotalOverride?: number): NoteBucket[] {
    if (buckets.length === 0) return [];
    const grandTotal = grandTotalOverride ?? (buckets.reduce((s, b) => s + b.total, 0) || 1);

    const sorted = [...buckets].sort((a, b) => b.total - a.total);
    const recolor = (b: NoteBucket, rank: number): NoteBucket => ({
        ...b,
        percentage: (b.total / grandTotal) * 100,
        color: b.fromMerchantDictionary || b.key === NO_NOTE_KEY
            ? b.color
            : BUCKET_PALETTE[rank % BUCKET_PALETTE.length],
    });

    if (sorted.length <= TOP_N + 1) {
        return sorted.map(recolor);
    }

    const head = sorted.slice(0, TOP_N).map(recolor);
    const tail = sorted.slice(TOP_N);
    let restTotal = 0;
    let restCount = 0;
    const restIds: string[] = [];
    for (const r of tail) {
        restTotal += r.total;
        restCount += r.count;
        restIds.push(...r.transactionIds);
    }
    head.push({
        key: '__other__',
        displayName: 'Other',
        fromMerchantDictionary: false,
        total: restTotal,
        count: restCount,
        percentage: (restTotal / grandTotal) * 100,
        color: OTHER_COLOR,
        transactionIds: restIds,
        sampleRawNotes: [],
    });
    return head;
}

// =============================================================================
// Step helpers
// =============================================================================

/** Lowercase, strip diacritics, collapse non-alphanumerics to spaces, trim. */
export function normalizeNote(raw: string): string {
    if (!raw) return '';
    return raw
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // strip diacritic marks
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .replace(/\s+/g, ' ');
}

/** Tokenize a normalized note: drop stop-words, pure numbers, length-1 tokens; light stem. */
function tokenizeAndStem(normalized: string): string[] {
    if (!normalized) return [];
    const out: string[] = [];
    for (const tok of normalized.split(' ')) {
        if (!tok) continue;
        if (tok.length < 2) continue;
        if (STOP_WORDS.has(tok)) continue;
        if (/^[0-9]+$/.test(tok)) continue;
        out.push(stem(tok));
    }
    return out;
}

/** Lightweight English stem: handles trailing s/es/ies for plurals. */
function stem(token: string): string {
    if (token.length > 4 && token.endsWith('ies')) return token.slice(0, -3) + 'y';
    if (token.length > 4 && token.endsWith('es')) return token.slice(0, -2);
    if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
    return token;
}

/** Detect bigrams that appear >= 2 times AND co-occur as often as either word alone. */
function detectBigramPhrases(normalizedNotes: string[]): Set<string> {
    const wordCounts = new Map<string, number>();
    const bigramCounts = new Map<string, number>();
    const seenInNote: Array<{ words: Set<string>; bigrams: Set<string> }> = [];

    for (const note of normalizedNotes) {
        const tokens = tokenizeAndStem(note);
        const words = new Set<string>(tokens);
        const bigrams = new Set<string>();
        for (let i = 0; i < tokens.length - 1; i++) {
            const bg = tokens[i] + ' ' + tokens[i + 1];
            bigrams.add(bg);
        }
        for (const w of words) wordCounts.set(w, (wordCounts.get(w) ?? 0) + 1);
        for (const bg of bigrams) bigramCounts.set(bg, (bigramCounts.get(bg) ?? 0) + 1);
        seenInNote.push({ words, bigrams });
    }

    const phrases = new Set<string>();
    for (const [bg, c] of bigramCounts) {
        if (c < 2) continue;
        const [w1, w2] = bg.split(' ');
        const c1 = wordCounts.get(w1) ?? 0;
        const c2 = wordCounts.get(w2) ?? 0;
        // Co-occurrence test: bigram appears at least as often as each component
        // word alone. This means whenever the words appear, they appear together.
        if (c >= c1 && c >= c2) {
            phrases.add(bg);
        }
    }
    return phrases;
}

/** Return the longest bigram phrase that appears (in order) within `tokens`. */
function findContainingPhrase(tokens: string[], phrases: Set<string>): string | null {
    if (phrases.size === 0 || tokens.length < 2) return null;
    let best: string | null = null;
    for (let i = 0; i < tokens.length - 1; i++) {
        const bg = tokens[i] + ' ' + tokens[i + 1];
        if (phrases.has(bg)) {
            if (!best || bg.length > best.length) best = bg;
        }
    }
    return best;
}

// =============================================================================
// Step 6: fuzzy merge
// =============================================================================

interface Aggregated {
    key: string;
    displayName: string;
    fromMerchantDictionary: boolean;
    total: number;
    count: number;
    transactionIds: string[];
    rawNoteCounts: Map<string, number>;
}

function fuzzyMergeBuckets(buckets: Aggregated[]): Aggregated[] {
    if (buckets.length < 2) return buckets;
    // Larger first; merge later ones into earlier ones.
    const sorted = [...buckets].sort((a, b) => b.total - a.total);
    const result: Aggregated[] = [];

    for (const candidate of sorted) {
        const candKey = stripPrefix(candidate.key);
        let mergedInto: Aggregated | null = null;
        for (const target of result) {
            // Never touch the no-note bucket. Never merge a brand candidate
            // into anything (we don't want "Uber" disappearing into "Ola" or a
            // generic word). But it's fine to absorb a non-brand candidate
            // into a brand target - that's the typo case ("uber123" -> "Uber").
            if (
                candidate.key === NO_NOTE_KEY ||
                target.key === NO_NOTE_KEY ||
                candidate.fromMerchantDictionary
            ) {
                continue;
            }
            const targetKey = stripPrefix(target.key);
            if (areKeysSimilar(targetKey, candKey)) {
                mergedInto = target;
                break;
            }
        }

        if (mergedInto) {
            mergedInto.total += candidate.total;
            mergedInto.count += candidate.count;
            mergedInto.transactionIds.push(...candidate.transactionIds);
            for (const [raw, c] of candidate.rawNoteCounts) {
                mergedInto.rawNoteCounts.set(raw, (mergedInto.rawNoteCounts.get(raw) ?? 0) + c);
            }
        } else {
            result.push({ ...candidate, transactionIds: [...candidate.transactionIds], rawNoteCounts: new Map(candidate.rawNoteCounts) });
        }
    }

    return result;
}

/** Strip the "m:" / "p:" / "t:" / "r:" prefix used to namespace internal keys. */
function stripPrefix(key: string): string {
    return key.length > 2 && key[1] === ':' ? key.slice(2) : key;
}

/**
 * Two bucket keys are considered similar if any of the heuristics fire:
 *   - Damerau-Levenshtein distance <= 1 (with both keys length >= 4)
 *   - Same phonetic key (vowel-stripped, deduped) and both keys length >= 4
 *   - One is a prefix of the other (with the shorter length >= 4)
 *
 * Phrase keys (containing a space) are treated whole-string and require
 * both phrases to be >= 5 chars to participate.
 */
function areKeysSimilar(a: string, b: string): boolean {
    if (a === b) return true;
    if (a.length < 4 || b.length < 4) return false;

    // Phrase + word: only allow merging if the phrase contains the word (handled by prefix below).
    const aHasSpace = a.includes(' ');
    const bHasSpace = b.includes(' ');
    if (aHasSpace !== bHasSpace) {
        // word vs phrase: allow only if the word is the head of the phrase.
        const phrase = aHasSpace ? a : b;
        const word = aHasSpace ? b : a;
        return phrase.startsWith(word + ' ');
    }

    // Edit distance.
    if (damerauLevenshtein(a, b, 2) <= 1) return true;

    // Phonetic.
    const pa = phoneticKey(a);
    const pb = phoneticKey(b);
    if (pa.length >= 2 && pa === pb) return true;

    // Prefix containment.
    const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
    if (shorter.length >= 4 && longer.startsWith(shorter)) return true;

    return false;
}

/** Damerau-Levenshtein distance with an early-exit cap. */
export function damerauLevenshtein(a: string, b: string, cap = 99): number {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > cap) return cap + 1;
    const al = a.length;
    const bl = b.length;
    if (al === 0) return bl;
    if (bl === 0) return al;

    let prev2 = new Array<number>(bl + 1);
    let prev1 = new Array<number>(bl + 1);
    let curr = new Array<number>(bl + 1);
    for (let j = 0; j <= bl; j++) prev1[j] = j;

    for (let i = 1; i <= al; i++) {
        curr[0] = i;
        let rowMin = curr[0];
        for (let j = 1; j <= bl; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            let v = Math.min(
                curr[j - 1] + 1,      // insertion
                prev1[j] + 1,         // deletion
                prev1[j - 1] + cost,  // substitution
            );
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
                v = Math.min(v, prev2[j - 2] + 1); // transposition
            }
            curr[j] = v;
            if (v < rowMin) rowMin = v;
        }
        if (rowMin > cap) return cap + 1; // early exit
        const tmp = prev2;
        prev2 = prev1;
        prev1 = curr;
        curr = tmp;
    }
    return prev1[bl];
}

/**
 * Cheap phonetic key: drop vowels (a/e/i/o/u/y) and silent-ish letters (h/w),
 * collapse consecutive duplicate consonants. Catches "uber"/"oober", "rider"/"rydr".
 */
export function phoneticKey(word: string): string {
    if (!word) return '';
    let out = '';
    let last = '';
    for (const ch of word) {
        if ('aeiouyhw'.includes(ch)) continue;
        if (ch === ' ') continue;
        if (ch === last) continue;
        out += ch;
        last = ch;
    }
    return out;
}

// =============================================================================
// Step 7: display name + Step 8: bucket assembly
// =============================================================================

function pickDisplayName(currentDisplay: string, rawNoteCounts: Map<string, number>, totalCount: number): string {
    if (totalCount === 0) return currentDisplay;
    let bestRaw: string | null = null;
    let bestCount = 0;
    for (const [raw, c] of rawNoteCounts) {
        if (c > bestCount) {
            bestRaw = raw;
            bestCount = c;
        }
    }
    if (bestRaw && bestCount / totalCount >= 0.6) {
        return bestRaw.trim();
    }
    return currentDisplay;
}

function titleCase(s: string): string {
    if (!s) return s;
    return s
        .split(' ')
        .map((w) => (w.length === 0 ? w : w[0].toUpperCase() + w.slice(1)))
        .join(' ');
}

function toBucket(agg: Aggregated, rank: number, grandTotal: number): NoteBucket {
    return {
        key: agg.key,
        displayName: agg.displayName,
        fromMerchantDictionary: agg.fromMerchantDictionary,
        total: agg.total,
        count: agg.count,
        percentage: (agg.total / grandTotal) * 100,
        color: BUCKET_PALETTE[rank % BUCKET_PALETTE.length],
        transactionIds: agg.transactionIds,
        sampleRawNotes: pickSampleRawNotes(agg.rawNoteCounts),
    };
}

function pickSampleRawNotes(rawNoteCounts: Map<string, number>): string[] {
    if (rawNoteCounts.size === 0) return [];
    return Array.from(rawNoteCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([raw]) => raw.trim())
        .filter((s) => s.length > 0);
}

// =============================================================================
// Re-exports for the semantic-merge layer
// =============================================================================

export { MERCHANT_CANONICAL_NAMES };
