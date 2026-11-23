import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/providers.dart';
import '../../core/data/repositories.dart';
import '../../core/domain/report.dart';
import '../../core/format/money.dart';
import '../../core/theme/ledger_theme.dart';
import '../../core/widgets/common.dart';

const _moneyMetrics = {'spent', 'income', 'net', 'dailyAverage'};

/// One saved report (D-033): headline figures with change chips, the
/// narrative, then each section. A snapshot: Refresh rebuilds it.
class ReportScreen extends ConsumerStatefulWidget {
  const ReportScreen({super.key, required this.reportId});

  final String reportId;

  @override
  ConsumerState<ReportScreen> createState() => _ReportScreenState();
}

class _ReportScreenState extends ConsumerState<ReportScreen> {
  var _refreshing = false;

  Future<void> _refresh() async {
    setState(() => _refreshing = true);
    try {
      await ref.read(reportsRepositoryProvider).refresh(widget.reportId, model: ref.read(agentModelProvider));
      if (mounted) showToast(context, 'Report updated');
    } on ReportException catch (e) {
      if (mounted) showToast(context, e.message);
    } catch (_) {
      if (mounted) showToast(context, 'Could not update the report. Try again.');
    } finally {
      if (mounted) setState(() => _refreshing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(reportProvider(widget.reportId));
    final report = async.value;
    return Scaffold(
      appBar: AppBar(
        title: Text(report?.summary.periodLabel ?? 'Report'),
        actions: [
          if (report != null)
            _refreshing
                ? const Padding(
                    padding: EdgeInsets.all(14),
                    child: SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)),
                  )
                : IconButton(tooltip: 'Refresh', onPressed: _refresh, icon: const Icon(Icons.refresh)),
          const SizedBox(width: 8),
        ],
      ),
      body: async.isLoading && report == null
          ? const Center(child: CircularProgressIndicator())
          : report == null
              ? ListView(
                  padding: const EdgeInsets.symmetric(horizontal: 24),
                  children: [
                    EmptyState('This report is not available.', action: 'All reports', onAction: () => context.go('/reports')),
                  ],
                )
              : _ReportBody(report: report),
    );
  }
}

class _ReportBody extends ConsumerWidget {
  const _ReportBody({required this.report});

  final Report report;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final p = context.palette;
    final money = ref.watch(moneyProvider);
    final now = ref.watch(nowProvider);
    final at = report.summary.generatedAt;
    final c = report.compare;
    return ListView(
      padding: const EdgeInsets.fromLTRB(24, 4, 24, 32),
      children: [
        Text(
          [
            report.summary.isMonthly ? 'MONTHLY REPORT' : 'REPORT',
            if (c != null) 'VS ${c.label.toUpperCase()}',
          ].join(' · '),
          style: LedgerText.eyebrow(p.muted),
        ),
        const SizedBox(height: 4),
        Text(
          'Made on ${shortDate(at, now)}, ${timeOfDay(at)} · ${report.writtenBy}',
          style: LedgerText.body(size: 12, color: p.muted),
        ),
        const SizedBox(height: 16),
        _Headline(report: report, money: money),
        if (report.baselineNote != null) ...[
          const SizedBox(height: 8),
          Text(report.baselineNote!, style: LedgerText.body(size: 13, color: p.muted)),
        ],
        const SizedBox(height: 20),
        _NarrativeCard(narrative: report.narrative, money: money),
        if (report.categories.isNotEmpty) ...[
          const SizedBox(height: 24),
          const SectionTitle('Categories'),
          _Categories(report: report, money: money),
        ],
        if (report.members.isNotEmpty) ...[
          const SizedBox(height: 24),
          const SectionTitle('Who spent'),
          _Members(rows: report.members, money: money),
        ],
        if (report.rhythm != null) ...[
          const SizedBox(height: 24),
          const SectionTitle('Rhythm'),
          _Rhythm(rhythm: report.rhythm!, compareLabel: c?.label, money: money),
        ],
        if (report.merchantsBySpend.isNotEmpty) ...[
          const SizedBox(height: 24),
          const SectionTitle('Top merchants'),
          for (final (i, m) in report.merchantsBySpend.indexed)
            ListRow(
              topBorder: i > 0,
              title: '${m.rank}. ${m.name}',
              subtitle: '${m.count} ${m.count == 1 ? 'visit' : 'visits'}${_rankText(m)}',
              trailing: Text(money(m.total), style: LedgerText.body(tabular: true)),
            ),
        ],
        if (report.notable != null) ...[
          const SizedBox(height: 24),
          const SectionTitle('Worth a look'),
          _Notable(notable: report.notable!, money: money),
        ],
        if (report.bills != null) ...[
          const SizedBox(height: 24),
          const SectionTitle('Bills'),
          _Bills(bills: report.bills!, money: money),
        ],
        if (report.budgets != null) ...[
          const SizedBox(height: 24),
          SectionTitle('Budgets · ${report.budgets!.monthLabel}'),
          _Budgets(budgets: report.budgets!, money: money),
        ],
        if (report.tags.isNotEmpty) ...[
          const SizedBox(height: 24),
          const SectionTitle('Tags'),
          for (final (i, t) in report.tags.indexed)
            ListRow(
              topBorder: i > 0,
              title: t.name,
              subtitle: '${t.count} ${t.count == 1 ? 'entry' : 'entries'}'
                  '${t.compare != null && c != null ? ' · ${money(t.compare!.base)} in ${c.label}' : ''}',
              trailing: Text(money(t.total), style: LedgerText.body(tabular: true)),
            ),
        ],
        const SizedBox(height: 28),
        OutlinedButton.icon(
          onPressed: () => context.push('/ask', extra: report.askQuestion),
          icon: const Icon(Icons.auto_awesome_outlined, size: 18),
          label: const Text('Ask about this report'),
        ),
      ],
    );
  }

  static String _rankText(ReportMerchant m) {
    if (m.isNew) return ' · new';
    final r = m.rankChange;
    if (r == null || r == 0) return '';
    return ' · ${r > 0 ? 'up' : 'down'} ${r.abs()}';
  }
}

/// "+₹3,900 · +260%" coloured by whether the change is good news.
class _DeltaChip extends StatelessWidget {
  const _DeltaChip({required this.compare, required this.money, required this.isMoney, this.higherIsWorse = false});

  final FigureCompare compare;
  final Money money;
  final bool isMoney;
  final bool higherIsWorse;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final d = compare.delta;
    final color = d == 0 ? p.muted : ((d > 0) == higherIsWorse ? p.danger : p.positive);
    final amount = isMoney ? money.signed(d) : compare.deltaDisplay;
    final text = [amount, ?compare.deltaPctDisplay].join(' · ');
    return Pill(text, color: color);
  }
}

class _Headline extends StatelessWidget {
  const _Headline({required this.report, required this.money});

  final Report report;
  final Money money;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final shown = report.metrics.where((m) => m.display != null).toList();
    return Container(
      padding: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(border: Border(bottom: BorderSide(color: p.ink))),
      child: Wrap(
        runSpacing: 16,
        children: [
          for (final m in shown)
            FractionallySizedBox(
              widthFactor: 0.5,
              child: Padding(
                padding: const EdgeInsets.only(right: 8),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(m.label.toUpperCase(), style: LedgerText.eyebrow(p.muted)),
                  const SizedBox(height: 4),
                  FittedBox(
                    fit: BoxFit.scaleDown,
                    alignment: Alignment.centerLeft,
                    child: Text(
                      _moneyMetrics.contains(m.key) && m.value != null ? money(m.value!) : m.display!,
                      style: LedgerText.display(size: m.key == 'spent' ? 26 : 20, letterSpacing: -0.4),
                    ),
                  ),
                  if (m.compare != null) ...[
                    const SizedBox(height: 4),
                    _DeltaChip(
                      compare: m.compare!,
                      money: money,
                      isMoney: _moneyMetrics.contains(m.key),
                      higherIsWorse: m.higherIsWorse,
                    ),
                  ],
                ]),
              ),
            ),
        ],
      ),
    );
  }
}

class _NarrativeCard extends StatelessWidget {
  const _NarrativeCard({required this.narrative, required this.money});

  final ReportNarrative narrative;
  final Money money;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    Widget bullets(String title, List<String> items) => Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(height: 12),
            Text(title, style: LedgerText.eyebrow(p.onAccentMuted)),
            for (final t in items)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('•  ', style: LedgerText.body(color: p.onAccent)),
                  Expanded(child: Text(money.text(t), style: LedgerText.body(size: 14, height: 1.4, color: p.onAccent))),
                ]),
              ),
          ],
        );
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: p.accent, borderRadius: BorderRadius.circular(12)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(money.text(narrative.headline),
            style: LedgerText.display(size: 18, color: p.onAccent)),
        const SizedBox(height: 8),
        Text(money.text(narrative.summary), style: LedgerText.body(size: 14, height: 1.45, color: p.onAccent)),
        if (narrative.changes.isNotEmpty) bullets('WHAT CHANGED', narrative.changes),
        if (narrative.suggestions.isNotEmpty) bullets('IDEAS', narrative.suggestions),
      ]),
    );
  }
}

/// Paired bars: this period (ink) above the comparison (muted).
class _Categories extends StatelessWidget {
  const _Categories({required this.report, required this.money});

  final Report report;
  final Money money;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final rows = report.categories;
    final max = rows.fold<double>(0, (m, r) => [m, r.total, r.compare?.base ?? 0].reduce((a, b) => a > b ? a : b));
    final c = report.compare;
    return Column(children: [
      for (final (i, r) in rows.indexed)
        Container(
          padding: const EdgeInsets.symmetric(vertical: 10),
          decoration: BoxDecoration(border: i == 0 ? null : Border(top: BorderSide(color: p.line))),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Expanded(
                child: Text(r.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: LedgerText.body(weight: 500)),
              ),
              if (r.status == 'new') const Padding(padding: EdgeInsets.only(right: 8), child: Pill('New')),
              if (r.status == 'gone') const Padding(padding: EdgeInsets.only(right: 8), child: Pill('None this time')),
              Text(money(r.total), style: LedgerText.body(tabular: true)),
            ]),
            const SizedBox(height: 6),
            ProgressBar(fraction: max > 0 ? r.total / max : 0, height: 6, color: p.ink),
            if (r.compare != null) ...[
              const SizedBox(height: 3),
              ProgressBar(fraction: max > 0 ? r.compare!.base / max : 0, height: 6, color: p.muted),
              const SizedBox(height: 4),
              Text(
                '${r.shareDisplay} of spending · ${money(r.compare!.base)} in ${c?.label ?? 'comparison'} · '
                '${money.signed(r.compare!.delta)}',
                style: LedgerText.body(size: 12, color: p.muted),
              ),
            ] else ...[
              const SizedBox(height: 4),
              Text('${r.shareDisplay} of spending · ${r.count} ${r.count == 1 ? 'entry' : 'entries'}',
                  style: LedgerText.body(size: 12, color: p.muted)),
            ],
          ]),
        ),
    ]);
  }
}

/// A split bar of each member's share, then the rows.
class _Members extends StatelessWidget {
  const _Members({required this.rows, required this.money});

  final List<ReportMember> rows;
  final Money money;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final colors = [p.ink, p.accent, p.positive, p.warning, p.muted];
    final withSpend = rows.where((r) => r.sharePct > 0).toList();
    return Column(children: [
      if (withSpend.isNotEmpty)
        ClipRRect(
          borderRadius: BorderRadius.circular(6),
          child: SizedBox(
            height: 14,
            child: Row(children: [
              for (final (i, r) in rows.indexed)
                if (r.sharePct > 0)
                  Expanded(
                    flex: (r.sharePct * 10).round().clamp(1, 1000),
                    child: Container(color: colors[i % colors.length]),
                  ),
            ]),
          ),
        ),
      const SizedBox(height: 8),
      for (final (i, r) in rows.indexed)
        ListRow(
          topBorder: i > 0,
          leading: Container(
            width: 10,
            height: 10,
            decoration: BoxDecoration(color: colors[i % colors.length], shape: BoxShape.circle),
          ),
          title: r.name,
          subtitle: '${r.shareDisplay} · ${r.count} ${r.count == 1 ? 'entry' : 'entries'}'
              '${r.compare != null ? ' · ${money.signed(r.compare!.delta)}' : ''}',
          trailing: Text(money(r.spent), style: LedgerText.body(tabular: true)),
        ),
    ]);
  }
}

/// Weekly columns, weekend share and the biggest day.
class _Rhythm extends StatelessWidget {
  const _Rhythm({required this.rhythm, required this.compareLabel, required this.money});

  final ReportRhythm rhythm;
  final String? compareLabel;
  final Money money;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final weeks = rhythm.weeks;
    final max = weeks.fold<double>(0, (m, w) => w.total > m ? w.total : m);
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      if (weeks.length > 1)
        Semantics(
          label: 'Spending by week',
          child: SizedBox(
            height: 110,
            child: Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
              for (final w in weeks)
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 2),
                    child: Column(mainAxisAlignment: MainAxisAlignment.end, children: [
                      Container(
                        height: max > 0 ? 80 * (w.total / max) + 2 : 2,
                        decoration: BoxDecoration(color: p.ink, borderRadius: BorderRadius.circular(3)),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        w.label.replaceFirst('Week of ', ''),
                        maxLines: 1,
                        overflow: TextOverflow.clip,
                        style: LedgerText.body(size: 10, color: p.muted),
                      ),
                    ]),
                  ),
                ),
            ]),
          ),
        ),
      ListRow(
        title: 'Weekends: ${rhythm.weekendShareDisplay} of spending',
        subtitle: rhythm.baseWeekendShareDisplay != null && compareLabel != null
            ? '${rhythm.baseWeekendShareDisplay} in $compareLabel'
            : null,
      ),
      ListRow(
        title: 'Biggest day: ${rhythm.biggestDayLabel}',
        subtitle: '${rhythm.biggestDayCount} ${rhythm.biggestDayCount == 1 ? 'entry' : 'entries'}',
        trailing: Text(money(rhythm.biggestDayTotal), style: LedgerText.body(tabular: true)),
      ),
    ]);
  }
}

class _Notable extends StatelessWidget {
  const _Notable({required this.notable, required this.money});

  final ReportNotable notable;
  final Money money;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    Widget entry(ReportEntry e, {String? note, bool first = false}) => ListRow(
          topBorder: !first,
          title: e.label,
          subtitle: [e.categoryName, e.dateLabel, e.memberName, ?note].join(' · '),
          trailing: Row(mainAxisSize: MainAxisSize.min, children: [
            Text(money(e.amount), style: LedgerText.body(tabular: true)),
            Icon(Icons.chevron_right, size: 18, color: p.muted),
          ]),
          onTap: () => context.push('/edit/${e.id}'),
        );
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      if (notable.largest.isNotEmpty) ...[
        Text('LARGEST', style: LedgerText.eyebrow(p.muted)),
        for (final (i, e) in notable.largest.indexed) entry(e, first: i == 0),
      ],
      if (notable.anomalies.isNotEmpty) ...[
        const SizedBox(height: 12),
        Text('UNUSUAL', style: LedgerText.eyebrow(p.muted)),
        for (final (i, a) in notable.anomalies.indexed)
          entry(a.entry, note: '${a.timesTypicalDisplay} the usual ${money.text(a.typicalAmountDisplay)}', first: i == 0),
      ],
      if (notable.duplicates.isNotEmpty) ...[
        const SizedBox(height: 12),
        Text('POSSIBLE DUPLICATES', style: LedgerText.eyebrow(p.muted)),
        for (final (i, d) in notable.duplicates.indexed)
          ListRow(
            topBorder: i > 0,
            title: '${d.label} × ${d.count}',
            subtitle: '${d.dateLabel} · ${money.text(d.amountDisplay)} each',
            trailing: Icon(Icons.chevron_right, size: 18, color: p.muted),
            onTap: d.transactionIds.isEmpty ? null : () => context.push('/edit/${d.transactionIds.last}'),
          ),
      ],
    ]);
  }
}

class _Bills extends StatelessWidget {
  const _Bills({required this.bills, required this.money});

  final ReportBills bills;
  final Money money;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return Column(children: [
      for (final (i, b) in bills.paid.indexed)
        ListRow(
          topBorder: i > 0,
          title: b.label,
          subtitle: '${b.categoryName} · ${b.cadence} · paid ${b.dateLabel}',
          trailing: Text(money(b.amount), style: LedgerText.body(tabular: true)),
        ),
      for (final b in bills.missed)
        ListRow(
          title: b.label,
          subtitle: 'Not recorded · expected around ${b.dateLabel}',
          trailing: Text(money(b.amount), style: LedgerText.body(tabular: true, color: p.warning)),
        ),
      for (final b in bills.priceChanges)
        ListRow(
          title: '${b.label} price ${b.up ? 'went up' : 'went down'}',
          subtitle: '${money.text(b.previousAmountDisplay)} → ${money.text(b.currentAmountDisplay)} (${b.deltaPctDisplay})',
        ),
    ]);
  }
}

class _Budgets extends StatelessWidget {
  const _Budgets({required this.budgets, required this.money});

  final ReportBudgets budgets;
  final Money money;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return Column(children: [
      for (final (i, b) in budgets.rows.indexed)
        ListRow(
          topBorder: i > 0,
          title: b.categoryName,
          subtitle: '${money(b.spent)} of ${money(b.budget)} · ${b.usedPctDisplay}'
              '${b.baseUsedPctDisplay != null && budgets.baseLabel != null ? ' (${b.baseUsedPctDisplay} in ${budgets.baseLabel})' : ''}',
          below: ProgressBar(
            fraction: b.budget > 0 ? b.spent / b.budget : 0,
            height: 4,
            color: b.status == 'over' ? p.danger : (b.status == 'will_cross' ? p.warning : p.positive),
          ),
          trailing: b.status == 'over' ? Pill('Over', color: p.danger) : null,
        ),
    ]);
  }
}
