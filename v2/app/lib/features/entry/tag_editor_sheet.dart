import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/providers.dart';
import '../../core/domain/models.dart';
import '../../core/theme/ledger_theme.dart';
import '../../core/widgets/category_icon.dart';

const swatchColors = [
  '#1D4ED8', '#0B6E4F', '#C2410C', '#BE185D', '#6D28D9', '#0F766E', '#A16207', '#475569',
];

/// Row of tappable colour swatches.
class SwatchPicker extends StatelessWidget {
  const SwatchPicker({super.key, required this.selected, required this.onChanged});

  final String selected;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return Wrap(spacing: 4, children: [
      for (final hex in swatchColors)
        Semantics(
          button: true,
          selected: hex == selected,
          label: 'Colour $hex',
          child: InkResponse(
            onTap: () => onChanged(hex),
            radius: 22,
            child: SizedBox(
              width: 44,
              height: 44,
              child: Center(
                child: Container(
                  width: 28,
                  height: 28,
                  decoration: BoxDecoration(
                    color: colorFromHex(hex),
                    shape: BoxShape.circle,
                    border: Border.all(
                      color: hex == selected ? p.ink : Colors.transparent,
                      width: 3,
                      strokeAlign: BorderSide.strokeAlignOutside,
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
    ]);
  }
}

/// Create or edit a tag. Returns the saved tag id, or null when dismissed.
Future<String?> showTagEditorSheet(BuildContext context, WidgetRef ref, {Tag? tag}) {
  return showModalBottomSheet<String>(
    context: context,
    isScrollControlled: true,
    builder: (_) => _TagEditor(tag: tag),
  );
}

class _TagEditor extends ConsumerStatefulWidget {
  const _TagEditor({this.tag});

  final Tag? tag;

  @override
  ConsumerState<_TagEditor> createState() => _TagEditorState();
}

class _TagEditorState extends ConsumerState<_TagEditor> {
  late final _name = TextEditingController(text: widget.tag?.name ?? '');
  late final _note = TextEditingController(text: widget.tag?.note ?? '');
  late String _color = swatchColors.contains(widget.tag?.color)
      ? widget.tag!.color!
      : swatchColors.first;
  String? _error;
  var _saving = false;

  @override
  void dispose() {
    _name.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final name = _name.text.trim();
    if (name.isEmpty) return setState(() => _error = 'Enter a name');
    final existing = ref.read(tagsProvider).value ?? const <Tag>[];
    if (existing.any((t) =>
        t.id != widget.tag?.id && t.name.toLowerCase() == name.toLowerCase())) {
      return setState(() => _error = 'A tag with this name already exists');
    }
    setState(() => _saving = true);
    final note = _note.text.trim();
    try {
      final id = await ref.read(householdRepositoryProvider).saveTag(Tag(
            id: widget.tag?.id ?? '',
            name: name,
            color: _color,
            note: note.isEmpty ? null : note,
            createdBy: widget.tag?.createdBy,
            createdAt: widget.tag?.createdAt,
          ));
      if (mounted) Navigator.pop(context, id);
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
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(widget.tag == null ? 'New tag' : 'Edit tag', style: LedgerText.display(size: 18)),
          const SizedBox(height: 16),
          TextField(
            controller: _name,
            autofocus: true,
            maxLength: 40,
            textCapitalization: TextCapitalization.sentences,
            decoration: InputDecoration(labelText: 'Name', counterText: '', errorText: _error),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _note,
            maxLength: 120,
            textCapitalization: TextCapitalization.sentences,
            decoration: const InputDecoration(labelText: 'Note (optional)', counterText: ''),
          ),
          const SizedBox(height: 16),
          Text('COLOUR', style: LedgerText.eyebrow(p.muted)),
          const SizedBox(height: 4),
          SwatchPicker(selected: _color, onChanged: (c) => setState(() => _color = c)),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: _saving ? null : _save,
            child: Text(_saving ? 'Saving…' : 'Save tag'),
          ),
        ],
      ),
    );
  }
}
