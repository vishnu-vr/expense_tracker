import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/providers.dart';
import '../../core/domain/budget_alert.dart';
import '../../core/domain/models.dart';
import '../../core/domain/transaction_search.dart';
import '../../core/format/money.dart';
import '../../core/theme/ledger_theme.dart';
import '../../core/widgets/category_icon.dart';
import '../../core/widgets/common.dart';

enum LedgerMode { day, month }

class LedgerPeriod {
  const LedgerPeriod(this.mode, this.anchor);

  final LedgerMode mode;
  final DateTime anchor;

  bool contains(DateTime d) =>
      d.year == anchor.year &&
      d.month == anchor.month &&
      (mode == LedgerMode.month || d.day == anchor.day);

  LedgerPeriod shift(int by) => LedgerPeriod(
        mode,
        mode == LedgerMode.month
            ? DateTime(anchor.year, anchor.month + by, 1)
            : DateTime(anchor.year, anchor.month, anchor.day + by),
      );

  String get label => mode == LedgerMode.month
      ? monthYear(anchor)
      : '${shortDate(anchor)}, ${weekdayName(anchor)}';
}

class LedgerPeriodNotifier extends Notifier<LedgerPeriod> {
  @override
  LedgerPeriod build() => LedgerPeriod(LedgerMode.month, ref.read(nowProvider));

  void set(LedgerPeriod p) => state = p;
}

final ledgerPeriodProvider =
    NotifierProvider<LedgerPeriodNotifier, LedgerPeriod>(LedgerPeriodNotifier.new);

class BudgetAlertRow {
  const BudgetAlertRow(this.category, this.spent, this.budget);

  final Category category;
  final double spent;
  final double budget;

  bool get over => spent > budget;
}

/// Budgeted categories at 90% or more of their cap in [month], over-budget first.
List<BudgetAlertRow> monthlyBudgetAlerts(
  List<Transaction> txs,
  List<CategoryBudget> budgets,
  Map<String, Category> categories,
  DateTime month,
) {
  final rows = <BudgetAlertRow>[];
  for (final b in budgets) {
    final cat = categories[b.categoryId];
    if (cat == null || b.amount <= 0) continue;
    final spent = spentForCategoryInMonth(txs, b.categoryId, month.year, month.month);
    if (spent >= b.amount * 0.9) rows.add(BudgetAlertRow(cat, spent, b.amount));
  }
  rows.sort((a, b) {
    if (a.over != b.over) return a.over ? -1 : 1;
    return (b.spent / b.budget).compareTo(a.spent / a.budget);
  });
  return rows;
}

class LedgerScreen extends ConsumerStatefulWidget {
  const LedgerScreen({super.key});

  @override
  ConsumerState<LedgerScreen> createState() => _LedgerScreenState();
}

class _LedgerScreenState extends ConsumerState<LedgerScreen> {
  final _search = TextEditingController();
  var _alertsOpen = false;

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _pickDate(LedgerPeriod period) async {
    final picked = await showDatePicker(
      context: context,
      initialDate: period.anchor,
      firstDate: DateTime(2000),
      lastDate: DateTime(2100),
      helpText: period.mode == LedgerMode.month ? 'Pick any day in the month' : null,
    );
    if (picked != null) {
      ref.read(ledgerPeriodProvider.notifier).set(LedgerPeriod(period.mode, picked));
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final money = ref.watch(moneyProvider);
    final period = ref.watch(ledgerPeriodProvider);
    final all = ref.watch(transactionsProvider).value;
    final categories = ref.watch(categoryByIdProvider);
    final tags = ref.watch(tagByIdProvider);
    final me = ref.watch(householdRepositoryProvider).currentUserId;
    final setPeriod = ref.read(ledgerPeriodProvider.notifier).set;

    final inPeriod = (all ?? const <Transaction>[])
        .where((t) => period.contains(t.date))
        .toList()
      ..sort((a, b) => b.date.compareTo(a.date));
    var income = 0.0, expense = 0.0;
    for (final t in inPeriod) {
      t.isIncome ? income += t.amount : expense += t.amount;
    }

    final query = _search.text.trim();
    final shown = query.isEmpty
        ? inPeriod
        : inPeriod
            .where((t) => transactionMatchesQuery(
                  t,
                  query,
                  categoryName: categories[t.categoryId]?.name,
                  tagNames: [for (final id in t.tagIds) tags[id]?.name ?? ''],
                ))
            .toList();

    final alerts = period.mode == LedgerMode.month && all != null
        ? monthlyBudgetAlerts(
            all, ref.watch(budgetsProvider).value ?? const [], categories, period.anchor)
        : const <BudgetAlertRow>[];

    // Group by calendar day, newest first.
    final groups = <DateTime, List<Transaction>>{};
    for (final t in shown) {
      groups.putIfAbsent(DateTime(t.date.year, t.date.month, t.date.day), () => []).add(t);
    }

    return Scaffold(
      appBar: AppBar(
        titleSpacing: 24,
        title: const Text('Ledger'),
        actions: [
          IconButton(
            tooltip: 'Profile and settings',
            onPressed: () => context.push('/profile'),
            icon: const Icon(Icons.person_outline),
          ),
          const SizedBox(width: 12),
        ],
      ),
      body: CustomScrollView(
        keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
        slivers: [
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(24, 12, 24, 0),
            sliver: SliverList.list(children: [
              Segmented<LedgerMode>(
                options: const {LedgerMode.day: 'Day', LedgerMode.month: 'Month'},
                selected: period.mode,
                onChanged: (m) => setPeriod(LedgerPeriod(
                    m, m == LedgerMode.day ? ref.read(nowProvider) : period.anchor)),
              ),
              const SizedBox(height: 4),
              PeriodNav(
                label: period.label,
                onPrevious: () => setPeriod(period.shift(-1)),
                onNext: () => setPeriod(period.shift(1)),
                onTapLabel: () => _pickDate(period),
              ),
              Container(
                padding: const EdgeInsets.only(bottom: 16),
                decoration: BoxDecoration(border: Border(bottom: BorderSide(color: p.ink))),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('NET FOR PERIOD', style: LedgerText.eyebrow(p.muted)),
                    const SizedBox(height: 4),
                    FittedBox(
                      fit: BoxFit.scaleDown,
                      alignment: Alignment.centerLeft,
                      child: Text(money.signed(income - expense),
                          style: LedgerText.display(size: 34, height: 1.1, letterSpacing: -0.7)),
                    ),
                    const SizedBox(height: 6),
                    Wrap(spacing: 24, runSpacing: 4, children: [
                      Text('In ${money(income)}', style: LedgerText.body(size: 14, tabular: true)),
                      Text('Out ${money(expense)}', style: LedgerText.body(size: 14, tabular: true)),
                    ]),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              TextField(
                controller: _search,
                onChanged: (_) => setState(() {}),
                textInputAction: TextInputAction.search,
                decoration: InputDecoration(
                  hintText: 'Search category, note, tag',
                  prefixIcon: const Icon(Icons.search, size: 20),
                  suffixIcon: query.isEmpty
                      ? null
                      : IconButton(
                          tooltip: 'Clear search',
                          onPressed: () => setState(_search.clear),
                          icon: const Icon(Icons.close, size: 18),
                        ),
                ),
              ),
              if (query.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(
                    '${shown.length} ${shown.length == 1 ? 'match' : 'matches'} in this period',
                    style: LedgerText.body(size: 12, color: p.muted),
                  ),
                ),
              if (alerts.isNotEmpty) ...[
                const SizedBox(height: 16),
                _BudgetAlerts(
                  alerts: alerts,
                  open: _alertsOpen,
                  onToggle: () => setState(() => _alertsOpen = !_alertsOpen),
                ),
              ],
              const SizedBox(height: 8),
            ]),
          ),
          if (all == null)
            const SliverFillRemaining(
              hasScrollBody: false,
              child: Center(child: CircularProgressIndicator()),
            )
          else if (shown.isEmpty)
            SliverPadding(
              padding: const EdgeInsets.symmetric(horizontal: 24),
              sliver: SliverToBoxAdapter(
                child: EmptyState(query.isEmpty
                    ? 'No entries in this period.'
                    : 'No entries match "$query".'),
              ),
            )
          else
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(24, 0, 24, 24),
              sliver: SliverList.list(children: [
                for (final g in groups.entries) ...[
                  _DayHeader(day: g.key, txs: g.value),
                  for (final t in g.value)
                    _LedgerRow(
                      tx: t,
                      category: categories[t.categoryId],
                      tags: [for (final id in t.tagIds) if (tags[id] != null) tags[id]!],
                      mine: t.userId == null || t.userId == me,
                    ),
                ],
              ]),
            ),
        ],
      ),
    );
  }
}

class _BudgetAlerts extends ConsumerWidget {
  const _BudgetAlerts({required this.alerts, required this.open, required this.onToggle});

  final List<BudgetAlertRow> alerts;
  final bool open;
  final VoidCallback onToggle;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final p = context.palette;
    final money = ref.watch(moneyProvider);
    final over = alerts.where((a) => a.over).length;
    final summary = over > 0
        ? '$over ${over == 1 ? 'category is' : 'categories are'} over budget this month'
        : '${alerts.length} ${alerts.length == 1 ? 'category is' : 'categories are'} near the budget limit';
    return LedgerCard(
      padding: EdgeInsets.zero,
      child: Column(
        children: [
          InkWell(
            onTap: onToggle,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
              child: Row(children: [
                Icon(Icons.error_outline, size: 20, color: over > 0 ? p.danger : p.warning),
                const SizedBox(width: 10),
                Expanded(child: Text(summary, style: LedgerText.body(size: 14, weight: 500))),
                Icon(open ? Icons.expand_less : Icons.expand_more, color: p.muted),
              ]),
            ),
          ),
          if (open)
            Padding(
              padding: const EdgeInsets.fromLTRB(14, 0, 14, 8),
              child: Column(children: [
                for (final a in alerts)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: Column(children: [
                      Row(children: [
                        Expanded(child: Text(a.category.name, style: LedgerText.body(size: 14))),
                        Text(a.over ? 'Over' : 'Near limit',
                            style: LedgerText.body(
                                size: 12, weight: 600, color: a.over ? p.danger : p.warning)),
                      ]),
                      const SizedBox(height: 6),
                      ProgressBar(
                        fraction: a.spent / a.budget,
                        height: 6,
                        color: a.over ? p.danger : p.warning,
                      ),
                      const SizedBox(height: 4),
                      Align(
                        alignment: Alignment.centerLeft,
                        child: Text('${money(a.spent)} of ${money(a.budget)}',
                            style: LedgerText.body(size: 12, color: p.muted, tabular: true)),
                      ),
                    ]),
                  ),
                Align(
                  alignment: Alignment.centerLeft,
                  child: TextButton(
                    onPressed: () => context.go('/budgets'),
                    child: const Text('View budgets'),
                  ),
                ),
              ]),
            ),
        ],
      ),
    );
  }
}

class _DayHeader extends ConsumerWidget {
  const _DayHeader({required this.day, required this.txs});

  final DateTime day;
  final List<Transaction> txs;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final p = context.palette;
    final net = txs.fold(0.0, (s, t) => s + (t.isIncome ? t.amount : -t.amount));
    return Padding(
      padding: const EdgeInsets.only(top: 20, bottom: 6),
      child: Row(children: [
        Expanded(
          child: Text('${shortDate(day, ref.watch(nowProvider))}, ${weekdayName(day)}'.toUpperCase(),
              style: LedgerText.eyebrow(p.muted)),
        ),
        Text('Net ${ref.watch(moneyProvider).signed(net)}',
            style: LedgerText.body(size: 12, color: p.muted, tabular: true)),
      ]),
    );
  }
}

class _LedgerRow extends ConsumerWidget {
  const _LedgerRow({required this.tx, required this.category, required this.tags, required this.mine});

  final Transaction tx;
  final Category? category;
  final List<Tag> tags;
  final bool mine;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final p = context.palette;
    final money = ref.watch(moneyProvider);
    final note = tx.note?.trim() ?? '';
    return ListRow(
      onTap: () => context.push('/edit/${tx.id}'),
      leading: CategoryIcon(category: category),
      title: category?.name ?? 'Uncategorized',
      subtitle: note.isEmpty ? timeOfDay(tx.date) : '${timeOfDay(tx.date)} · $note',
      below: tags.isEmpty && !tx.fromSms
          ? null
          : Wrap(spacing: 6, runSpacing: 4, children: [
              // Added from a bank message (D-029).
              if (tx.fromSms) Pill('SMS', color: p.muted),
              for (final t in tags) Pill(t.name, dot: colorFromHex(t.color)),
            ]),
      trailing: Row(mainAxisSize: MainAxisSize.min, children: [
        if (!mine)
          Padding(
            padding: const EdgeInsets.only(right: 6),
            child: Icon(Icons.lock_outline, size: 14, color: p.muted, semanticLabel: 'Added by someone else'),
          ),
        Text(
          money.signed(tx.isIncome ? tx.amount : -tx.amount),
          style: LedgerText.body(
            weight: tx.isIncome ? 600 : 400,
            color: tx.isIncome ? p.positive : null,
            tabular: true,
          ),
        ),
      ]),
    );
  }
}
