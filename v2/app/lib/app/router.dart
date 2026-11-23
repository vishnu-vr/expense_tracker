import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../core/data/session.dart';
import '../core/domain/models.dart';
import '../features/admin/billing_screen.dart';
import '../features/ask/ask_history_screen.dart';
import '../features/ask/ask_screen.dart';
import '../features/auth/login_screen.dart';
import '../features/auth/onboarding_screen.dart';
import '../features/budgets/budgets_screen.dart';
import '../features/categories/categories_screen.dart';
import '../features/entry/entry_screen.dart';
import '../features/home/home_screen.dart';
import '../features/insights/insights_screen.dart';
import '../features/ledger/ledger_screen.dart';
import '../features/notifications/notifications_screen.dart';
import '../features/profile/profile_screen.dart';
import '../features/reports/report_screen.dart';
import '../features/reports/reports_screen.dart';
import '../features/shell/app_shell.dart';
import '../features/sms/review_screen.dart';
import '../features/sms/sms_screen.dart';
import '../features/tags/tags_screen.dart';
import 'providers.dart';

const _gates = {'/splash', '/login', '/onboarding'};

/// App routes. Signed-out users only see `/login`; signed-in users without a
/// household only see `/onboarding`.
final routerProvider = Provider<GoRouter>((ref) {
  final session = ValueNotifier<Session>(const Session.loading());
  ref.listen(
    sessionProvider,
    (_, next) => session.value = next.value ?? const Session.loading(),
    fireImmediately: true,
  );
  ref.onDispose(session.dispose);

  final router = GoRouter(
    initialLocation: '/home',
    refreshListenable: session,
    redirect: (context, state) {
      final s = session.value;
      final at = state.matchedLocation;
      final gate = s.loading
          ? '/splash'
          : !s.signedIn
              ? '/login'
              : (s.homeId == null ? '/onboarding' : null);
      if (gate != null) return at == gate ? null : gate;
      // Admin screens: the server checks the claim too; this just hides them.
      if (at.startsWith('/admin') && !(s.user?.isAdmin ?? false)) return '/home';
      return _gates.contains(at) ? '/home' : null;
    },
    routes: [
      GoRoute(
        path: '/splash',
        builder: (_, _) =>
            const Scaffold(body: Center(child: CircularProgressIndicator())),
      ),
      GoRoute(path: '/login', builder: (_, _) => const LoginScreen()),
      GoRoute(path: '/onboarding', builder: (_, _) => const OnboardingScreen()),
      StatefulShellRoute.indexedStack(
        builder: (context, state, shell) => AppShell(shell: shell),
        branches: [
          StatefulShellBranch(routes: [
            GoRoute(path: '/home', builder: (_, _) => const HomeScreen()),
          ]),
          StatefulShellBranch(routes: [
            GoRoute(path: '/ledger', builder: (_, _) => const LedgerScreen()),
          ]),
          StatefulShellBranch(routes: [
            GoRoute(path: '/budgets', builder: (_, _) => const BudgetsScreen()),
          ]),
          StatefulShellBranch(routes: [
            GoRoute(path: '/insights', builder: (_, _) => const InsightsScreen()),
          ]),
        ],
      ),
      GoRoute(
        path: '/add',
        builder: (_, state) {
          // Optional prefill, e.g. /add?type=income&amount=149&note=...
          // A detected SMS entry also passes category, source=sms and review=<id>.
          final q = state.uri.queryParameters;
          return EntryScreen(
            prefillType: q['type'] == 'income'
                ? TransactionType.income
                : (q['type'] == 'expense' ? TransactionType.expense : null),
            prefillAmount: double.tryParse(q['amount'] ?? ''),
            prefillNote: q['note'],
            prefillDate: DateTime.tryParse(q['date'] ?? ''),
            prefillCategoryId: q['category'],
            prefillSource: q['source'] == 'sms' ? 'sms' : null,
            reviewId: q['review'],
          );
        },
      ),
      GoRoute(
        path: '/edit/:id',
        builder: (_, state) => EntryScreen(transactionId: state.pathParameters['id']),
      ),
      GoRoute(path: '/profile', builder: (_, _) => const ProfileScreen()),
      GoRoute(path: '/notifications', builder: (_, _) => const NotificationsScreen()),
      GoRoute(path: '/categories', builder: (_, _) => const CategoriesScreen()),
      // Budgets opened from Profile, pushed on top rather than switching tab.
      GoRoute(path: '/budgets-manage', builder: (_, _) => const BudgetsScreen()),
      GoRoute(path: '/tags', builder: (_, _) => const TagsScreen()),
      GoRoute(
        path: '/tags/:id',
        builder: (_, state) => TagDetailScreen(tagId: state.pathParameters['id']!),
      ),
      // Optional ?thread=<id> opens a past conversation to continue it.
      GoRoute(
        path: '/ask',
        builder: (_, state) => AskScreen(
          initialQuestion: state.extra as String?,
          threadId: state.uri.queryParameters['thread'],
        ),
      ),
      GoRoute(path: '/ask/history', builder: (_, _) => const AskHistoryScreen()),
      // Expense reports (D-033); a monthly report's push opens /reports/monthly_YYYY-MM.
      GoRoute(path: '/reports', builder: (_, _) => const ReportsScreen()),
      GoRoute(
        path: '/reports/:id',
        builder: (_, state) => ReportScreen(reportId: state.pathParameters['id']!),
      ),
      GoRoute(path: '/sms', builder: (_, _) => const SmsScreen()),
      GoRoute(path: '/sms/review', builder: (_, _) => const ReviewScreen()),
      GoRoute(path: '/admin/billing', builder: (_, _) => const BillingScreen()),
    ],
  );
  ref.onDispose(router.dispose);
  return router;
});
