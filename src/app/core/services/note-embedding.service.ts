import { Injectable, signal } from '@angular/core';

/**
 * Singleton wrapper around the on-device sentence-embedding Web Worker.
 *
 * Lazy-creates the worker on first `embed()` call (or `prewarm()`), exposes
 * a Promise-based API, and caches per-text vectors in memory so reopening
 * the same category panel doesn't re-run inference.
 *
 * If the worker fails to start (offline, CSP block, browser without worker
 * support), every embed call rejects and `modelReady()` stays `false`. The
 * caller is expected to fall back to its synchronous rule-based result in
 * that case - this service surfaces no UI of its own.
 */
@Injectable({ providedIn: 'root' })
export class NoteEmbeddingService {
    /** True once the worker has confirmed the model finished loading at least once. */
    readonly modelReady = signal<boolean>(false);
    /** True if the worker creation itself failed (model can't load at all). */
    readonly modelFailed = signal<boolean>(false);

    private worker: Worker | null = null;
    private workerInitFailed = false;
    private nextId = 1;
    private pending = new Map<
        number,
        { resolve: (v: number[][]) => void; reject: (err: Error) => void }
    >();
    private cache = new Map<string, number[]>();

    /**
     * Embed an array of texts and return one vector per text (mean-pooled,
     * L2-normalized, 384-dim for `all-MiniLM-L6-v2`).
     *
     * Resolves with cached values where available; only un-cached texts are
     * sent to the worker, then the cache is updated.
     */
    async embed(texts: string[]): Promise<number[][]> {
        if (texts.length === 0) return [];

        const toFetch: string[] = [];
        const toFetchIdx: number[] = [];
        const result: (number[] | undefined)[] = new Array(texts.length);

        for (let i = 0; i < texts.length; i++) {
            const t = texts[i];
            const cached = this.cache.get(t);
            if (cached) {
                result[i] = cached;
            } else {
                toFetch.push(t);
                toFetchIdx.push(i);
            }
        }

        if (toFetch.length === 0) {
            return result as number[][];
        }

        const worker = this.ensureWorker();
        if (!worker) {
            throw new Error('Embedding worker is unavailable');
        }

        const vectors = await this.request(worker, toFetch);
        for (let i = 0; i < vectors.length; i++) {
            const text = toFetch[i];
            const vec = vectors[i];
            this.cache.set(text, vec);
            result[toFetchIdx[i]] = vec;
        }

        return result as number[][];
    }

    /**
     * Optionally trigger model download eagerly (e.g. at app idle) so the
     * first real embed() call returns instantly.
     */
    prewarm(): void {
        const worker = this.ensureWorker();
        if (!worker) return;
        const id = this.nextId++;
        // Fire-and-forget: install a placeholder pending entry so a 'ready'
        // response with this id is handled, then resolve with empty.
        this.pending.set(id, {
            resolve: () => undefined,
            reject: () => undefined,
        });
        worker.postMessage({ id, type: 'init' });
    }

    private ensureWorker(): Worker | null {
        if (this.worker) return this.worker;
        if (this.workerInitFailed) return null;
        try {
            this.worker = new Worker(
                new URL('../workers/note-embedding.worker.ts', import.meta.url),
                { type: 'module' },
            );
            this.worker.addEventListener('message', this.onMessage);
            this.worker.addEventListener('error', this.onWorkerError);
            this.worker.addEventListener('messageerror', this.onWorkerError);
        } catch (err) {
            this.workerInitFailed = true;
            this.modelFailed.set(true);
            console.warn('[NoteEmbeddingService] Failed to start worker:', err);
            return null;
        }
        return this.worker;
    }

    private request(worker: Worker, texts: string[]): Promise<number[][]> {
        const id = this.nextId++;
        return new Promise<number[][]>((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            worker.postMessage({ id, type: 'embed', texts });
        });
    }

    private onMessage = (event: MessageEvent): void => {
        const msg = event.data as
            | { id: number; type: 'ready' }
            | { id: number; type: 'embed-result'; vectors: number[][] }
            | { id: number; type: 'error'; message: string };

        if (msg.type === 'ready') {
            this.modelReady.set(true);
            return;
        }

        const pending = this.pending.get(msg.id);
        if (!pending) return;
        this.pending.delete(msg.id);

        if (msg.type === 'embed-result') {
            this.modelReady.set(true);
            pending.resolve(msg.vectors);
        } else {
            pending.reject(new Error(msg.message));
        }
    };

    private onWorkerError = (event: Event): void => {
        const err =
            event instanceof ErrorEvent
                ? new Error(event.message)
                : new Error('Embedding worker error');
        console.warn('[NoteEmbeddingService] Worker error:', err.message);
        this.modelFailed.set(true);
        for (const pending of this.pending.values()) {
            pending.reject(err);
        }
        this.pending.clear();
        this.worker?.terminate();
        this.worker = null;
        this.workerInitFailed = true;
    };
}
