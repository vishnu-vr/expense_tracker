import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/providers.dart';
import '../../core/domain/home_insights.dart';
import '../../core/domain/insights_math.dart';
import '../../core/domain/models.dart';
import '../../core/format/money.dart';
import '../../core/theme/ledger_theme.dart';
import '../../core/widgets/burn_sparkline_view.dart';
import '../../core/widgets/common.dart';

class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final p = context.palette;
    final insights = ref.watch(homeInsightsProvider);
    final home = ref.watch(homeProvider).value;
    final now = ref.watch(nowProvider);
    final money = ref.watch(moneyProvider);

    if (insights == null) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }

    final cards = ref.watch(insightCardsProvider).value ?? const <InsightCard>[];
    final toReview = ref.watch(smsReviewQueueProvider).value?.length ?? 0;
    final headline = _headline(insights, money);
    final others = insights.smartInsights
        .where((c) => c.narrative != headline)
        .toList();

    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: RefreshIndicator(
          onRefresh: () async => ref.invalidate(nowProvider),
          child: ListView(
            padding: const EdgeInsets.fromLTRB(24, 12, 24, 24),
            children: [
              _Header(homeName: home?.name ?? 'Your household', month: monthName(now.month)),
              if (toReview > 0) ...[
                const SizedBox(height: 12),
                // Bank messages SMS auto-add was not sure about (D-029).
                LedgerCard(
                  onTap: () => context.push('/sms/review'),
                  child: Row(children: [
                    Icon(Icons.sms_outlined, size: 18, color: p.accent),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        toReview == 1
                            ? '1 detected entry to review'
                            : '$toReview detected entries to review',
                        style: LedgerText.body(size: 14, weight: 500),
                      ),
                    ),
                    Icon(Icons.chevron_right, color: p.muted),
                  ]),
                ),
              ],
              const SizedBox(height: 16),
              _NetSummary(health: insights.financialHealth, money: money),
              const SizedBox(height: 20),
              IntrinsicHeight(
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Expanded(child: _BurnCard(insights: insights, money: money)),
                    const SizedBox(width: 12),
                    Expanded(
                      child: _BudgetCard(
                        pacing: insights.budgetPacing,
                        onTap: () => context.go('/budgets'),
                      ),
                    ),
                  ],
                ),
              ),
              if (headline != null) ...[
                const SizedBox(height: 20),
                _InsightCard(
                  text: headline,
                  onAsk: () => context.push('/ask', extra: 'Tell me more: $headline'),
                ),
              ],
              if (cards.isNotEmpty) ...[
                const SizedBox(height: 24),
                const SectionTitle('For you'),
                for (final c in cards.take(4))
                  ListRow(
                    title: money.text(c.title),
                    below: Text(money.text(c.body),
                        style: LedgerText.body(size: 13, color: p.muted, height: 1.4)),
                    onTap: () => context.push('/ask', extra: '${c.title}. ${c.body} Tell me more.'),
                    trailing: IconButton(
                      tooltip: 'Dismiss',
                      onPressed: () =>
                          ref.read(householdRepositoryProvider).dismissInsight(c.id),
                      icon: Icon(Icons.close, size: 18, color: p.muted),
                    ),
                  ),
              ],
              if (others.isNotEmpty) ...[
                const SizedBox(height: 24),
                const SectionTitle('This month'),
                for (final c in others)
                  ListRow(
                    title: c.title,
                    below: Text(c.narrative,
                        style: LedgerText.body(size: 13, color: p.muted, height: 1.4)),
                  ),
              ],
              if (insights.recurringExpenses.isNotEmpty) ...[
                const SizedBox(height: 24),
                const SectionTitle('Recurring bills'),
                for (final r in insights.recurringExpenses)
                  ListRow(
                    title: r.label,
                    subtitle:
                        '${r.categoryName} · ${r.cadenceLabel} · last ${shortDate(r.lastPaidDate, now)}',
                    trailing: Column(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(money(r.averageAmount), style: LedgerText.body(tabular: true)),
                        Text('average', style: LedgerText.body(size: 11, color: p.muted)),
                      ],
                    ),
                  ),
              ],
              const SizedBox(height: 24),
              SectionTitle('Recent', action: 'See all', onAction: () => context.go('/ledger')),
              if (insights.recentTransactions.isEmpty)
                const EmptyState('No entries yet. Tap + to add your first one.')
              else
                for (final t in insights.recentTransactions)
                  _RecentRow(tx: t, now: now, money: money),
            ],
          ),
        ),
      ),
    );
  }

  /// The one thing most worth knowing right now: a budget problem if there
  /// is one, otherwise the first smart insight.
  String? _headline(HomeInsights i, Money money) {
    final b = i.budgetHeadline;
    if (b == null) return i.smartInsights.firstOrNull?.narrative;
    if (b.overBy > 0) {
      return '${b.categoryName} is over its ${money(b.budget)} budget by ${money(b.overBy)}.';
    }
    return '${b.categoryName} is on course to cross its ${money(b.budget)} budget around the ${_ordinal(b.crossDay!)}.';
  }

  static String _ordinal(int n) {
    if (n % 100 >= 11 && n % 100 <= 13) return '${n}th';
    return switch (n % 10) { 1 => '${n}st', 2 => '${n}nd', 3 => '${n}rd', _ => '${n}th' };
  }
}

class _Header extends ConsumerWidget {
  const _Header({required this.homeName, required this.month});

  final String homeName;
  final String month;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final p = context.palette;
    final hidden = ref.watch(hideAmountsProvider);
    return Row(
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(homeName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: LedgerText.body(size: 13, color: p.muted)),
              const SizedBox(height: 2),
              Text(month, style: LedgerText.display()),
            ],
          ),
        ),
        IconButton(
          tooltip: hidden ? 'Show amounts' : 'Hide amounts',
          onPressed: ref.read(hideAmountsProvider.notifier).toggle,
          icon: Icon(hidden ? Icons.visibility_off_outlined : Icons.visibility_outlined, size: 22),
        ),
        IconButton(
          tooltip: 'Notifications',
          onPressed: () => context.push('/notifications'),
          icon: Badge(
            isLabelVisible: ref.watch(unreadNotificationsProvider).isNotEmpty,
            backgroundColor: p.accent,
            smallSize: 8,
            child: const Icon(Icons.notifications_none, size: 22),
          ),
        ),
        IconButton(
          tooltip: 'Profile and settings',
          onPressed: () => context.push('/profile'),
          icon: const Icon(Icons.person_outline, size: 22),
        ),
      ],
    );
  }
}

class _NetSummary extends StatelessWidget {
  const _NetSummary({required this.health, required this.money});

  final FinancialHealth health;
  final Money money;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final delta = health.periodDeltaPct;
    return Container(
      padding: const EdgeInsets.only(bottom: 20),
      decoration: BoxDecoration(border: Border(bottom: BorderSide(color: p.ink))),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('NET THIS MONTH', style: LedgerText.eyebrow(p.muted)),
          const SizedBox(height: 6),
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerLeft,
            child: Text(
              money.signed(health.netCashFlow),
              style: LedgerText.display(size: 52, height: 1, letterSpacing: -1.56),
            ),
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 24,
            runSpacing: 4,
            children: [
              _InOut(label: 'In', value: money(health.income)),
              _InOut(label: 'Out', value: money(health.expense)),
              if (delta != null && !money.hidden)
                Text(
                  '${delta >= 0 ? '+' : '−'}${delta.abs().round()}% vs last month',
                  style: LedgerText.body(size: 14, color: p.muted, tabular: true),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _InOut extends StatelessWidget {
  const _InOut({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Text.rich(
      TextSpan(
        text: '$label ',
        style: LedgerText.body(size: 14, tabular: true),
        children: [
          TextSpan(text: value, style: LedgerText.body(size: 14, weight: 600, tabular: true)),
        ],
      ),
    );
  }
}

class _BurnCard extends StatelessWidget {
  const _BurnCard({required this.insights, required this.money});

  final HomeInsights insights;
  final Money money;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final burn = insights.burnRate;
    return LedgerCard(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('Daily burn', style: LedgerText.body(size: 12, color: p.muted)),
        const SizedBox(height: 8),
        Text(money(burn.dailyBurnRate.round()), style: LedgerText.display(size: 22)),
        const SizedBox(height: 8),
        BurnSparklineView(
          dailySpend: insights.dailySpendThisMonth,
          totalDays: burn.totalDays,
          monthEndForecast: burn.monthEndForecast,
        ),
        const SizedBox(height: 8),
        Text(
          burn.spentMtd <= 0
              ? 'No spending yet this month'
              : 'On course for ${money(burn.monthEndForecast.round())}',
          style: LedgerText.body(size: 12, color: p.muted),
        ),
      ]),
    );
  }
}

class _BudgetCard extends StatelessWidget {
  const _BudgetCard({required this.pacing, required this.onTap});

  final BudgetPacingInsight pacing;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final hasBudget = pacing.totalBudget > 0;
    final statusColor = switch (pacing.status) {
      PacingStatus.warning => p.danger,
      PacingStatus.ahead => p.warning,
      PacingStatus.onTrack => p.accent,
    };
    return LedgerCard(
      onTap: onTap,
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('Budget used', style: LedgerText.body(size: 12, color: p.muted)),
        const SizedBox(height: 8),
        Text(hasBudget ? '${pacing.budgetUsedPct.round()}%' : '—',
            style: LedgerText.display(size: 22)),
        const SizedBox(height: 8),
        SizedBox(
          height: 34,
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              ProgressBar(fraction: pacing.budgetUsedPct / 100, color: statusColor),
              const SizedBox(height: 6),
              ProgressBar(fraction: pacing.timePct / 100, height: 2, color: p.ink),
            ],
          ),
        ),
        const SizedBox(height: 8),
        Text(
          hasBudget ? '${pacing.timePct.round()}% of month gone' : 'Set budgets to track pacing',
          style: LedgerText.body(size: 12, color: p.muted),
        ),
      ]),
    );
  }
}

class _InsightCard extends StatelessWidget {
  const _InsightCard({required this.text, required this.onAsk});

  final String text;
  final VoidCallback onAsk;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
      decoration: BoxDecoration(color: p.accent, borderRadius: BorderRadius.circular(12)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('WORTH KNOWING', style: LedgerText.eyebrow(p.onAccentMuted)),
          const SizedBox(height: 10),
          Text(text,
              style: LedgerText.body(size: 16, weight: 500, height: 1.4, color: p.onAccent)),
          TextButton(
            onPressed: onAsk,
            style: TextButton.styleFrom(
              foregroundColor: p.onAccent,
              padding: EdgeInsets.zero,
              alignment: Alignment.centerLeft,
            ),
            child: Text(
              'Ask why',
              style: LedgerText.body(size: 14, weight: 600, color: p.onAccent).copyWith(
                decoration: TextDecoration.underline,
                decorationColor: p.onAccent,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _RecentRow extends ConsumerWidget {
  const _RecentRow({required this.tx, required this.now, required this.money});

  final Transaction tx;
  final DateTime now;
  final Money money;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final p = context.palette;
    final categoryName = ref.watch(categoryByIdProvider)[tx.categoryId]?.name ?? 'Uncategorized';
    final note = tx.note?.trim() ?? '';
    return ListRow(
      onTap: () => context.push('/edit/${tx.id}'),
      title: note.isEmpty ? categoryName : note,
      subtitle: '$categoryName · ${relativeDay(tx.date, now)}',
      trailing: Text(
        money.signed(tx.isIncome ? tx.amount : -tx.amount),
        style: LedgerText.body(
          weight: tx.isIncome ? 600 : 400,
          color: tx.isIncome ? p.positive : null,
          tabular: true,
        ),
      ),
    );
  }
}
