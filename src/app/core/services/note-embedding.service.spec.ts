import { TestBed } from '@angular/core/testing';
import { MockWorker } from '../../../testing/browser-mocks';
import { NoteEmbeddingService } from './note-embedding.service';

describe('NoteEmbeddingService', () => {
    let OriginalWorker: typeof Worker;

    class StubWorker extends MockWorker {
        static last: StubWorker | null = null;
        constructor(..._args: unknown[]) {
            super();
            StubWorker.last = this;
        }
    }

    beforeEach(() => {
        OriginalWorker = window.Worker;
        (window as unknown as { Worker: unknown }).Worker = StubWorker;
        StubWorker.last = null;
    });

    afterEach(() => {
        window.Worker = OriginalWorker;
    });

    it('returns empty array for empty texts', async () => {
        TestBed.configureTestingModule({});
        const svc = TestBed.inject(NoteEmbeddingService);
        await expectAsync(svc.embed([])).toBeResolvedTo([]);
    });

    it('embed resolves vectors from worker and caches', async () => {
        TestBed.configureTestingModule({});
        const svc = TestBed.inject(NoteEmbeddingService);
        const p = svc.embed(['alpha']);
        const w = StubWorker.last!;
        expect(w.postMessage).toHaveBeenCalled();
        const id = (w.postMessage as jasmine.Spy).calls.mostRecent().args[0].id as number;
        w.dispatchMessage({
            id,
            type: 'embed-result',
            vectors: [new Array(384).fill(0.1)],
        });
        const out = await p;
        expect(out.length).toBe(1);

        (w.postMessage as jasmine.Spy).calls.reset();
        await svc.embed(['alpha']);
        expect(w.postMessage).not.toHaveBeenCalled();
    });

    it('prewarm posts init once', () => {
        TestBed.configureTestingModule({});
        const svc = TestBed.inject(NoteEmbeddingService);
        svc.prewarm();
        const w = StubWorker.last!;
        const arg = (w.postMessage as jasmine.Spy).calls.mostRecent().args[0] as { type: string };
        expect(arg.type).toBe('init');
    });

    it('worker error rejects pending, sets modelFailed, terminates', async () => {
        TestBed.configureTestingModule({});
        const svc = TestBed.inject(NoteEmbeddingService);
        const p = svc.embed(['x']);
        const w = StubWorker.last!;
        const id = (w.postMessage as jasmine.Spy).calls.mostRecent().args[0].id as number;
        w.dispatchError(new ErrorEvent('error', { message: 'fail' }));
        await expectAsync(p).toBeRejectedWithError('fail');
        expect(svc.modelFailed()).toBeTrue();
        expect(w.terminate).toHaveBeenCalled();
        w.dispatchMessage({ id, type: 'ready' });
    });
});
