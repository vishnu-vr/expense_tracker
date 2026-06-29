import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';

export const routes: Routes = [
    { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
    {
        path: 'login',
        loadComponent: () => import('./features/auth/login/login.component').then(m => m.LoginComponent)
    },
    {
        path: 'onboarding',
        loadComponent: () => import('./features/home/home-onboarding.component').then(m => m.HomeOnboardingComponent),
        canActivate: [authGuard]
    },
    {
        path: 'dashboard',
        loadComponent: () => import('./features/dashboard/dashboard.component').then(m => m.DashboardComponent),
        canActivate: [authGuard]
    },
    {
        path: 'add-transaction',
        loadComponent: () => import('./features/add-transaction/add-transaction.component').then(m => m.AddTransactionComponent),
        canActivate: [authGuard]
    },
    {
        path: 'categories',
        loadComponent: () => import('./features/category-manager/category-list/category-list.component').then(m => m.CategoryListComponent),
        canActivate: [authGuard]
    },
    {
        path: 'budgets',
        loadComponent: () => import('./features/budgets/budgets.component').then(m => m.BudgetsComponent),
        canActivate: [authGuard]
    },

    {
        path: 'edit-transaction/:id',
        loadComponent: () => import('./features/add-transaction/add-transaction.component').then(m => m.AddTransactionComponent),
        canActivate: [authGuard]
    },
    {
        path: 'analysis',
        loadComponent: () => import('./features/analysis/analysis.component').then(m => m.AnalysisComponent),
        canActivate: [authGuard]
    },
    {
        path: 'ask-ai',
        loadComponent: () => import('./features/ask-ai/ask-ai.component').then(m => m.AskAiComponent),
        canActivate: [authGuard]
    },
    {
        path: 'trends',
        loadComponent: () => import('./features/trends/trends.component').then(m => m.TrendsComponent),
        canActivate: [authGuard]
    },
    {
        path: 'profile',
        loadComponent: () => import('./features/profile/profile.component').then(m => m.ProfileComponent),
        canActivate: [authGuard]
    },
    {
        path: 'sms-permission-help',
        loadComponent: () => import('./features/profile/sms-permission-help.component').then(m => m.SmsPermissionHelpComponent),
        canActivate: [authGuard]
    }
];
