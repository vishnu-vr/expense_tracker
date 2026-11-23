import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/providers.dart';
import '../../core/data/repositories.dart';
import '../../core/domain/report.dart';
import '../../core/format/money.dart';
import '../../core/theme/ledger_theme.dart';
import '../../core/widgets/common.dart';

/// Opens the New report sheet; when a report is made, opens it.
Future<void> showNewReportSheet(BuildContext context) async {
  final id = await showModalBottomSheet<String>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (_) => const NewReportSheet(),
  );
  if (id != null && context.mounted) context.push('/reports/$id');
}

/// Period preset + comparison, then Generate (D-033). The comparison rows
/// show the resolved dates ("vs September 2026") before anything is sent.
class NewReportSheet extends ConsumerStatefulWidget {
  const NewReportSheet({super.key});

  @override
  ConsumerState<NewReportSheet> createState() => _NewReportSheetState();
}

class _NewReportSheetState extends ConsumerState<NewReportSheet> {
  var _preset = ReportPreset.lastMonth;
  DateTime? _month;
  DayRange? _custom;
  var _compare = CompareMode.previous;
  DayRange? _customCompare;
  var _busy = false;

  DateTime get _today {
    final n = ref.read(nowProvider);
    return DateTime(n.year, n.month, n.day);
  }

  Future<DayRange?> _pickRange(DayRange? initial) async {
    final picked = await showDateRangePicker(
      context: context,
      firstDate: DateTime(2000),
      lastDate: _today,
      initialDateRange: initial == null ? null : DateTimeRange(start: initial.from, end: initial.to),
    );
    return picked == null ? null : DayRange(picked.start, picked.end);
  }

  Future<void> _generate(DayRange period) async {
    setState(() => _busy = true);
    try {
      final id = await ref.read(reportsRepositoryProvider).generate(
            period: period,
            compare: _compare,
            customCompare: _compare == CompareMode.custom ? _customCompare : null,
            model: ref.read(agentModelProvider),
          );
      if (mounted) Navigator.of(context).pop(id);
    } on ReportException catch (e) {
      if (!mounted) return;
      setState(() => _busy = false);
      showToast(context, e.message);
    } catch (_) {
      if (!mounted) return;
      setState(() => _busy = false);
      showToast(context, 'Could not make the report. Try again.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final today = _today;
    final lastMonth = DateTime(today.year, today.month - 1);
    final month = _month ?? lastMonth;
    final period = presetRange(_preset, today, month: month, custom: _custom);
    final problem = periodProblem(period, today) ??
        (_compare == CompareMode.custom ? periodProblem(_customCompare, today) : null);

    return SafeArea(
      child: SingleChildScrollView(
        padding: EdgeInsets.fromLTRB(24, 0, 24, 24 + MediaQuery.viewInsetsOf(context).bottom),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('New report', style: LedgerText.display(size: 20)),
            const SizedBox(height: 16),
            Text('PERIOD', style: LedgerText.eyebrow(p.muted)),
            const SizedBox(height: 4),
            Wrap(spacing: 8, children: [
              for (final preset in ReportPreset.values)
                Pill(
                  preset.label,
                  selected: _preset == preset,
                  onTap: _busy
                      ? null
                      : () async {
                          if (preset == ReportPreset.custom) {
                            final r = await _pickRange(_custom);
                            if (r == null) return;
                            setState(() => _custom = r);
                          }
                          setState(() => _preset = preset);
                        },
                ),
            ]),
            if (_preset == ReportPreset.pickMonth)
              PeriodNav(
                label: monthYear(month),
                onPrevious: _busy ? null : () => setState(() => _month = DateTime(month.year, month.month - 1)),
                onNext: _busy || !DateTime(month.year, month.month + 1).isBefore(DateTime(today.year, today.month + 1))
                    ? null
                    : () => setState(() => _month = DateTime(month.year, month.month + 1)),
              ),
            if (period != null) ...[
              const SizedBox(height: 8),
              Text(
                '${period.label} · ${period.days} ${period.days == 1 ? 'day' : 'days'}',
                style: LedgerText.body(weight: 600),
              ),
            ],
            const SizedBox(height: 20),
            Text('COMPARE WITH', style: LedgerText.eyebrow(p.muted)),
            for (final mode in CompareMode.values)
              ListRow(
                topBorder: mode != CompareMode.values.first,
                leading: Icon(
                  _compare == mode ? Icons.radio_button_checked : Icons.radio_button_unchecked,
                  color: _compare == mode ? p.ink : p.muted,
                ),
                title: mode.label,
                subtitle: switch (mode) {
                  CompareMode.none => 'Just this period',
                  CompareMode.custom when _customCompare == null => 'Pick any dates',
                  _ => period == null ? null : comparisonLabel(period, mode, custom: _customCompare),
                },
                onTap: _busy
                    ? null
                    : () async {
                        if (mode == CompareMode.custom) {
                          final r = await _pickRange(_customCompare);
                          if (r == null) return;
                          setState(() => _customCompare = r);
                        }
                        setState(() => _compare = mode);
                      },
              ),
            const SizedBox(height: 16),
            if (_busy)
              Row(children: [
                const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)),
                const SizedBox(width: 12),
                Expanded(
                  child: Text('Writing your report. This takes about 10 seconds.',
                      style: LedgerText.body(size: 13, color: p.muted)),
                ),
              ])
            else ...[
              if (problem != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Text(problem, style: LedgerText.body(size: 13, color: p.danger)),
                ),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: problem != null || period == null ? null : () => _generate(period),
                  child: const Text('Generate'),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
