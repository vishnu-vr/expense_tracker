import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/providers.dart';
import '../../core/domain/budget_alert.dart';
import '../../core/domain/models.dart';
import '../../core/format/money.dart';
import '../../core/theme/ledger_theme.dart';
import '../../core/widgets/category_icon.dart';
import '../../core/widgets/common.dart';

class BudgetsScreen extends ConsumerStatefulWidget {
  const BudgetsScreen({super.key});

  @override
  ConsumerState<BudgetsScreen> createState() => _BudgetsScreenState();
}

class _BudgetsScreenState extends ConsumerState<BudgetsScreen> {
  DateTime? _month;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final money = ref.watch(moneyProvider);
    final now = ref.watch(nowProvider);
    final month = _month ?? DateTime(now.year, now.month);
    final txs = ref.watch(transactionsProvider).value ?? const <Transaction>[];
    final categories = ref.watch(categoryByIdProvider);
    final budgets = ref.watch(budgetsProvider).value;

    final rows = <({Category category, double budget, double spent})>[
      for (final b in budgets ?? const <CategoryBudget>[])
        if (b.amount > 0 && categories[b.categoryId] != null)
          (
            category: categories[b.categoryId]!,
            budget: b.amount,
            spent: spentForCategoryInMonth(txs, b.categoryId, month.year, month.month),
          ),
    ]..sort((a, b) {
        int rank(double spent, double budget) =>
            spent >= budget ? 0 : (spent >= budget * 0.9 ? 1 : 2);
        final r = rank(a.spent, a.budget).compareTo(rank(b.spent, b.budget));
        return r != 0 ? r : a.category.name.compareTo(b.category.name);
      });

    final budgeted = {for (final r in rows) r.category.id};
    final unbudgeted = ref
        .watch(categoriesProvider)
        .where((c) => c.type == TransactionType.expense && !budgeted.contains(c.id))
        .toList();
    final totalBudget = rows.fold(0.0, (s, r) => s + r.budget);
    final totalSpent = rows.fold(0.0, (s, r) => s + r.spent);

    void add() => showBudgetSheet(context, choices: unbudgeted);

    return Scaffold(
      appBar: AppBar(
        titleSpacing: Navigator.canPop(context) ? 4 : 24,
        title: const Text('Budgets'),
        actions: [
          if (unbudgeted.isNotEmpty && budgets != null)
            TextButton.icon(
              onPressed: add,
              icon: const Icon(Icons.add, size: 18),
              label: const Text('Add'),
            ),
          const SizedBox(width: 12),
        ],
      ),
      body: budgets == null
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.fromLTRB(24, 8, 24, 24),
              children: [
                PeriodNav(
                  label: monthYear(month),
                  onPrevious: () =>
                      setState(() => _month = DateTime(month.year, month.month - 1)),
                  onNext: () =>
                      setState(() => _month = DateTime(month.year, month.month + 1)),
                ),
                if (rows.isEmpty)
                  EmptyState(
                    'No budgets yet. Set a monthly cap for a category and track spending against it.',
                    action: 'Add a budget',
                    onAction: add,
                  )
                else ...[
                  Container(
                    padding: const EdgeInsets.only(bottom: 16),
                    decoration:
                        BoxDecoration(border: Border(bottom: BorderSide(color: p.ink))),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text('SPENT OF BUDGET', style: LedgerText.eyebrow(p.muted)),
                      const SizedBox(height: 4),
                      FittedBox(
                        fit: BoxFit.scaleDown,
                        alignment: Alignment.centerLeft,
                        child: Text('${money(totalSpent)} / ${money(totalBudget)}',
                            style: LedgerText.display(size: 28, letterSpacing: -0.5)),
                      ),
                      const SizedBox(height: 4),
                      Text('The same cap applies every month.',
                          style: LedgerText.body(size: 13, color: p.muted)),
                    ]),
                  ),
                  for (final r in rows)
                    _BudgetRow(
                      category: r.category,
                      budget: r.budget,
                      spent: r.spent,
                      money: money,
                      first: r == rows.first,
                    ),
                ],
              ],
            ),
    );
  }
}

class _BudgetRow extends StatelessWidget {
  const _BudgetRow({
    required this.category,
    required this.budget,
    required this.spent,
    required this.money,
    required this.first,
  });

  final Category category;
  final double budget;
  final double spent;
  final Money money;
  final bool first;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final pct = spent / budget * 100;
    final color = pct >= 100 ? p.danger : (pct >= 90 ? p.warning : p.accent);
    return InkWell(
      onTap: () => showBudgetSheet(context, category: category, current: budget),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 14),
        decoration: BoxDecoration(
          border: first ? null : Border(top: BorderSide(color: p.line)),
        ),
        child: Column(children: [
          Row(children: [
            CategoryIcon(category: category, size: 36),
            const SizedBox(width: 12),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(category.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: LedgerText.body(weight: 500)),
                const SizedBox(height: 2),
                Text('${money(spent)} of ${money(budget)}',
                    style: LedgerText.body(size: 12, color: p.muted, tabular: true)),
              ]),
            ),
            Text('${pct.round()}%',
                style: LedgerText.display(size: 16, color: pct >= 90 ? color : null)),
          ]),
          const SizedBox(height: 10),
          ProgressBar(fraction: spent / budget, height: 6, color: color),
        ]),
      ),
    );
  }
}

/// Set a budget. With [category] it edits (and can remove) that budget;
/// otherwise the user first picks one of [choices].
Future<void> showBudgetSheet(
  BuildContext context, {
  Category? category,
  double? current,
  List<Category> choices = const [],
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    builder: (_) => _BudgetSheet(category: category, current: current, choices: choices),
  );
}

class _BudgetSheet extends ConsumerStatefulWidget {
  const _BudgetSheet({this.category, this.current, required this.choices});

  final Category? category;
  final double? current;
  final List<Category> choices;

  @override
  ConsumerState<_BudgetSheet> createState() => _BudgetSheetState();
}

class _BudgetSheetState extends ConsumerState<_BudgetSheet> {
  late Category? _category = widget.category;
  late final _amount = TextEditingController(
      text: widget.current == null ? '' : widget.current!.round().toString());
  String? _error;
  var _saving = false;

  @override
  void dispose() {
    _amount.dispose();
    super.dispose();
  }

  Future<void> _apply(double amount) async {
    setState(() => _saving = true);
    try {
      await ref.read(householdRepositoryProvider).setBudget(_category!.id, amount);
      if (!mounted) return;
      Navigator.pop(context);
      showToast(context, amount > 0 ? 'Budget saved' : 'Budget removed');
    } catch (_) {
      if (mounted) {
        setState(() {
          _saving = false;
          _error = 'Could not save. Try again.';
        });
      }
    }
  }

  void _save() {
    final amount = double.tryParse(_amount.text.trim());
    if (_category == null) return setState(() => _error = 'Pick a category');
    if (amount == null || amount < 1) {
      return setState(() => _error = 'Enter an amount of ₹1 or more');
    }
    _apply(amount);
  }

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final editing = widget.category != null;
    return Padding(
      padding: EdgeInsets.fromLTRB(24, 0, 24, 24 + MediaQuery.viewInsetsOf(context).bottom),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(editing ? '${widget.category!.name} budget' : 'Add a budget',
              style: LedgerText.display(size: 18)),
          const SizedBox(height: 16),
          if (!editing) ...[
            Text('CATEGORY', style: LedgerText.eyebrow(p.muted)),
            ConstrainedBox(
              constraints: const BoxConstraints(maxHeight: 180),
              child: SingleChildScrollView(
                child: Wrap(spacing: 8, children: [
                  for (final c in widget.choices)
                    Pill(c.name,
                        dot: colorFromHex(c.color),
                        selected: c.id == _category?.id,
                        onTap: () => setState(() {
                              _category = c;
                              _error = null;
                            })),
                ]),
              ),
            ),
            const SizedBox(height: 12),
          ],
          TextField(
            controller: _amount,
            autofocus: editing,
            keyboardType: TextInputType.number,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
            decoration: InputDecoration(
              labelText: 'Monthly budget',
              prefixText: '₹ ',
              errorText: _error,
            ),
            onSubmitted: (_) => _save(),
          ),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: _saving ? null : _save,
            child: Text(_saving ? 'Saving…' : 'Save budget'),
          ),
          if (editing) ...[
            const SizedBox(height: 8),
            TextButton(
              onPressed: _saving ? null : () => _apply(0),
              style: TextButton.styleFrom(foregroundColor: p.danger),
              child: const Text('Remove budget'),
            ),
          ],
        ],
      ),
    );
  }
}
