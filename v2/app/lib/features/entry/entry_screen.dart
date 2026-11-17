import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/providers.dart';
import '../../core/domain/budget_alert.dart';
import '../../core/domain/models.dart';
import '../../core/format/money.dart';
import '../../core/theme/ledger_theme.dart';
import '../../core/widgets/category_icon.dart';
import '../../core/widgets/common.dart';
import 'tag_editor_sheet.dart';

/// Add a new entry, or view/edit an existing one ([transactionId] set).
class EntryScreen extends ConsumerStatefulWidget {
  const EntryScreen({
    super.key,
    this.transactionId,
    this.prefillType,
    this.prefillAmount,
    this.prefillNote,
    this.prefillDate,
    this.prefillCategoryId,
    this.prefillSource,
    this.reviewId,
  });

  final String? transactionId;

  /// Prefill for a new entry (used by SMS suggestions).
  final TransactionType? prefillType;
  final double? prefillAmount;
  final String? prefillNote;
  final DateTime? prefillDate;
  final String? prefillCategoryId;

  /// `sms` for an entry from a detected bank message (D-029).
  final String? prefillSource;

  /// The review-list item this form came from; removed once saved.
  final String? reviewId;

  @override
  ConsumerState<EntryScreen> createState() => _EntryScreenState();
}

class _EntryScreenState extends ConsumerState<EntryScreen> {
  final _amount = TextEditingController();
  final _note = TextEditingController();
  var _type = TransactionType.expense;
  String? _categoryId;
  late DateTime _date;
  final _tagIds = <String>{};

  Transaction? _original;
  var _loaded = false;
  var _saving = false;
  var _triedSave = false;

  bool get _isEdit => widget.transactionId != null;

  @override
  void initState() {
    super.initState();
    _date = widget.prefillDate ?? DateTime.now();
    if (!_isEdit) {
      _type = widget.prefillType ?? TransactionType.expense;
      if (widget.prefillAmount != null) _amount.text = _plain(widget.prefillAmount!);
      _note.text = widget.prefillNote ?? '';
      _categoryId = widget.prefillCategoryId;
      _loaded = true;
    }
  }

  @override
  void dispose() {
    _amount.dispose();
    _note.dispose();
    super.dispose();
  }

  static String _plain(double v) =>
      v == v.roundToDouble() ? v.toInt().toString() : v.toStringAsFixed(2);

  void _loadOriginal(List<Transaction> txs) {
    final tx = txs.where((t) => t.id == widget.transactionId).firstOrNull;
    _loaded = true;
    if (tx == null) return;
    _original = tx;
    _type = tx.type;
    _amount.text = _plain(tx.amount);
    _note.text = tx.note ?? '';
    _categoryId = tx.categoryId;
    _date = tx.date;
    _tagIds.addAll(tx.tagIds);
  }

  double? get _amountValue {
    final v = double.tryParse(_amount.text.replaceAll(',', '').trim());
    return v != null && v > 0 ? v : null;
  }

  Future<void> _pickDate() async {
    final d = await showDatePicker(
      context: context,
      initialDate: _date,
      firstDate: DateTime(2000),
      lastDate: DateTime(2100),
    );
    if (d != null) {
      setState(() => _date = DateTime(d.year, d.month, d.day, _date.hour, _date.minute));
    }
  }

  Future<void> _pickTime() async {
    final t = await showTimePicker(context: context, initialTime: TimeOfDay.fromDateTime(_date));
    if (t != null) {
      setState(() => _date = DateTime(_date.year, _date.month, _date.day, t.hour, t.minute));
    }
  }

  /// Opened from a notification there is nothing to go back to, so close
  /// lands on Home instead.
  void _close() => context.canPop() ? context.pop() : context.go('/home');

  Future<void> _save() async {
    final amount = _amountValue;
    if (amount == null || _categoryId == null) {
      setState(() => _triedSave = true);
      return;
    }
    setState(() => _saving = true);
    final note = _note.text.trim();
    final base = _original;
    final tx = Transaction(
      id: base?.id ?? '',
      amount: amount,
      categoryId: _categoryId!,
      date: _date,
      type: _type,
      note: note.isEmpty ? null : note,
      userId: base?.userId,
      userEmail: base?.userEmail,
      homeId: base?.homeId,
      tagIds: _tagIds.toList(),
      source: base?.source ?? widget.prefillSource,
    );
    try {
      await ref.read(householdRepositoryProvider).saveTransaction(tx);
      final reviewId = widget.reviewId;
      if (reviewId != null) {
        // A local call on the phone, not a server round trip.
        try {
          await ref.read(smsDetectionProvider).removeFromQueue(reviewId);
        } catch (_) {}
        ref.invalidate(smsReviewQueueProvider);
      }
      if (!mounted) return;
      HapticFeedback.mediumImpact();
      showToast(context, _isEdit ? 'Entry updated' : 'Entry added');
      _close();
    } catch (_) {
      if (!mounted) return;
      setState(() => _saving = false);
      showToast(context, 'Could not save. Check your connection and try again.');
    }
  }

  Future<void> _delete() async {
    final ok = await confirmDialog(
      context,
      title: 'Delete this entry?',
      message: 'This cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
    );
    if (!ok || !mounted) return;
    try {
      await ref.read(householdRepositoryProvider).deleteTransaction(widget.transactionId!);
      if (!mounted) return;
      showToast(context, 'Entry deleted');
      _close();
    } catch (_) {
      if (mounted) showToast(context, 'Could not delete. Try again.');
    }
  }

  Future<void> _newTag() async {
    final id = await showTagEditorSheet(context, ref);
    if (id != null && mounted) setState(() => _tagIds.add(id));
  }

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final txs = ref.watch(transactionsProvider).value;
    if (!_loaded && txs != null) _loadOriginal(txs);

    if (!_loaded) {
      return Scaffold(
        appBar: AppBar(title: const Text('Entry')),
        body: const Center(child: CircularProgressIndicator()),
      );
    }
    if (_isEdit && _original == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Entry')),
        body: const Center(child: EmptyState('This entry no longer exists.')),
      );
    }

    final me = ref.watch(householdRepositoryProvider).currentUserId;
    final readOnly =
        _isEdit && _original!.userId != null && _original!.userId != me;
    final categories =
        ref.watch(categoriesProvider).where((c) => c.type == _type).toList();
    final tags = ref.watch(tagsProvider).value ?? const <Tag>[];
    final money = ref.watch(moneyProvider);

    BudgetDraftAlert? alert;
    if (_type == TransactionType.expense && _categoryId != null && txs != null) {
      final budget = (ref.watch(budgetsProvider).value ?? const <CategoryBudget>[])
          .where((b) => b.categoryId == _categoryId)
          .firstOrNull;
      if (budget != null) {
        alert = budgetDraftAlert(
          budget.amount,
          spentForCategoryInMonth(txs, _categoryId!, _date.year, _date.month,
              excludeTransactionId: widget.transactionId),
          _amountValue ?? 0,
        );
      }
    }

    return Scaffold(
      appBar: AppBar(
        leading: context.canPop()
            ? null
            : IconButton(
                tooltip: 'Close',
                onPressed: _close,
                icon: const Icon(Icons.close),
              ),
        title: Text(readOnly ? 'View entry' : (_isEdit ? 'Edit entry' : 'Add entry')),
        actions: [
          if (_isEdit && !readOnly)
            IconButton(
              tooltip: 'Delete entry',
              onPressed: _delete,
              icon: Icon(Icons.delete_outline, color: p.danger),
            ),
          const SizedBox(width: 8),
        ],
      ),
      bottomNavigationBar: readOnly
          ? null
          : SafeArea(
              child: Padding(
                padding: EdgeInsets.fromLTRB(
                    24, 8, 24, 12 + MediaQuery.viewInsetsOf(context).bottom),
                child: FilledButton(
                  onPressed: _saving ? null : _save,
                  child: Text(_saving ? 'Saving…' : (_isEdit ? 'Update entry' : 'Save entry')),
                ),
              ),
            ),
      body: AbsorbPointer(
        absorbing: readOnly,
        child: SingleChildScrollView(
          keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
          padding: const EdgeInsets.fromLTRB(24, 16, 24, 24),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            if (readOnly) ...[
              LedgerCard(
                child: Row(children: [
                  Icon(Icons.lock_outline, size: 18, color: p.muted),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      'Added by ${ref.watch(memberNameProvider)(_original!.userId!)}. Only they can change it.',
                      style: LedgerText.body(size: 14, height: 1.4),
                    ),
                  ),
                ]),
              ),
              const SizedBox(height: 16),
            ],
            if (_original?.fromSms ?? widget.prefillSource == 'sms') ...[
              Row(children: [
                Icon(Icons.sms_outlined, size: 16, color: p.muted),
                const SizedBox(width: 8),
                Expanded(
                  child: Text('Added from a bank message',
                      style: LedgerText.body(size: 13, color: p.muted)),
                ),
              ]),
              const SizedBox(height: 12),
            ],
            Segmented<TransactionType>(
              options: const {
                TransactionType.expense: 'Expense',
                TransactionType.income: 'Income',
              },
              selected: _type,
              onChanged: (t) => setState(() {
                _type = t;
                // A category of the other type must not stay selected.
                _categoryId = null;
              }),
            ),
            const SizedBox(height: 20),
            Text('AMOUNT', style: LedgerText.eyebrow(p.muted)),
            TextField(
              controller: _amount,
              autofocus: !_isEdit && widget.prefillAmount == null,
              onChanged: (_) => setState(() {}),
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              inputFormatters: [
                FilteringTextInputFormatter.allow(RegExp(r'^\d{0,9}(\.\d{0,2})?')),
              ],
              style: LedgerText.display(size: 44, height: 1.2, letterSpacing: -1),
              cursorColor: p.ink,
              decoration: InputDecoration(
                filled: false,
                contentPadding: const EdgeInsets.symmetric(vertical: 6),
                prefixText: '₹ ',
                prefixStyle: LedgerText.display(size: 44, height: 1.2, color: p.muted),
                hintText: '0',
                hintStyle: LedgerText.display(size: 44, height: 1.2, color: p.line),
                border: UnderlineInputBorder(borderSide: BorderSide(color: p.ink)),
                enabledBorder: UnderlineInputBorder(borderSide: BorderSide(color: p.ink)),
                focusedBorder: UnderlineInputBorder(borderSide: BorderSide(color: p.ink, width: 2)),
                errorText: _triedSave && _amountValue == null ? 'Enter an amount' : null,
              ),
            ),
            const SizedBox(height: 24),
            Text('CATEGORY', style: LedgerText.eyebrow(p.muted)),
            if (_triedSave && _categoryId == null)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text('Pick a category',
                    style: LedgerText.body(size: 12, color: p.danger)),
              ),
            const SizedBox(height: 10),
            GridView.count(
              crossAxisCount: 4,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              mainAxisSpacing: 8,
              crossAxisSpacing: 8,
              childAspectRatio: 0.92,
              children: [
                for (final c in categories)
                  _CategoryTile(
                    category: c,
                    selected: c.id == _categoryId,
                    onTap: () {
                      HapticFeedback.selectionClick();
                      setState(() => _categoryId = c.id);
                    },
                  ),
              ],
            ),
            if (alert != null) ...[
              const SizedBox(height: 16),
              _BudgetAlertBanner(alert: alert, money: money),
            ],
            const SizedBox(height: 24),
            Text('WHEN', style: LedgerText.eyebrow(p.muted)),
            const SizedBox(height: 10),
            Row(children: [
              Expanded(
                flex: 3,
                child: OutlinedButton.icon(
                  onPressed: _pickDate,
                  icon: const Icon(Icons.calendar_today_outlined, size: 16),
                  label: Text(shortDate(_date), maxLines: 1, overflow: TextOverflow.ellipsis),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                flex: 2,
                child: OutlinedButton.icon(
                  onPressed: _pickTime,
                  icon: const Icon(Icons.schedule, size: 16),
                  label: Text(timeOfDay(_date), maxLines: 1, overflow: TextOverflow.ellipsis),
                ),
              ),
            ]),
            const SizedBox(height: 24),
            Text('NOTE', style: LedgerText.eyebrow(p.muted)),
            const SizedBox(height: 10),
            TextField(
              controller: _note,
              textCapitalization: TextCapitalization.sentences,
              maxLength: 200,
              decoration: const InputDecoration(hintText: 'Optional', counterText: ''),
            ),
            const SizedBox(height: 24),
            Text('TAGS', style: LedgerText.eyebrow(p.muted)),
            const SizedBox(height: 4),
            Wrap(spacing: 8, children: [
              for (final t in tags)
                Pill(
                  t.name,
                  dot: colorFromHex(t.color),
                  selected: _tagIds.contains(t.id),
                  onTap: () => setState(() =>
                      _tagIds.contains(t.id) ? _tagIds.remove(t.id) : _tagIds.add(t.id)),
                ),
              if (!readOnly) Pill('+ New tag', color: p.muted, onTap: _newTag),
            ]),
          ]),
        ),
      ),
    );
  }
}

class _CategoryTile extends StatelessWidget {
  const _CategoryTile({required this.category, required this.selected, required this.onTap});

  final Category category;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return Semantics(
      button: true,
      selected: selected,
      label: category.name,
      excludeSemantics: true,
      child: Material(
        color: selected ? p.ink : p.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(8),
          side: BorderSide(color: selected ? p.ink : p.line),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Stack(children: [
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 4),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(iconForName(category.icon),
                      size: 22, color: selected ? p.onInk : p.ink),
                  const SizedBox(height: 6),
                  Text(
                    category.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    textAlign: TextAlign.center,
                    style: LedgerText.body(
                        size: 11, weight: 500, color: selected ? p.onInk : p.ink),
                  ),
                ],
              ),
            ),
            Positioned(
              left: 0,
              right: 0,
              bottom: 0,
              height: 3,
              child: ColoredBox(color: colorFromHex(category.color)),
            ),
          ]),
        ),
      ),
    );
  }
}

class _BudgetAlertBanner extends StatelessWidget {
  const _BudgetAlertBanner({required this.alert, required this.money});

  final BudgetDraftAlert alert;
  final Money money;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final over = alert.level == BudgetDraftAlertLevel.over;
    final color = over ? p.danger : p.warning;
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        border: Border.all(color: color),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Icon(Icons.error_outline, size: 18, color: color),
        const SizedBox(width: 10),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(over ? 'Over monthly budget' : 'Approaching monthly budget',
                style: LedgerText.body(size: 14, weight: 600, color: color)),
            const SizedBox(height: 2),
            Text(
              'With this entry: ${money(alert.projected)} of ${money(alert.budget)} (${alert.projectedPct.round()}%)',
              style: LedgerText.body(size: 13, height: 1.4, tabular: true),
            ),
          ]),
        ),
      ]),
    );
  }
}
