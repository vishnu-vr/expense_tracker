import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/providers.dart';
import '../../core/domain/models.dart';
import '../../core/format/money.dart';
import '../../core/theme/ledger_theme.dart';
import '../../core/widgets/category_icon.dart';
import '../../core/widgets/common.dart';
import '../entry/tag_editor_sheet.dart';

class _TagDot extends StatelessWidget {
  const _TagDot(this.tag);

  final Tag tag;
  static const double size = 36;

  @override
  Widget build(BuildContext context) {
    return ExcludeSemantics(
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          color: colorFromHex(tag.color),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Icon(Icons.sell_outlined, size: size * 0.5, color: Colors.white),
      ),
    );
  }
}

class TagsScreen extends ConsumerWidget {
  const TagsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final p = context.palette;
    final money = ref.watch(moneyProvider);
    final tags = ref.watch(tagsProvider).value;
    final txs = ref.watch(transactionsProvider).value ?? const <Transaction>[];

    Future<void> delete(Tag t) async {
      final ok = await confirmDialog(
        context,
        title: 'Delete "${t.name}"?',
        message: 'Entries keep their amounts; only the tag is removed.',
        confirmLabel: 'Delete',
        destructive: true,
      );
      if (!ok) return;
      try {
        await ref.read(householdRepositoryProvider).deleteTag(t.id);
        if (context.mounted) showToast(context, 'Tag deleted');
      } catch (_) {
        if (context.mounted) showToast(context, 'Could not delete. Try again.');
      }
    }

    return Scaffold(
      appBar: AppBar(
        title: const Text('Tags'),
        actions: [
          TextButton.icon(
            onPressed: () => showTagEditorSheet(context, ref),
            icon: const Icon(Icons.add, size: 18),
            label: const Text('Add'),
          ),
          const SizedBox(width: 12),
        ],
      ),
      body: tags == null
          ? const Center(child: CircularProgressIndicator())
          : tags.isEmpty
              ? const Center(
                  child: Padding(
                    padding: EdgeInsets.all(24),
                    child: EmptyState('No tags yet. Create one to group a trip or an event.'),
                  ),
                )
              : ListView(
                  padding: const EdgeInsets.fromLTRB(24, 8, 24, 24),
                  children: [
                    for (final t in tags)
                      Builder(builder: (context) {
                        final tagged = txs.where((x) => x.tagIds.contains(t.id));
                        final spent = tagged
                            .where((x) => x.isExpense)
                            .fold(0.0, (s, x) => s + x.amount);
                        final n = tagged.length;
                        return ListRow(
                          topBorder: t != tags.first,
                          onTap: () => context.push('/tags/${t.id}'),
                          leading: _TagDot(t),
                          title: t.name,
                          subtitle: '$n ${n == 1 ? 'entry' : 'entries'}'
                              '${spent > 0 ? ' · ${money(spent)} spent' : ''}',
                          trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                            IconButton(
                              tooltip: 'Edit ${t.name}',
                              onPressed: () => showTagEditorSheet(context, ref, tag: t),
                              icon: const Icon(Icons.edit_outlined, size: 20),
                            ),
                            IconButton(
                              tooltip: 'Delete ${t.name}',
                              onPressed: () => delete(t),
                              icon: Icon(Icons.delete_outline, size: 20, color: p.danger),
                            ),
                          ]),
                        );
                      }),
                  ],
                ),
    );
  }
}

class TagDetailScreen extends ConsumerWidget {
  const TagDetailScreen({super.key, required this.tagId});

  final String tagId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final p = context.palette;
    final money = ref.watch(moneyProvider);
    final tag = ref.watch(tagByIdProvider)[tagId];
    if (tag == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Tag')),
        body: const Center(child: EmptyState('This tag was not found.')),
      );
    }
    final categories = ref.watch(categoryByIdProvider);
    final memberName = ref.watch(memberNameProvider);
    final now = ref.watch(nowProvider);
    final txs = (ref.watch(transactionsProvider).value ?? const <Transaction>[])
        .where((t) => t.tagIds.contains(tagId))
        .toList()
      ..sort((a, b) => b.date.compareTo(a.date));

    var income = 0.0, expense = 0.0;
    final byCategory = <String, double>{};
    final byPerson = <String, ({double expense, int count})>{};
    for (final t in txs) {
      if (t.isIncome) {
        income += t.amount;
      } else {
        expense += t.amount;
        byCategory[t.categoryId] = (byCategory[t.categoryId] ?? 0) + t.amount;
      }
      final uid = t.userId;
      if (uid != null) {
        final cur = byPerson[uid] ?? (expense: 0.0, count: 0);
        byPerson[uid] =
            (expense: cur.expense + (t.isExpense ? t.amount : 0), count: cur.count + 1);
      }
    }
    final cats = byCategory.entries.toList()..sort((a, b) => b.value.compareTo(a.value));
    final people = byPerson.entries.toList()
      ..sort((a, b) => b.value.expense.compareTo(a.value.expense));

    return Scaffold(
      appBar: AppBar(title: Text(tag.name)),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(24, 16, 24, 24),
        children: [
          Container(
            padding: const EdgeInsets.only(bottom: 16),
            decoration: BoxDecoration(border: Border(bottom: BorderSide(color: p.ink))),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              if (tag.note != null && tag.note!.isNotEmpty) ...[
                Text(tag.note!, style: LedgerText.body(size: 14, color: p.muted)),
                const SizedBox(height: 12),
              ],
              Text('NET FOR THIS TAG', style: LedgerText.eyebrow(p.muted)),
              const SizedBox(height: 4),
              FittedBox(
                fit: BoxFit.scaleDown,
                alignment: Alignment.centerLeft,
                child: Text(money.signed(income - expense),
                    style: LedgerText.display(size: 34, letterSpacing: -0.7)),
              ),
              const SizedBox(height: 6),
              Wrap(spacing: 24, runSpacing: 4, children: [
                Text('In ${money(income)}', style: LedgerText.body(size: 14, tabular: true)),
                Text('Out ${money(expense)}', style: LedgerText.body(size: 14, tabular: true)),
                Text(
                  txs.isEmpty
                      ? 'No entries'
                      : '${txs.length} ${txs.length == 1 ? 'entry' : 'entries'} · '
                          '${shortDate(txs.last.date, now)} – ${shortDate(txs.first.date, now)}',
                  style: LedgerText.body(size: 14, color: p.muted),
                ),
              ]),
            ]),
          ),
          if (txs.isEmpty)
            const EmptyState('Tag entries from the add or edit screen to see them here.')
          else ...[
            if (cats.isNotEmpty) ...[
              const SizedBox(height: 16),
              const SectionTitle('By category'),
              for (final e in cats)
                Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: Column(children: [
                    Row(children: [
                      Expanded(
                        child: Text(categories[e.key]?.name ?? 'Uncategorized',
                            style: LedgerText.body(size: 14)),
                      ),
                      Text('${money(e.value)} · ${(e.value / expense * 100).round()}%',
                          style: LedgerText.body(size: 14, tabular: true)),
                    ]),
                    const SizedBox(height: 6),
                    ProgressBar(
                      fraction: e.value / expense,
                      height: 6,
                      color: colorFromHex(categories[e.key]?.color),
                    ),
                  ]),
                ),
            ],
            if (people.isNotEmpty) ...[
              const SizedBox(height: 8),
              const SectionTitle('By person'),
              for (final e in people)
                ListRow(
                  title: memberName(e.key),
                  subtitle: '${e.value.count} ${e.value.count == 1 ? 'entry' : 'entries'}',
                  trailing: Text(money(e.value.expense), style: LedgerText.body(tabular: true)),
                ),
            ],
            const SizedBox(height: 16),
            const SectionTitle('Entries'),
            for (final t in txs)
              ListRow(
                onTap: () => context.push('/edit/${t.id}'),
                leading: CategoryIcon(category: categories[t.categoryId], size: 36),
                title: categories[t.categoryId]?.name ?? 'Uncategorized',
                subtitle: [
                  shortDate(t.date, now),
                  if ((t.note ?? '').trim().isNotEmpty) t.note!.trim(),
                ].join(' · '),
                trailing: Text(
                  money.signed(t.isIncome ? t.amount : -t.amount),
                  style: LedgerText.body(
                      color: t.isIncome ? p.positive : null, tabular: true),
                ),
              ),
          ],
        ],
      ),
    );
  }
}
