import { Component, inject, signal, ViewChild, ElementRef, AfterViewChecked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { AiService } from '../../core/services/ai.service';

@Component({
    selector: 'app-ask-ai',
    standalone: true,
    imports: [CommonModule, FormsModule, RouterModule],
    template: `
        <div class="flex flex-col h-screen bg-canvas">
            <!-- Header -->
            <header class="flex items-center gap-4 p-4 bg-surface/80 backdrop-blur-sm border-b border-border-app">
                <button routerLink="/analysis" class="icon-btn -ml-2">
                    <span class="material-icons text-violet-600">arrow_back</span>
                </button>
                <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                        <span class="material-icons text-white">auto_awesome</span>
                    </div>
                    <div>
                        <h1 class="text-lg font-bold font-sora text-primary">Ask AI</h1>
                        <p class="text-xs text-muted">Analyze your expenses</p>
                    </div>
                </div>
                @if (aiService.messages().length > 0) {
                    <button (click)="clearChat()" class="ml-auto p-2 rounded-full hover:bg-red-50 transition-colors" title="Clear chat">
                        <span class="material-icons text-red-400">delete_outline</span>
                    </button>
                }
            </header>

            <!-- Chat Messages -->
            <div #chatContainer class="flex-1 overflow-y-auto p-4 space-y-4">
                @if (aiService.messages().length === 0) {
                    <!-- Welcome State -->
                    <div class="flex flex-col items-center justify-center h-full text-center px-6">
                        <div class="w-20 h-20 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center mb-6 shadow-lg shadow-violet-200">
                            <span class="material-icons text-white text-4xl">psychology</span>
                        </div>
                        <h2 class="text-xl font-bold font-sora text-primary mb-2">Ask me anything about your expenses</h2>
                        <p class="text-muted mb-8">I can analyze your transactions and give you insights</p>
                        
                        <!-- Suggested Questions -->
                        <div class="w-full space-y-2">
                            <p class="text-xs text-faint uppercase tracking-wide mb-3">Try asking</p>
                            @for (suggestion of suggestions; track suggestion) {
                                <button (click)="askSuggestion(suggestion)"
                                    class="w-full text-left p-4 glass-card hover:border-violet-300 hover:shadow-md transition-all text-muted">
                                    <span class="material-icons text-violet-500 mr-2 text-sm align-middle">arrow_forward</span>
                                    {{ suggestion }}
                                </button>
                            }
                        </div>
                    </div>
                } @else {
                    <!-- Chat Messages -->
                    @for (message of aiService.messages(); track message.timestamp) {
                        <div class="flex" [class.justify-end]="message.role === 'user'">
                            <div class="max-w-[85%] rounded-2xl px-4 py-3"
                                [class.bg-gradient-to-br]="message.role === 'user'"
                                [class.from-violet-500]="message.role === 'user'"
                                [class.to-purple-600]="message.role === 'user'"
                                [class.text-white]="message.role === 'user'"
                                [class.bg-surface]="message.role === 'assistant'"
                                [class.text-primary]="message.role === 'assistant'"
                                [class.shadow-sm]="message.role === 'assistant'"
                                [class.border]="message.role === 'assistant'"
                                [class.border-border-app]="message.role === 'assistant'">
                                @if (message.role === 'assistant') {
                                    <div class="flex items-start gap-2">
                                        <span class="material-icons text-violet-500 text-sm mt-0.5">auto_awesome</span>
                                        <div class="whitespace-pre-wrap">{{ message.content }}</div>
                                    </div>
                                } @else {
                                    <div class="whitespace-pre-wrap">{{ message.content }}</div>
                                }
                            </div>
                        </div>
                    }
                    
                    <!-- Loading indicator -->
                    @if (aiService.isLoading()) {
                        <div class="flex">
                            <div class="bg-surface rounded-2xl px-4 py-3 shadow-sm border border-border-app">
                                <div class="flex items-center gap-2">
                                    <span class="material-icons text-violet-500 text-sm animate-pulse">auto_awesome</span>
                                    <div class="flex gap-1">
                                        <div class="w-2 h-2 bg-violet-400 rounded-full animate-bounce" style="animation-delay: 0ms"></div>
                                        <div class="w-2 h-2 bg-violet-400 rounded-full animate-bounce" style="animation-delay: 150ms"></div>
                                        <div class="w-2 h-2 bg-violet-400 rounded-full animate-bounce" style="animation-delay: 300ms"></div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    }
                }
            </div>

            <!-- Input Area -->
            <div class="p-4 bg-surface border-t border-border-app">
                <form (submit)="sendMessage($event)" class="flex gap-2">
                    <input
                        #inputField
                        [(ngModel)]="question"
                        name="question"
                        type="text"
                        placeholder="Ask about your expenses..."
                        class="flex-1 px-4 py-3 bg-inset rounded-xl border border-border-app focus:border-violet-400 focus:ring-2 focus:ring-violet-100 outline-none transition-all"
                        [disabled]="aiService.isLoading()"
                        autocomplete="off"
                    />
                    <button
                        type="submit"
                        [disabled]="aiService.isLoading() || !question.trim()"
                        class="px-4 py-3 bg-gradient-to-br from-violet-500 to-purple-600 text-white rounded-xl font-medium hover:shadow-lg hover:shadow-violet-200 disabled:opacity-50 disabled:cursor-not-allowed transition-all">
                        <span class="material-icons">send</span>
                    </button>
                </form>
            </div>
        </div>
    `,
    styles: [`
        :host {
            display: block;
            height: 100vh;
        }
    `]
})
export class AskAiComponent implements AfterViewChecked {
    aiService = inject(AiService);
    
    @ViewChild('chatContainer') private chatContainer!: ElementRef;
    @ViewChild('inputField') private inputField!: ElementRef;
    
    question = '';
    
    suggestions = [
        'How much did I spend on food this month?',
        'What was my largest expense?',
        'Show me my spending by category',
        'How much did I spend last week?'
    ];

    ngAfterViewChecked() {
        this.scrollToBottom();
    }

    private scrollToBottom() {
        if (this.chatContainer) {
            const container = this.chatContainer.nativeElement;
            container.scrollTop = container.scrollHeight;
        }
    }

    async sendMessage(event: Event) {
        event.preventDefault();
        
        if (!this.question.trim() || this.aiService.isLoading()) return;
        
        const q = this.question;
        this.question = '';
        
        try {
            await this.aiService.askQuestion(q);
        } catch (err) {
            console.error('Error asking question:', err);
        }
    }

    askSuggestion(suggestion: string) {
        this.question = suggestion;
        this.sendMessage(new Event('submit'));
    }

    clearChat() {
        this.aiService.clearHistory();
    }
}

