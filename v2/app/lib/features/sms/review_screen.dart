import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/providers.dart';
import '../../core/domain/models.dart';
import '../../core/domain/sms_categories.dart';
import '../../core/format/money.dart';
import '../../core/theme/ledger_theme.dart';
import '../../core/widgets/category_icon.dart';
import '../../core/widgets/common.dart';

/// "Review detected entries" (D-029): bank messages auto-add was not sure
/// about. Add saves with the suggested category, tapping a row opens the form
/// prefilled, swiping dismisses.
class ReviewScreen extends ConsumerStatefulWidget {
  const ReviewScreen({super.key});

  @override
  ConsumerState<ReviewScreen> createState() => _ReviewScreenState();
}

class _ReviewScreenState extends ConsumerState<ReviewScreen> {
  /// Hidden at once: a dismissed row must leave the tree before the queue reloads.
  final _hidden = <String>{};

  @override
  void initState() {
    super.initState();
    _suggest();
  }

  /// On-device AI only runs while the app is open, so ask it now for
  /// entries the rules could not place.
  Future<void> _suggest() async {
    try {
      await ref.read(smsDetectionProvider).suggestCategories();
      if (mounted) ref.invalidate(smsReviewQueueProvider);
    } catch (_) {}
  }

  Future<void> _remove(String id) async {
    setState(() => _hidden.add(id));
    try {
      await ref.read(smsDetectionProvider).removeFromQueue(id);
    } catch (_) {}
    ref.invalidate(smsReviewQueueProvider);
  }

  Future<void> _add(DetectedEntry e) async {
    final tx = Transaction(
      id: '',
      amount: e.amount!,
      categoryId: e.categoryId!,
      date: e.receivedAt,
      type: e.type,
      note: e.note,
      source: 'sms',
    );
    try {
      await ref.read(householdRepositoryProvider).saveTransaction(tx);
      await _remove(e.id);
      if (!mounted) return;
      HapticFeedback.mediumImpact();
      showToast(context, 'Entry added');
    } catch (_) {
      if (mounted) showToast(context, 'Could not save. Try again.');
    }
  }

  void _open(DetectedEntry e) {
    context.push(Uri(path: '/add', queryParameters: {
      'type': e.type.name,
      if (e.amount != null) 'amount': '${e.amount}',
      'date': e.receivedAt.toUtc().toIso8601String(),
      'note': ?e.note,
      'category': ?e.categoryId,
      'source': 'sms',
      'review': e.id,
    }).toString());
  }

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final queue = ref.watch(smsReviewQueueProvider);
    final cats = ref.watch(categoryByIdProvider);
    final money = ref.watch(moneyProvider);
    final now = ref.watch(nowProvider);
    final items = [
      for (final e in queue.value ?? const <DetectedEntry>[])
        if (!_hidden.contains(e.id)) e,
    ];

    return Scaffold(
      appBar: AppBar(
        // Opened from a notification there is nothing to go back to.
        leading: context.canPop()
            ? null
            : IconButton(
                tooltip: 'Close',
                onPressed: () => context.go('/home'),
                icon: const Icon(Icons.close),
              ),
        title: const Text('Review detected entries'),
      ),
      body: queue.isLoading && queue.value == null
          ? const Center(child: CircularProgressIndicator())
          : items.isEmpty
              ? const Center(child: EmptyState('Nothing to review.'))
              : ListView(
                  padding: const EdgeInsets.fromLTRB(24, 8, 24, 24),
                  children: [
                    Text(
                      'Bank messages auto-add was not sure about. Swipe to dismiss.',
                      style: LedgerText.body(size: 13, color: p.muted, height: 1.45),
                    ),
                    const SizedBox(height: 8),
                    for (final e in items)
                      _ReviewRow(
                        key: ValueKey(e.id),
                        entry: e,
                        category: _category(cats, e),
                        money: money,
                        now: now,
                        onAdd: () => _add(e),
                        onOpen: () => _open(e),
                        onDismiss: () => _remove(e.id),
                      ),
                  ],
                ),
    );
  }

  /// The suggested category, if it exists and fits the direction.
  Category? _category(Map<String, Category> cats, DetectedEntry e) {
    final c = cats[e.categoryId];
    return c != null && c.type == e.type ? c : null;
  }
}

class _ReviewRow extends StatelessWidget {
  const _ReviewRow({
    super.key,
    required this.entry,
    required this.category,
    required this.money,
    required this.now,
    required this.onAdd,
    required this.onOpen,
    required this.onDismiss,
  });

  final DetectedEntry entry;
  final Category? category;
  final Money money;
  final DateTime now;
  final VoidCallback onAdd;
  final VoidCallback onOpen;
  final VoidCallback onDismiss;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final e = entry;
    final when = '${shortDate(e.receivedAt, now)}, ${timeOfDay(e.receivedAt)}';
    final canAdd = category != null && e.amount != null;
    final how = switch (e.categorySource) {
      'nano' => 'suggested by on-device AI',
      'history' => 'from your entries',
      'builtin' => 'suggested',
      _ => 'suggested',
    };
    return Dismissible(
      key: ValueKey('dismiss-${e.id}'),
      onDismissed: (_) => onDismiss(),
      background: Container(
        alignment: Alignment.centerRight,
        padding: const EdgeInsets.only(right: 16),
        color: p.track,
        child: Text('Dismiss', style: LedgerText.body(size: 13, color: p.muted)),
      ),
      child: ListRow(
        onTap: onOpen,
        leading: CategoryIcon(category: category),
        title: e.merchant ?? (e.type == TransactionType.income ? 'Money received' : 'Payment'),
        subtitle: [?e.account, when].join(' · '),
        below: Text(
          category == null ? 'Tap to pick a category' : '${category!.name} · $how',
          style: LedgerText.body(size: 12, color: p.muted),
        ),
        trailing: Row(mainAxisSize: MainAxisSize.min, children: [
          Text(
            e.amount == null
                ? '—'
                : money.signed(e.type == TransactionType.income ? e.amount! : -e.amount!),
            style: LedgerText.body(
              tabular: true,
              color: e.type == TransactionType.income ? p.positive : null,
            ),
          ),
          const SizedBox(width: 4),
          TextButton(
            onPressed: canAdd ? onAdd : null,
            child: const Text('Add'),
          ),
        ]),
      ),
    );
  }
}
