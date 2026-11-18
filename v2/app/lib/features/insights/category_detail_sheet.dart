import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/providers.dart';
import '../../core/domain/models.dart';
import '../../core/domain/note_grouping.dart';
import '../../core/format/money.dart';
import '../../core/theme/ledger_theme.dart';
import '../../core/widgets/category_icon.dart';
import '../../core/widgets/common.dart';

/// One category's entries for the period shown on the Insights breakdown.
Future<void> showCategoryDetailSheet(
  BuildContext context, {
  required Category? category,
  required List<Transaction> transactions,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    builder: (_) => DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.7,
      maxChildSize: 0.92,
      builder: (context, controller) => _CategoryDetail(
        category: category,
        transactions: transactions,
        controller: controller,
      ),
    ),
  );
}

class _CategoryDetail extends ConsumerWidget {
  const _CategoryDetail({
    required this.category,
    required this.transactions,
    required this.controller,
  });

  final Category? category;
  final List<Transaction> transactions;
  final ScrollController controller;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final p = context.palette;
    final money = ref.watch(moneyProvider);
    final now = ref.watch(nowProvider);
    final total = transactions.fold(0.0, (s, t) => s + t.amount);
    final buckets = groupTransactionsByNoteRules(transactions);
    return ListView(
      controller: controller,
      padding: const EdgeInsets.fromLTRB(24, 0, 24, 24),
      children: [
        Text(category?.name ?? 'Uncategorized', style: LedgerText.display(size: 18)),
        const SizedBox(height: 2),
        Text(
          '${transactions.length} ${transactions.length == 1 ? 'entry' : 'entries'} · ${money(total)}',
          style: LedgerText.body(size: 13, color: p.muted, tabular: true),
        ),
        if (buckets.length >= 2) ...[
          const SizedBox(height: 16),
          Text('WHAT IT WENT ON', style: LedgerText.eyebrow(p.muted)),
          const SizedBox(height: 8),
          for (final b in buckets)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Column(children: [
                Row(children: [
                  Expanded(
                    child: Text('${b.displayName} · ${b.count}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: LedgerText.body(size: 14)),
                  ),
                  Text('${money(b.total)} · ${b.percentage.round()}%',
                      style: LedgerText.body(size: 14, tabular: true)),
                ]),
                const SizedBox(height: 5),
                ProgressBar(
                  fraction: b.percentage / 100,
                  height: 4,
                  color: colorFromHex(b.color),
                ),
              ]),
            ),
          const SizedBox(height: 4),
          Text('ENTRIES', style: LedgerText.eyebrow(p.muted)),
        ],
        const SizedBox(height: 8),
        for (final t in transactions)
          ListRow(
            onTap: () {
              Navigator.pop(context);
              context.push('/edit/${t.id}');
            },
            title: (t.note ?? '').trim().isEmpty ? 'No note' : t.note!.trim(),
            subtitle: '${shortDate(t.date, now)} · ${timeOfDay(t.date)}',
            trailing: Text(money(t.amount), style: LedgerText.body(tabular: true)),
          ),
      ],
    );
  }
}
