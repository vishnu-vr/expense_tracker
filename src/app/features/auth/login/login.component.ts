import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../../core/services/auth.service';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <div class="min-h-screen flex items-center justify-center bg-canvas p-4">
      <div class="glass-card p-8 w-full max-w-md shadow-xl">
        <div class="text-center mb-8">
          <h1 class="text-3xl font-bold font-sora text-primary mb-2">Expense Tracker</h1>
          <p class="text-muted">Track your expenses effortlessly</p>
        </div>

        <!-- Error Message -->
        @if (errorMessage()) {
          <div class="bg-red-50 text-red-600 p-3 rounded-lg mb-4 text-sm">
            {{ errorMessage() }}
          </div>
        }

        <!-- Login Form -->
        <form [formGroup]="loginForm" (ngSubmit)="onSubmit()" class="space-y-4 mb-6">
          <div>
            <label class="block text-sm font-medium text-muted mb-1">Email</label>
            <input type="email" formControlName="email" 
                   class="w-full px-4 py-2 rounded-lg border border-border-app bg-inset focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                   placeholder="your@email.com">
          </div>
          
          <div>
            <label class="block text-sm font-medium text-muted mb-1">Password</label>
            <input type="password" formControlName="password" 
                   class="w-full px-4 py-2 rounded-lg border border-border-app bg-inset focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                   placeholder="••••••••">
          </div>

          <button type="submit" 
                  [disabled]="loginForm.invalid || isLoading()"
                  class="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-xl transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed">
            {{ isLoading() ? 'Signing in...' : 'Sign In' }}
          </button>
        </form>

        <div class="relative mb-6">
          <div class="absolute inset-0 flex items-center">
            <div class="w-full border-t border-border-app"></div>
          </div>
          <div class="relative flex justify-center text-sm">
            <span class="px-2 bg-surface text-muted">Or continue with</span>
          </div>
        </div>

        <button (click)="loginWithGoogle()" 
                class="w-full flex items-center justify-center gap-3 bg-surface border border-border-app hover:bg-surface2 text-muted font-medium py-3 px-4 rounded-xl transition-all shadow-sm hover:shadow-md">
          <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" class="w-6 h-6">
          Sign in with Google
        </button>
      </div>
    </div>
  `
})
export class LoginComponent {
  private authService = inject(AuthService);
  private fb = inject(FormBuilder);

  loginForm = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]]
  });

  errorMessage = signal('');
  isLoading = signal(false);

  onSubmit() {
    if (this.loginForm.valid) {
      this.isLoading.set(true);
      this.errorMessage.set('');
      const { email, password } = this.loginForm.value;

      this.authService.login(email!, password!).subscribe({
        next: () => {
          // Navigation handled in service
        },
        error: (err) => {
          this.isLoading.set(false);
          this.errorMessage.set(this.getErrorMessage(err));
        }
      });
    }
  }

  loginWithGoogle() {
    this.authService.loginWithGoogle().subscribe();
  }

  private getErrorMessage(err: any): string {
    if (err.code === 'auth/invalid-credential') {
      return 'Invalid email or password.';
    }
    if (err.code === 'auth/user-not-found') {
      return 'No user found with this email.';
    }
    if (err.code === 'auth/wrong-password') {
      return 'Incorrect password.';
    }
    return 'An error occurred. Please try again.';
  }
}
