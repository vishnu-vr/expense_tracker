import 'package:flutter/material.dart' show ThemeMode;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../core/data/admin.dart';
import '../core/data/agent.dart';
import '../core/data/demo_repository.dart';
import '../core/data/firebase/push_service.dart';
import '../core/data/repositories.dart';
import '../core/data/session.dart';
import '../core/domain/default_categories.dart';
import '../core/domain/home_insights.dart';
import '../core/domain/models.dart';
import '../core/format/money.dart';

/// Current time. Overridden in tests; invalidated on pull-to-refresh/resume.
final nowProvider = Provider<DateTime>((ref) => DateTime.now());

/// Loaded in `main` before the app starts.
final sharedPreferencesProvider = Provider<SharedPreferences>(
  (ref) => throw UnimplementedError('sharedPreferencesProvider not overridden'),
);

class _BoolSetting extends Notifier<bool> {
  _BoolSetting(this.key);

  final String key;

  @override
  bool build() => ref.watch(sharedPreferencesProvider).getBool(key) ?? false;

  void set(bool value) {
    state = value;
    ref.read(sharedPreferencesProvider).setBool(key, value);
  }

  void toggle() => set(!state);
}

/// Privacy mode: mask every amount on screen.
final hideAmountsProvider =
    NotifierProvider<_BoolSetting, bool>(() => _BoolSetting('hideAmounts'));

final moneyProvider =
    Provider<Money>((ref) => Money(hidden: ref.watch(hideAmountsProvider)));

class ThemeModeSetting extends Notifier<ThemeMode> {
  static const _key = 'themeMode';

  @override
  ThemeMode build() {
    final name = ref.watch(sharedPreferencesProvider).getString(_key);
    return ThemeMode.values.where((m) => m.name == name).firstOrNull ??
        ThemeMode.system;
  }

  void set(ThemeMode mode) {
    state = mode;
    ref.read(sharedPreferencesProvider).setString(_key, mode.name);
  }
}

final themeModeProvider =
    NotifierProvider<ThemeModeSetting, ThemeMode>(ThemeModeSetting.new);

final sessionRepositoryProvider =
    Provider<SessionRepository>((ref) => DemoSessionRepository());

final sessionProvider = StreamProvider<Session>(
  (ref) => ref.watch(sessionRepositoryProvider).watch(),
);

/// Custom claim `admin: true` on the signed-in account.
final isAdminProvider = Provider<bool>(
  (ref) => ref.watch(sessionProvider).value?.user?.isAdmin ?? false,
);

final adminRepositoryProvider = Provider<AdminRepository>(
  (ref) => DemoAdminRepository(ref.read(nowProvider)),
);

/// Billing and usage for a month ("YYYY-MM"). Errors are shown with a Retry
/// button instead of being retried automatically.
final adminDashboardProvider = FutureProvider.autoDispose.family<AdminDashboard, String>(
  (ref, month) => ref.watch(adminRepositoryProvider).dashboard(month),
  retry: (_, _) => null,
);

final householdRepositoryProvider = Provider<HouseholdRepository>(
  (ref) => DemoHouseholdRepository(ref.read(nowProvider)),
);

final homeProvider = StreamProvider<Home?>(
  (ref) => ref.watch(householdRepositoryProvider).watchHome(),
);

final membersProvider = StreamProvider<List<Member>>(
  (ref) => ref.watch(householdRepositoryProvider).watchMembers(),
);

final transactionsProvider = StreamProvider<List<Transaction>>(
  (ref) => ref.watch(householdRepositoryProvider).watchTransactions(),
);

final customCategoriesProvider = StreamProvider<List<Category>>(
  (ref) => ref.watch(householdRepositoryProvider).watchCustomCategories(),
);

/// Built-in defaults followed by the household's custom categories.
final categoriesProvider = Provider<List<Category>>((ref) {
  final custom = ref.watch(customCategoriesProvider).value ?? const <Category>[];
  final customIds = {for (final c in custom) c.id};
  return [
    ...defaultCategories.where((c) => !customIds.contains(c.id)),
    ...custom,
  ];
});

final categoryByIdProvider = Provider<Map<String, Category>>(
  (ref) => {for (final c in ref.watch(categoriesProvider)) c.id: c},
);

final budgetsProvider = StreamProvider<List<CategoryBudget>>(
  (ref) => ref.watch(householdRepositoryProvider).watchBudgets(),
);

final tagsProvider = StreamProvider<List<Tag>>(
  (ref) => ref.watch(householdRepositoryProvider).watchTags(),
);

final tagByIdProvider = Provider<Map<String, Tag>>(
  (ref) => {for (final t in ref.watch(tagsProvider).value ?? const <Tag>[]) t.id: t},
);

/// Display name for a member id; never the raw id.
final memberNameProvider = Provider<String Function(String)>((ref) {
  final members = {
    for (final m in ref.watch(membersProvider).value ?? const <Member>[]) m.id: m,
  };
  return (id) {
    final m = members[id];
    if (m == null) return 'Member';
    if (m.name.trim().isNotEmpty) return m.name;
    return m.email?.split('@').first ?? 'Member';
  };
});

/// Null while the first transactions snapshot is loading.
final homeInsightsProvider = Provider<HomeInsights?>((ref) {
  final txs = ref.watch(transactionsProvider).value;
  if (txs == null) return null;
  final cats = ref.watch(categoryByIdProvider);
  return HomeInsights(
    transactions: txs,
    now: ref.watch(nowProvider),
    budgets: ref.watch(budgetsProvider).value ?? const [],
    memberIds: ref.watch(homeProvider).value?.memberIds ?? const [],
    categoryName: (id) => cats[id]?.name,
    memberName: ref.watch(memberNameProvider),
  );
});

final notificationsProvider = StreamProvider<List<HouseholdNotification>>(
  (ref) => ref.watch(householdRepositoryProvider).watchNotifications(),
);

/// Notifications from other members that the current user has not read.
final unreadNotificationsProvider = Provider<List<HouseholdNotification>>((ref) {
  final me = ref.watch(householdRepositoryProvider).currentUserId;
  return [
    for (final n in ref.watch(notificationsProvider).value ?? const <HouseholdNotification>[])
      if (n.createdBy != me && !n.readBy.contains(me)) n,
  ];
});

final agentRepositoryProvider = Provider<AgentRepository>((ref) {
  final cats = ref.watch(categoryByIdProvider);
  return DemoAgentRepository(
    ref.watch(householdRepositoryProvider),
    () => ref.read(transactionsProvider).value ?? const [],
    ref.watch(nowProvider),
    (id) => cats[id]?.name ?? 'Uncategorized',
  );
});

/// Null unless the app runs against a real Firebase project.
final pushServiceProvider = Provider<PushService?>((ref) => null);

final insightCardsProvider = StreamProvider<List<InsightCard>>(
  (ref) => ref.watch(householdRepositoryProvider).watchInsights(),
);
