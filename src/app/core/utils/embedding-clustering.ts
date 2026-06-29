/**
 * ============================================================================
 * embedding-clustering.ts — Semantic merge of note buckets (Pass B)
 * ============================================================================
 *
 * Refines the rule-based bucket list from Pass A by embedding each non-brand
 * bucket's display name + sample raw notes into a 384-D vector space (via
 * the on-device `all-MiniLM-L6-v2` model), then merging buckets whose
 * vectors are close together (cosine similarity ≥ 0.72).
 *
 * This catches semantic equivalences that rule-based text matching can't:
 * "movie" and "cinema" have zero textual overlap, but the model knows they
 * mean the same thing because they appear in similar contexts in its
 * training data.
 *
 * ## Pipeline overview
 *
 *   1. Split buckets into protected (merchant-dictionary + no-note) vs candidates.
 *   2. Build enriched strings for each candidate (displayName + sample raw notes).
 *   3. Embed all candidate strings in one batch → get a 384-D vector per bucket.
 *   4. Compute pairwise cosine similarity between all candidate vectors.
 *   5. Union-Find clustering: merge pairs above the 0.72 threshold, heaviest wins.
 *   6. Reassemble: protected buckets + merged candidates → apply Top-N + Other.
 *
 * ## Worked example
 *
 * Input: uncapped rule-based buckets for an Entertainment category.
 *
 *   key          displayName      total   fromMerchant
 *   m:netflix    Netflix           500    true
 *   t:movie      Movie             300    false
 *   t:cinema     Cinema            250    false
 *   t:film       Film              100    false
 *   t:concert    Concert           200    false
 *   t:music      Live Music        180    false
 *   t:standup    Standup Show       70    false
 *
 * ### Step 1 — Split
 *
 *   Protected:  [Netflix]  (from merchant dictionary)
 *   Candidates: [Movie, Cinema, Film, Concert, Live Music, Standup Show]
 *
 * ### Step 2 — Build embed strings
 *
 *   "Movie | Movie ticket | Movie night"
 *   "Cinema | Cinema night | PVR cinema"
 *   "Film | PVR film"
 *   "Concert | Concert tickets"
 *   "Live Music | Live music show"
 *   "Standup Show | Standup show"
 *
 * ### Step 3 — Embed → 6 vectors of 384 dimensions each
 *
 * ### Step 4 — Pairwise cosine similarity (illustrative values)
 *
 *              Movie  Cinema  Film  Concert  Music  Standup
 *   Movie       -     0.78   0.74    0.31   0.28    0.35
 *   Cinema            -      0.81    0.29   0.25    0.33
 *   Film                      -      0.27   0.24    0.30
 *   Concert                           -     0.81    0.52
 *   Music                                    -      0.48
 *   Standup                                           -
 *
 * ### Step 5 — Union-Find clustering (threshold = 0.72)
 *
 *   Above-threshold pairs sorted by similarity:
 *     (Cinema, Film)    0.81 → merge. Cluster: {Cinema, Film}
 *     (Concert, Music)  0.81 → merge. Cluster: {Concert, Music}
 *     (Movie, Cinema)   0.78 → merge. Cluster: {Movie, Cinema, Film}
 *     (Movie, Film)     0.74 → already same cluster, no-op
 *
 *   Heaviest member's name wins each cluster:
 *     {Movie(300), Cinema(250), Film(100)} → display "Movie", total 650
 *     {Concert(200), Music(180)}           → display "Concert", total 380
 *     {Standup Show(70)}                   → display "Standup Show", total 70
 *
 * ### Step 6 — Reassemble + Top-N
 *
 *   Protected + merged candidates:
 *     Movie     650   41%
 *     Netflix   500   31%
 *     Concert   380   24%
 *     Standup    70    4%
 *
 *   Compare with Pass A alone (7 separate buckets, top 5 + Other):
 *     Netflix 500, Movie 300, Cinema 250, Concert 200, Music 180,
 *     Other(Film 100 + Standup 70)
 *
 *   Pass B collapsed semantically related items into a cleaner picture.
 */

import { applyTopNAndOther, NoteBucket } from './note-grouping';

/**
 * Cosine-similarity threshold above which two non-merchant buckets are
 * considered semantically equivalent and merged. Tuned conservatively so
 * that "movie"/"cinema"/"film" merge but "doctor"/"medicine" stay separate.
 */
const SIMILARITY_THRESHOLD = 0.72;

/** Up to N raw notes from a bucket are concatenated as the embedding input. */
const RAW_NOTES_PER_BUCKET = 3;

export type EmbedFn = (texts: string[]) => Promise<number[][]>;

/**
 * Refine a rule-based bucket list by semantically merging non-brand buckets
 * whose display names embed close together.
 *
 * Buckets that came from the merchant dictionary are passed through unchanged
 * (brand identity is more authoritative than semantic similarity). The
 * "No description" bucket is also passed through unchanged.
 *
 * Expects the *uncapped* output of `groupTransactionsByNoteRules(..., { applyTopN: false })`
 * so clustering can run across the entire tail before re-applying the Top-N + Other cap.
 *
 * Single-linkage agglomerative clustering: for each non-brand bucket we
 * compute pairwise cosine similarity, then iteratively merge the closest
 * pair as long as max similarity >= SIMILARITY_THRESHOLD.
 */
export async function semanticMergeBuckets(
    buckets: readonly NoteBucket[],
    embed: EmbedFn,
): Promise<NoteBucket[]> {
    if (buckets.length < 2) return [...buckets];

    const grandTotal = buckets.reduce((s, b) => s + b.total, 0) || 1;

    // Split out the buckets that should not participate in semantic merging.
    const protectedBuckets: NoteBucket[] = [];
    const candidates: NoteBucket[] = [];
    for (const b of buckets) {
        if (b.fromMerchantDictionary || b.key === '__no_note__') {
            protectedBuckets.push(b);
        } else {
            candidates.push(b);
        }
    }

    if (candidates.length < 2) {
        return applyTopNAndOther([...buckets], grandTotal);
    }

    // Build embed strings: displayName + up to RAW_NOTES_PER_BUCKET sample raw notes.
    const embedStrings = candidates.map((b) => {
        const samples = (b.sampleRawNotes ?? [])
            .slice(0, RAW_NOTES_PER_BUCKET)
            .filter((s) => s && s.trim().length > 0);
        if (samples.length === 0) return b.displayName;
        return `${b.displayName} | ${samples.join(' | ')}`;
    });

    let vectors: number[][];
    try {
        vectors = await embed(embedStrings);
    } catch (err) {
        console.warn('[semanticMergeBuckets] embedding failed, returning rule-based result:', err);
        return applyTopNAndOther([...buckets], grandTotal);
    }
    if (vectors.length !== candidates.length) {
        return applyTopNAndOther([...buckets], grandTotal);
    }

    // Pairwise similarity matrix.
    const n = candidates.length;
    const sim = new Float32Array(n * n);
    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            const s = cosine(vectors[i], vectors[j]);
            sim[i * n + j] = s;
            sim[j * n + i] = s;
        }
    }

    // Single-linkage agglomerative clustering: union-find on candidate indices.
    const parent = new Array<number>(n);
    for (let i = 0; i < n; i++) parent[i] = i;
    const find = (x: number): number => {
        while (parent[x] !== x) {
            parent[x] = parent[parent[x]];
            x = parent[x];
        }
        return x;
    };
    const union = (a: number, b: number) => {
        const ra = find(a);
        const rb = find(b);
        if (ra === rb) return;
        // Always anchor to the cluster containing the heaviest bucket so the
        // canonical = highest-total invariant is automatic.
        const totalA = clusterTotal(ra);
        const totalB = clusterTotal(rb);
        if (totalA >= totalB) parent[rb] = ra;
        else parent[ra] = rb;
    };
    const clusterTotal = (root: number): number => {
        let t = 0;
        for (let i = 0; i < n; i++) if (find(i) === root) t += candidates[i].total;
        return t;
    };

    // Collect all above-threshold pairs, sort by descending similarity, union them.
    interface Pair {
        i: number;
        j: number;
        s: number;
    }
    const pairs: Pair[] = [];
    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            const s = sim[i * n + j];
            if (s >= SIMILARITY_THRESHOLD) {
                pairs.push({ i, j, s });
            }
        }
    }
    pairs.sort((a, b) => b.s - a.s);
    for (const p of pairs) union(p.i, p.j);

    // Build merged buckets keyed by cluster root. Within each cluster we want
    // the canonical key/displayName to come from the heaviest member.
    const byRoot = new Map<number, { canonicalIdx: number; bucket: NoteBucket }>();
    for (let i = 0; i < n; i++) {
        const root = find(i);
        const cand = candidates[i];
        const existing = byRoot.get(root);
        if (!existing) {
            byRoot.set(root, {
                canonicalIdx: i,
                bucket: {
                    key: cand.key,
                    displayName: cand.displayName,
                    fromMerchantDictionary: false,
                    total: cand.total,
                    count: cand.count,
                    percentage: 0, // recomputed below
                    color: cand.color,
                    transactionIds: [...cand.transactionIds],
                    sampleRawNotes: [...(cand.sampleRawNotes ?? [])],
                },
            });
        } else {
            const eb = existing.bucket;
            const heavier = cand.total > candidates[existing.canonicalIdx].total;
            eb.total += cand.total;
            eb.count += cand.count;
            eb.transactionIds.push(...cand.transactionIds);
            if (heavier) {
                existing.canonicalIdx = i;
                eb.key = cand.key;
                eb.displayName = cand.displayName;
                eb.color = cand.color;
                eb.sampleRawNotes = [...(cand.sampleRawNotes ?? [])];
            }
        }
    }

    // Reassemble: protected buckets + merged candidates, then apply Top-N cap.
    const merged: NoteBucket[] = [];
    for (const b of protectedBuckets) merged.push({ ...b });
    for (const v of byRoot.values()) merged.push(v.bucket);

    return applyTopNAndOther(merged, grandTotal);
}

function cosine(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < a.length; i++) {
        const x = a[i];
        const y = b[i];
        dot += x * y;
        na += x * x;
        nb += y * y;
    }
    if (na === 0 || nb === 0) return 0;
    return dot / Math.sqrt(na * nb);
}
