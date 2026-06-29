import { TestBed } from '@angular/core/testing';
import { Functions } from '@angular/fire/functions';
import { FF, resetNgFireModules } from '../firebase/ng-fire-mod';
import { AiService } from './ai.service';

describe('AiService', () => {
    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [AiService, { provide: Functions, useValue: {} }],
        });
    });

    afterEach(() => {
        resetNgFireModules();
    });

    it('askQuestion rejects empty input', async () => {
        const svc = TestBed.inject(AiService);
        await expectAsync(svc.askQuestion('   ')).toBeRejectedWithError(/Please enter a question/);
    });

    it('askQuestion appends user then assistant messages on success', async () => {
        spyOn(FF, 'httpsCallable').and.returnValue(() =>
            Promise.resolve({ data: 'Answer text' }),
        );

        const svc = TestBed.inject(AiService);
        const answer = await svc.askQuestion('What is up?');
        expect(answer).toBe('Answer text');
        const msgs = svc.messages();
        expect(msgs.length).toBe(2);
        expect(msgs[0].role).toBe('user');
        expect(msgs[1].role).toBe('assistant');
        expect(svc.isLoading()).toBeFalse();
    });

    it('askQuestion records error message when callable fails', async () => {
        spyOn(FF, 'httpsCallable').and.returnValue(() =>
            Promise.reject({ message: 'boom' }),
        );

        const svc = TestBed.inject(AiService);
        await expectAsync(svc.askQuestion('q')).toBeRejected();
        expect(svc.error()).toBe('boom');
        const last = svc.messages()[svc.messages().length - 1];
        expect(last.role).toBe('assistant');
        expect(last.content).toContain('boom');
    });

    it('clearHistory resets messages and error', async () => {
        spyOn(FF, 'httpsCallable').and.returnValue(() =>
            Promise.resolve({ data: 'ok' }),
        );
        const svc = TestBed.inject(AiService);
        await svc.askQuestion('hi');
        svc.clearHistory();
        expect(svc.messages().length).toBe(0);
        expect(svc.error()).toBeNull();
    });
});
