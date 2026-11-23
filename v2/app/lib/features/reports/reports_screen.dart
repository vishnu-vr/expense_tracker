import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/providers.dart';
import '../../core/domain/report.dart';
import '../../core/format/money.dart';
import '../../core/theme/ledger_theme.dart';
import '../../core/widgets/common.dart';
import 'new_report_sheet.dart';

/// Insights › Reports (D-033): monthly reports first, then reports members
/// asked for, newest first.
class ReportsScreen extends ConsumerWidget {
  const ReportsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final p = context.palette;
    final now = ref.watch(nowProvider);
    final reports = ref.watch(reportsProvider);

    Widget row(ReportSummary r, bool first) => ListRow(
          topBorder: !first,
          leading: Icon(r.isMonthly ? Icons.calendar_month_outlined : Icons.query_stats_outlined, color: p.muted),
          title: r.periodLabel,
          subtitle: [
            if (r.compareLabel != null) 'vs ${r.compareLabel}',
            'Made ${shortDate(r.generatedAt, now)}',
          ].join(' · '),
          trailing: Icon(Icons.chevron_right, color: p.muted),
          onTap: () => context.push('/reports/${r.id}'),
        );

    return Scaffold(
      appBar: AppBar(
        title: const Text('Reports'),
        actions: [
          TextButton.icon(
            onPressed: () => showNewReportSheet(context),
            icon: const Icon(Icons.add, size: 18),
            label: const Text('New report'),
          ),
          const SizedBox(width: 12),
        ],
      ),
      body: reports.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (_, _) => ListView(
          padding: const EdgeInsets.symmetric(horizontal: 24),
          children: [
            EmptyState('Could not load reports.', action: 'Retry', onAction: () => ref.invalidate(reportsProvider)),
          ],
        ),
        data: (list) {
          final monthly = list.where((r) => r.isMonthly).toList();
          final custom = list.where((r) => !r.isMonthly).toList();
          return ListView(
            padding: const EdgeInsets.fromLTRB(24, 8, 24, 24),
            children: [
              Text(
                'A full picture of a period, compared with another. A monthly report arrives on the 1st.',
                style: LedgerText.body(size: 13, color: p.muted, height: 1.4),
              ),
              if (list.isEmpty)
                EmptyState(
                  'No reports yet.',
                  action: 'New report',
                  onAction: () => showNewReportSheet(context),
                ),
              if (monthly.isNotEmpty) ...[
                const SizedBox(height: 16),
                const SectionTitle('Monthly'),
                for (final (i, r) in monthly.indexed) row(r, i == 0),
              ],
              if (custom.isNotEmpty) ...[
                const SizedBox(height: 16),
                const SectionTitle('On demand'),
                for (final (i, r) in custom.indexed) row(r, i == 0),
              ],
            ],
          );
        },
      ),
    );
  }
}
