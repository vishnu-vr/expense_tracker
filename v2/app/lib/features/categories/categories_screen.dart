import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/providers.dart';
import '../../core/domain/default_categories.dart';
import '../../core/domain/models.dart';
import '../../core/theme/ledger_theme.dart';
import '../../core/widgets/category_icon.dart';
import '../../core/widgets/common.dart';
import '../entry/tag_editor_sheet.dart';

class CategoriesScreen extends ConsumerWidget {
  const CategoriesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final p = context.palette;
    final all = ref.watch(categoriesProvider);

    Future<void> delete(Category c) async {
      final ok = await confirmDialog(
        context,
        title: 'Delete "${c.name}"?',
        message: 'Entries already filed under it keep their amounts but show as Uncategorized.',
        confirmLabel: 'Delete',
        destructive: true,
      );
      if (!ok) return;
      try {
        await ref.read(householdRepositoryProvider).deleteCategory(c.id);
        if (context.mounted) showToast(context, 'Category deleted');
      } catch (_) {
        if (context.mounted) showToast(context, 'Could not delete. Try again.');
      }
    }

    List<Widget> section(String title, TransactionType type) => [
          const SizedBox(height: 16),
          SectionTitle(title),
          for (final c in all.where((c) => c.type == type))
            ListRow(
              leading: CategoryIcon(category: c, size: 36),
              title: c.name,
              subtitle: c.isDefault ? 'Built in' : 'Custom',
              trailing: c.isDefault
                  ? null
                  : Row(mainAxisSize: MainAxisSize.min, children: [
                      IconButton(
                        tooltip: 'Edit ${c.name}',
                        onPressed: () => showCategorySheet(context, category: c),
                        icon: const Icon(Icons.edit_outlined, size: 20),
                      ),
                      IconButton(
                        tooltip: 'Delete ${c.name}',
                        onPressed: () => delete(c),
                        icon: Icon(Icons.delete_outline, size: 20, color: p.danger),
                      ),
                    ]),
            ),
        ];

    return Scaffold(
      appBar: AppBar(
        title: const Text('Categories'),
        actions: [
          TextButton.icon(
            onPressed: () => showCategorySheet(context),
            icon: const Icon(Icons.add, size: 18),
            label: const Text('Add'),
          ),
          const SizedBox(width: 12),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(24, 0, 24, 24),
        children: [
          ...section('Expense', TransactionType.expense),
          ...section('Income', TransactionType.income),
        ],
      ),
    );
  }
}

Future<void> showCategorySheet(BuildContext context, {Category? category}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    builder: (_) => _CategorySheet(category: category),
  );
}

class _CategorySheet extends ConsumerStatefulWidget {
  const _CategorySheet({this.category});

  final Category? category;

  @override
  ConsumerState<_CategorySheet> createState() => _CategorySheetState();
}

class _CategorySheetState extends ConsumerState<_CategorySheet> {
  late final _name = TextEditingController(text: widget.category?.name ?? '');
  late var _type = widget.category?.type ?? TransactionType.expense;
  late var _icon = widget.category?.icon ?? 'category';
  late var _color = swatchColors.contains(widget.category?.color)
      ? widget.category!.color
      : swatchColors.first;
  String? _error;
  var _saving = false;

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final name = _name.text.trim();
    if (name.isEmpty) return setState(() => _error = 'Enter a name');
    final editing = widget.category;
    final clash = ref.read(categoriesProvider).any((c) =>
        c.id != editing?.id &&
        c.type == _type &&
        c.name.toLowerCase() == name.toLowerCase());
    if (clash) return setState(() => _error = 'A category with this name already exists');

    var id = editing?.id ?? generateCategoryId(name);
    if (editing == null) {
      final taken = {for (final c in ref.read(categoriesProvider)) c.id};
      if (id.isEmpty) id = 'category';
      final base = id;
      for (var n = 2; taken.contains(id); n++) {
        id = '${base}_$n';
      }
    }
    setState(() => _saving = true);
    try {
      await ref.read(householdRepositoryProvider).saveCategory(
          Category(id: id, name: name, icon: _icon, color: _color, type: _type));
      if (!mounted) return;
      Navigator.pop(context);
      showToast(context, editing == null ? 'Category added' : 'Category updated');
    } catch (_) {
      if (mounted) {
        setState(() {
          _saving = false;
          _error = 'Could not save. Try again.';
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return Padding(
      padding: EdgeInsets.fromLTRB(24, 0, 24, 24 + MediaQuery.viewInsetsOf(context).bottom),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(widget.category == null ? 'New category' : 'Edit category',
                style: LedgerText.display(size: 18)),
            const SizedBox(height: 16),
            TextField(
              controller: _name,
              maxLength: 40,
              textCapitalization: TextCapitalization.words,
              decoration: InputDecoration(labelText: 'Name', counterText: '', errorText: _error),
            ),
            const SizedBox(height: 12),
            Segmented<TransactionType>(
              options: const {
                TransactionType.expense: 'Expense',
                TransactionType.income: 'Income',
              },
              selected: _type,
              // The type is part of how past entries are counted, so it is
              // fixed once the category exists.
              enabled: widget.category == null,
              onChanged: (t) => setState(() => _type = t),
            ),
            const SizedBox(height: 16),
            Text('COLOUR', style: LedgerText.eyebrow(p.muted)),
            SwatchPicker(selected: _color, onChanged: (c) => setState(() => _color = c)),
            const SizedBox(height: 12),
            Text('ICON', style: LedgerText.eyebrow(p.muted)),
            const SizedBox(height: 4),
            Wrap(children: [
              for (final e in categoryIcons.entries)
                IconButton(
                  tooltip: e.key.replaceAll('_', ' '),
                  isSelected: e.key == _icon,
                  onPressed: () => setState(() => _icon = e.key),
                  style: IconButton.styleFrom(
                    backgroundColor: e.key == _icon ? p.ink : null,
                    foregroundColor: e.key == _icon ? p.onInk : p.ink,
                    fixedSize: const Size(44, 44),
                  ),
                  icon: Icon(e.value, size: 20),
                ),
            ]),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: _saving ? null : _save,
              child: Text(_saving ? 'Saving…' : 'Save category'),
            ),
          ],
        ),
      ),
    );
  }
}
