import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HomeService } from '../../core/services/home.service';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-home-onboarding',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="min-h-screen bg-canvas flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div class="sm:mx-auto sm:w-full sm:max-w-md">
        <h2 class="mt-6 text-center text-3xl font-extrabold font-sora text-primary">
          Welcome to Expense Tracker
        </h2>
        <p class="mt-2 text-center text-sm text-muted">
          To get started, create a new home or join an existing one.
        </p>
        <!-- Sign out link -->
        <div class="mt-4 flex justify-center">
          <button (click)="logout()"
            class="flex items-center gap-1.5 text-sm text-faint hover:text-red-500 transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            Sign out
          </button>
        </div>
      </div>

      <div class="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div class="glass-card py-8 px-4 sm:px-10">
          
          <!-- Toggle Tabs -->
          <div class="flex border-b border-border-app mb-6">
            <button 
              (click)="activeTab.set('create')"
              [class.border-indigo-500]="activeTab() === 'create'"
              [class.text-indigo-600]="activeTab() === 'create'"
              class="w-1/2 py-4 px-1 text-center border-b-2 font-medium text-sm focus:outline-none"
              [class.border-transparent]="activeTab() !== 'create'"
              [class.text-muted]="activeTab() !== 'create'"
              [class.hover:text-primary]="activeTab() !== 'create'"
              [class.hover:border-border-app]="activeTab() !== 'create'">
              Create New Home
            </button>
            <button 
              (click)="activeTab.set('join')"
              [class.border-indigo-500]="activeTab() === 'join'"
              [class.text-indigo-600]="activeTab() === 'join'"
              class="w-1/2 py-4 px-1 text-center border-b-2 font-medium text-sm focus:outline-none"
              [class.border-transparent]="activeTab() !== 'join'"
              [class.text-muted]="activeTab() !== 'join'"
              [class.hover:text-primary]="activeTab() !== 'join'"
              [class.hover:border-border-app]="activeTab() !== 'join'">
              Join Existing Home
            </button>
          </div>

          <!-- Create Home Form -->
          <div *ngIf="activeTab() === 'create'">
            <div class="space-y-6">
              <div>
                <label for="homeName" class="block text-sm font-medium text-muted">
                  Home Name
                </label>
                <div class="mt-1">
                  <input 
                    type="text" 
                    id="homeName"
                    [(ngModel)]="homeName"
                    name="homeName" 
                    placeholder="e.g. Vishnu's House"
                    class="appearance-none block w-full px-3 py-2 border border-border-app bg-inset rounded-md shadow-sm placeholder:text-faint focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" 
                    required>
                </div>
              </div>

              <div>
                <button 
                  (click)="createHome()"
                  [disabled]="!homeName || loading()"
                  class="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed">
                  <svg *ngIf="loading()" class="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  {{ loading() ? 'Creating...' : 'Create Home' }}
                </button>
              </div>
            </div>
          </div>

          <!-- Join Home Form -->
          <div *ngIf="activeTab() === 'join'">
            <div class="space-y-6">
              <div>
                <label for="homeCode" class="block text-sm font-medium text-muted">
                  Home Invite Code
                </label>
                <div class="mt-1">
                  <input 
                    type="text" 
                    id="homeCode"
                    [(ngModel)]="homeCode"
                    name="homeCode" 
                    placeholder="e.g. A1B2C3"
                    class="appearance-none block w-full px-3 py-2 border border-border-app bg-inset rounded-md shadow-sm placeholder:text-faint focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm uppercase" 
                    required>
                </div>
                <p class="mt-2 text-xs text-muted">
                  Ask the home owner for the 6-character invite code.
                </p>
              </div>

              <div *ngIf="error()" class="rounded-md bg-red-50 p-4">
                <div class="flex">
                  <div class="flex-shrink-0">
                    <svg class="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                      <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clip-rule="evenodd" />
                    </svg>
                  </div>
                  <div class="ml-3">
                    <h3 class="text-sm font-medium text-red-800">{{ error() }}</h3>
                  </div>
                </div>
              </div>

              <div>
                <button 
                  (click)="joinHome()"
                  [disabled]="!homeCode || loading()"
                  class="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed">
                   <svg *ngIf="loading()" class="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  {{ loading() ? 'Joining...' : 'Join Home' }}
                </button>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  `
})
export class HomeOnboardingComponent {
  private homeService = inject(HomeService);
  private authService = inject(AuthService);
  private router = inject(Router);

  logout() {
    this.authService.logout().subscribe();
  }

  activeTab = signal<'create' | 'join'>('create');
  homeName = '';
  homeCode = '';
  loading = signal(false);
  error = signal<string | null>(null);

  async createHome() {
    if (!this.homeName) return;

    this.loading.set(true);
    this.error.set(null);
    try {
      await this.homeService.createHome(this.homeName);
      this.router.navigate(['/home']);
    } catch (err: any) {
      console.error('Failed to create home', err);
      this.error.set('Failed to create home. Please try again.');
    } finally {
      this.loading.set(false);
    }
  }

  async joinHome() {
    if (!this.homeCode) return;

    this.loading.set(true);
    this.error.set(null);
    try {
      await this.homeService.joinHome(this.homeCode.toUpperCase());
      this.router.navigate(['/home']);
    } catch (err: any) {
      console.error('Failed to join home', err);
      this.error.set('Could not join home. Please check the code and try again.');
    } finally {
      this.loading.set(false);
    }
  }
}
