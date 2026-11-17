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

/// "Review detected entries" (D-029, D-030): payments auto-add was not sure
/// about. Each row has quick category chips and a note field, so labelling is
/// one tap or a few words; tapping the row opens the form prefilled, swiping
/// dismisses.
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

  /// Saves [e] with [categoryId] and the user's [words] (one tap on a
  /// chip), then lets the phone remember the payee (D-030).
  Future<void> _add(DetectedEntry e, String categoryId, String words) async {
    final note = smsNote(words: words, merchant: e.merchant, account: e.account);
    final tx = Transaction(
      id: '',
      amount: e.amount!,
      categoryId: categoryId,
      date: e.receivedAt,
      type: e.type,
      note: note,
      source: 'sms',
    );
    setState(() => _hidden.add(e.id));
    try {
      final docId = await ref.read(householdRepositoryProvider).saveTransaction(tx);
      try {
        await ref
            .read(smsDetectionProvider)
            .labelReviewItem(e.id, categoryId: categoryId, note: note, docId: docId);
      } catch (_) {}
      ref.invalidate(smsReviewQueueProvider);
      if (!mounted) return;
      HapticFeedback.mediumImpact();
      showToast(context, 'Entry added');
    } catch (_) {
      if (mounted) {
        setState(() => _hidden.remove(e.id));
        showToast(context, 'Could not save. Try again.');
      }
    }
  }

  void _open(DetectedEntry e, String words) {
    context.push(Uri(path: '/add', queryParameters: {
      'type': e.type.name,
      if (e.amount != null) 'amount': '${e.amount}',
      'date': e.receivedAt.toUtc().toIso8601String(),
      'note': ?smsNote(words: words, merchant: e.merchant, account: e.account),
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
    final table = ref.watch(smsTableProvider);
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
                      'Payments auto-add was not sure about. Tap a category to add one, with a few words if you like. Swipe to dismiss.',
                      style: LedgerText.body(size: 13, color: p.muted, height: 1.45),
                    ),
                    const SizedBox(height: 8),
                    for (final e in items)
                      _ReviewRow(
                        key: ValueKey(e.id),
                        entry: e,
                        category: _category(cats, e),
                        choices: _choices(cats, table, e),
                        money: money,
                        now: now,
                        onAdd: (categoryId, words) => _add(e, categoryId, words),
                        onOpen: (words) => _open(e, words),
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

  /// Quick chips: the item's own suggestion, then the household's usual
  /// categories for a similar amount and time of day (same cells as the
  /// notification buttons).
  List<Category> _choices(Map<String, Category> cats, SmsCategoryTable? table, DetectedEntry e) {
    final ids = <String>{
      ?e.categoryId,
      ...?table?.quickSuggestions(e.type, e.amount, e.receivedAt, n: 3),
    };
    return [
      for (final id in ids)
        if (cats[id] case final c? when c.type == e.type) c,
    ].take(3).toList();
  }
}

class _ReviewRow extends StatefulWidget {
  const _ReviewRow({
    super.key,
    required this.entry,
    required this.category,
    required this.choices,
    required this.money,
    required this.now,
    required this.onAdd,
    required this.onOpen,
    required this.onDismiss,
  });

  final DetectedEntry entry;
  final Category? category;
  final List<Category> choices;
  final Money money;
  final DateTime now;
  final void Function(String categoryId, String words) onAdd;
  final void Function(String words) onOpen;
  final VoidCallback onDismiss;

  @override
  State<_ReviewRow> createState() => _ReviewRowState();
}

class _ReviewRowState extends State<_ReviewRow> {
  late final _words = TextEditingController(text: widget.entry.words ?? '');

  @override
  void dispose() {
    _words.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final e = widget.entry;
    final category = widget.category;
    final when = '${shortDate(e.receivedAt, widget.now)}, ${timeOfDay(e.receivedAt)}';
    final canAdd = e.amount != null;
    final how = switch (e.categorySource) {
      'nano' => 'suggested by on-device AI',
      'history' => 'from your entries',
      'memory' => 'as last time',
      _ => 'suggested',
    };
    return Dismissible(
      key: ValueKey('dismiss-${e.id}'),
      onDismissed: (_) => widget.onDismiss(),
      background: Container(
        alignment: Alignment.centerRight,
        padding: const EdgeInsets.only(right: 16),
        color: p.track,
        child: Text('Dismiss', style: LedgerText.body(size: 13, color: p.muted)),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        ListRow(
          onTap: () => widget.onOpen(_words.text),
          leading: CategoryIcon(category: category),
          title: e.merchant ?? (e.type == TransactionType.income ? 'Money received' : 'Payment'),
          subtitle: [?e.account, when].join(' · '),
          below: Text(
            category == null ? 'What was it for?' : '${category.name} · $how',
            style: LedgerText.body(size: 12, color: p.muted),
          ),
          trailing: Text(
            e.amount == null
                ? '—'
                : widget.money.signed(e.type == TransactionType.income ? e.amount! : -e.amount!),
            style: LedgerText.body(
              tabular: true,
              color: e.type == TransactionType.income ? p.positive : null,
            ),
          ),
        ),
        TextField(
          controller: _words,
          maxLength: 80,
          textCapitalization: TextCapitalization.none,
          decoration: const InputDecoration(
            isDense: true,
            counterText: '',
            hintText: 'A few words, e.g. auto to office (optional)',
          ),
        ),
        const SizedBox(height: 8),
        Wrap(spacing: 8, runSpacing: 4, children: [
          for (final c in widget.choices)
            ActionChip(
              avatar: Icon(iconForName(c.icon), size: 16),
              label: Text(c.name),
              tooltip: 'Add as ${c.name}',
              onPressed: canAdd ? () => widget.onAdd(c.id, _words.text) : null,
            ),
          ActionChip(
            label: const Text('Other…'),
            tooltip: 'Open the full form',
            onPressed: () => widget.onOpen(_words.text),
          ),
        ]),
        const SizedBox(height: 12),
      ]),
    );
  }
}
