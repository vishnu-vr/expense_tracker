/// <reference lib="webworker" />

/**
 * Web Worker that hosts an on-device sentence-embedding model
 * (`Xenova/all-MiniLM-L6-v2`) for the smart note-grouping feature.
 *
 * Communication protocol:
 *   - In:  { id: number, type: 'embed', texts: string[] }
 *   - In:  { id: number, type: 'init' }   // optional, kicks off model preload
 *   - Out: { id: number, type: 'ready' }  // sent once after first init/embed call succeeds
 *   - Out: { id: number, type: 'embed-result', vectors: number[][] }
 *   - Out: { id: number, type: 'error', message: string }
 *
 * The model is downloaded from the Hugging Face CDN on first use (~22 MB) and
 * cached by the browser thereafter. All inference happens here, so the main
 * thread never blocks on tensor work.
 */

import { pipeline, env, type FeatureExtractionPipeline } from '@huggingface/transformers';

env.allowLocalModels = false;
env.allowRemoteModels = true;

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';

let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;
let readyAnnounced = false;

function getExtractor(): Promise<FeatureExtractionPipeline> {
    if (!extractorPromise) {
        extractorPromise = pipeline('feature-extraction', MODEL_ID, {
            dtype: 'q8',
        }) as Promise<FeatureExtractionPipeline>;
    }
    return extractorPromise;
}

interface EmbedRequest {
    id: number;
    type: 'embed';
    texts: string[];
}

interface InitRequest {
    id: number;
    type: 'init';
}

type WorkerRequest = EmbedRequest | InitRequest;

self.addEventListener('message', async (event: MessageEvent<WorkerRequest>) => {
    const msg = event.data;
    try {
        const extractor = await getExtractor();
        if (!readyAnnounced) {
            readyAnnounced = true;
            (self as unknown as Worker).postMessage({ id: msg.id, type: 'ready' });
        }

        if (msg.type === 'init') {
            return;
        }

        if (msg.type === 'embed') {
            if (msg.texts.length === 0) {
                (self as unknown as Worker).postMessage({
                    id: msg.id,
                    type: 'embed-result',
                    vectors: [],
                });
                return;
            }
            const output = await extractor(msg.texts, { pooling: 'mean', normalize: true });
            const dims = output.dims;
            const data = output.data as Float32Array;
            const rows = dims[0];
            const cols = dims[1];
            const vectors: number[][] = [];
            for (let r = 0; r < rows; r++) {
                const row = new Array<number>(cols);
                for (let c = 0; c < cols; c++) {
                    row[c] = data[r * cols + c];
                }
                vectors.push(row);
            }
            (self as unknown as Worker).postMessage({
                id: msg.id,
                type: 'embed-result',
                vectors,
            });
        }
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        (self as unknown as Worker).postMessage({
            id: msg.id,
            type: 'error',
            message,
        });
    }
});
