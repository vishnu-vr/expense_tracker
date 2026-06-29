import { Injectable, inject, signal } from '@angular/core';
import { Functions } from '@angular/fire/functions';
import { FF } from '../firebase/ng-fire-mod';

export interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
}

@Injectable({
    providedIn: 'root'
})
export class AiService {
    private functions = inject(Functions);
    
    // Chat history
    messages = signal<ChatMessage[]>([]);
    
    // Loading state
    isLoading = signal(false);
    
    // Error state
    error = signal<string | null>(null);

    async askQuestion(question: string): Promise<string> {
        if (!question.trim()) {
            throw new Error('Please enter a question');
        }

        this.isLoading.set(true);
        this.error.set(null);

        // Add user message to history
        this.messages.update(msgs => [...msgs, {
            role: 'user',
            content: question,
            timestamp: new Date()
        }]);

        try {
            const analyzeTransactions = FF.httpsCallable<{ question: string; timeZone: string }, string>(
                this.functions,
                'analyzeTransactions'
            );

            const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
            const result = await analyzeTransactions({ question, timeZone });
            const answer = result.data;

            // Add assistant response to history
            this.messages.update(msgs => [...msgs, {
                role: 'assistant',
                content: answer,
                timestamp: new Date()
            }]);

            return answer;
        } catch (err: any) {
            const errorMessage = err.message || 'Failed to get response. Please try again.';
            this.error.set(errorMessage);
            
            // Add error message to chat
            this.messages.update(msgs => [...msgs, {
                role: 'assistant',
                content: `Sorry, I encountered an error: ${errorMessage}`,
                timestamp: new Date()
            }]);
            
            throw err;
        } finally {
            this.isLoading.set(false);
        }
    }

    clearHistory() {
        this.messages.set([]);
        this.error.set(null);
    }
}

