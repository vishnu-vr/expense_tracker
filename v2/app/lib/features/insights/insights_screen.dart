import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/providers.dart';
import '../../core/data/repositories.dart';
import '../../core/domain/analysis.dart';
import '../../core/domain/models.dart';
import '../../core/domain/recurring_expenses.dart';
import '../../core/format/money.dart';
import '../../core/theme/ledger_theme.dart';
import '../../core/widgets/category_icon.dart';
import '../../core/widgets/common.dart';
import 'category_detail_sheet.dart';

enum _View { breakdown, trends }

class InsightsScreen extends ConsumerStatefulWidget {
  const InsightsScreen({super.key});

  @override
  ConsumerState<InsightsScreen> createState() => _InsightsScreenState();
}

class _InsightsScreenState extends ConsumerState<InsightsScreen> {
  var _view = _View.breakdown;
  String? _userId;

  // Breakdown period: a calendar month, or a custom range when [_range] is set.
  DateTime? _month;
  DateTimeRange? _range;

  var _trendMonths = 6;
  final _scroll = ScrollController();

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _pickRange(DateTime now) async {
    final picked = await showDateRangePicker(
      context: context,
      firstDate: DateTime(2000),
      lastDate: DateTime(now.year + 1, 12, 31),
      initialDateRange: _range,
    );
    if (picked != null) setState(() => _range = picked);
  }

  @override
  Widget build(BuildContext context) {
    final now = ref.watch(nowProvider);
    final txs = ref.watch(transactionsProvider).value;
    final members = ref.watch(membersProvider).value ?? const <Member>[];

    return Scaffold(
      appBar: AppBar(
        titleSpacing: 24,
        title: const Text('Insights'),
        actions: [
          TextButton.icon(
            onPressed: () => context.push('/ask'),
            icon: const Icon(Icons.auto_awesome_outlined, size: 18),
            label: const Text('Ask'),
          ),
          const SizedBox(width: 12),
        ],
      ),
      body: txs == null
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              controller: _scroll,
              padding: const EdgeInsets.fromLTRB(24, 12, 24, 24),
              children: [
                Segmented<_View>(
                  options: const {_View.breakdown: 'Breakdown', _View.trends: 'Trends'},
                  selected: _view,
                  onChanged: (v) => setState(() => _view = v),
                ),
                if (members.length > 1)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      child: Row(children: [
                        Pill('Everyone',
                            selected: _userId == null,
                            onTap: () => setState(() => _userId = null)),
                        for (final m in members) ...[
                          const SizedBox(width: 8),
                          Pill(ref.watch(memberNameProvider)(m.id),
                              selected: _userId == m.id,
                              onTap: () => setState(() => _userId = m.id)),
                        ],
                      ]),
                    ),
                  ),
                if (_view == _View.breakdown)
                  ..._breakdown(context, txs, now)
                else
                  ..._trends(context, txs, now),
              ],
            ),
    );
  }

  List<Widget> _breakdown(BuildContext context, List<Transaction> txs, DateTime now) {
    final p = context.palette;
    final money = ref.watch(moneyProvider);
    final categories = ref.watch(categoryByIdProvider);
    final month = _month ?? DateTime(now.year, now.month);
    final start = _range?.start ?? month;
    final end = _range == null
        ? DateTime(month.year, month.month + 1)
        : DateTime(_range!.end.year, _range!.end.month, _range!.end.day + 1);
    final b = categoryBreakdown(txs, start: start, end: end, userId: _userId);

    return [
      if (_range == null)
        PeriodNav(
          label: monthYear(month),
          onPrevious: () => setState(() => _month = DateTime(month.year, month.month - 1)),
          onNext: () => setState(() => _month = DateTime(month.year, month.month + 1)),
          onTapLabel: () => _pickRange(now),
        )
      else
        Row(children: [
          Expanded(
            child: TextButton(
              onPressed: () => _pickRange(now),
              child: Text('${shortDate(_range!.start)} – ${shortDate(_range!.end)}',
                  style: LedgerText.display(size: 16)),
            ),
          ),
          IconButton(
            tooltip: 'Back to monthly view',
            onPressed: () => setState(() => _range = null),
            icon: const Icon(Icons.close, size: 20),
          ),
        ]),
      if (b.total <= 0)
        const EmptyState('No expenses in this period.')
      else ...[
        const SizedBox(height: 8),
        SizedBox(
          height: 200,
          child: Stack(alignment: Alignment.center, children: [
            ExcludeSemantics(
              child: PieChart(
                PieChartData(
                  startDegreeOffset: -90,
                  sectionsSpace: 2,
                  centerSpaceRadius: 68,
                  sections: [
                    for (final c in b.categories)
                      PieChartSectionData(
                        value: c.total,
                        color: colorFromHex(categories[c.categoryId]?.color),
                        radius: 26,
                        showTitle: false,
                      ),
                  ],
                ),
              ),
            ),
            Column(mainAxisSize: MainAxisSize.min, children: [
              Text('SPENT', style: LedgerText.eyebrow(p.muted)),
              const SizedBox(height: 2),
              SizedBox(
                width: 120,
                child: FittedBox(
                  fit: BoxFit.scaleDown,
                  child: Text(money(b.total), style: LedgerText.display(size: 24)),
                ),
              ),
            ]),
          ]),
        ),
        const SizedBox(height: 16),
        for (final c in b.categories)
          InkWell(
            onTap: () => showCategoryDetailSheet(
              context,
              category: categories[c.categoryId],
              transactions:
                  b.transactions.where((t) => t.categoryId == c.categoryId).toList(),
            ),
            child: Container(
              padding: const EdgeInsets.symmetric(vertical: 12),
              decoration: BoxDecoration(border: Border(top: BorderSide(color: p.line))),
              child: Column(children: [
                Row(children: [
                  CategoryIcon(category: categories[c.categoryId], size: 36),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(categories[c.categoryId]?.name ?? 'Uncategorized',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: LedgerText.body(weight: 500)),
                      Text('${c.count} ${c.count == 1 ? 'entry' : 'entries'}',
                          style: LedgerText.body(size: 12, color: p.muted)),
                    ]),
                  ),
                  Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                    Text(money(c.total), style: LedgerText.body(tabular: true)),
                    Text('${(c.share * 100).round()}%',
                        style: LedgerText.body(size: 12, color: p.muted, tabular: true)),
                  ]),
                ]),
                const SizedBox(height: 8),
                ProgressBar(
                  fraction: c.share,
                  height: 4,
                  color: colorFromHex(categories[c.categoryId]?.color),
                ),
              ]),
            ),
          ),
      ],
    ];
  }

  List<Widget> _trends(BuildContext context, List<Transaction> txs, DateTime now) {
    final p = context.palette;
    final money = ref.watch(moneyProvider);
    final categories = ref.watch(categoryByIdProvider);
    final t = computeTrends(txs, now: now, monthCount: _trendMonths, userId: _userId);
    String cat(String? id) => categories[id]?.name ?? 'Uncategorized';
    String mon(DateTime m) => '${shortMonth(m.month)} ${m.year}';

    final start = t.months.first.month;
    final recurring = detectRecurringExpenses(
      txs.where((x) => !x.date.isBefore(start)),
      (id) => categories[id]?.name ?? '',
      maxResults: 6,
      userId: _userId,
    );
    final maxTotal = t.months.fold(0.0, (m, b) => b.total > m ? b.total : m);

    final notes = <(String, String)>[
      if (t.peak != null) ('Peak month', '${mon(t.peak!.month)} at ${money(t.peak!.total)}'),
      if (t.lowest != null)
        ('Lowest month', '${mon(t.lowest!.month)} at ${money(t.lowest!.total)}'),
      if (t.biggestSpike != null)
        (
          'Biggest jump',
          '${mon(t.biggestSpike!.month)} was up ${money(t.biggestSpike!.delta)} '
              '(${t.biggestSpike!.pct.round()}%) on the month before'
        ),
      if (t.biggestDrop != null)
        (
          'Biggest drop',
          '${mon(t.biggestDrop!.month)} was down ${money(t.biggestDrop!.delta)} '
              '(${t.biggestDrop!.pct.abs().round()}%) on the month before'
        ),
      if (t.topCategoryId != null)
        (
          'Top category',
          '${cat(t.topCategoryId)} at ${money(t.topCategoryTotal)}, '
              '${(t.topCategoryTotal / t.total * 100).round()}% of spending'
        ),
      if (t.risingCategoryId != null)
        ('Rising', '${cat(t.risingCategoryId)} has gone up three months in a row'),
    ];

    return [
      const SizedBox(height: 12),
      Segmented<int>(
        options: const {3: '3 months', 6: '6 months', 12: '12 months'},
        selected: _trendMonths,
        onChanged: (m) => setState(() => _trendMonths = m),
      ),
      const SizedBox(height: 16),
      if (!t.hasData)
        const EmptyState('No expenses in this period.')
      else ...[
        Container(
          padding: const EdgeInsets.only(bottom: 16),
          decoration: BoxDecoration(border: Border(bottom: BorderSide(color: p.ink))),
          child: Row(children: [
            Expanded(child: _Figure(label: 'TOTAL', value: money(t.total))),
            Expanded(
              child: _Figure(label: 'AVERAGE A MONTH', value: money(t.monthlyAverage.round())),
            ),
          ]),
        ),
        const SizedBox(height: 16),
        const SectionTitle('By month'),
        for (final m in t.months.reversed)
          InkWell(
            onTap: m.total <= 0
                ? null
                : () {
                    setState(() {
                      _view = _View.breakdown;
                      _range = null;
                      _month = m.month;
                    });
                    _scroll.jumpTo(0);
                  },
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Row(children: [
                SizedBox(
                  width: 68,
                  child: Text(mon(m.month), style: LedgerText.body(size: 13, color: p.muted)),
                ),
                Expanded(
                  child: ProgressBar(
                    fraction: maxTotal > 0 ? m.total / maxTotal : 0,
                    height: 12,
                    color: p.ink,
                  ),
                ),
                SizedBox(
                  width: 84,
                  child: Text(
                    m.total > 0 ? money(m.total) : '—',
                    textAlign: TextAlign.right,
                    style: LedgerText.body(size: 13, tabular: true),
                  ),
                ),
              ]),
            ),
          ),
        const SizedBox(height: 16),
        const SectionTitle('What stands out'),
        for (final n in notes)
          ListRow(
            title: n.$1,
            below: Text(n.$2, style: LedgerText.body(size: 13, color: p.muted, height: 1.4)),
          ),
        if (recurring.isNotEmpty) ...[
          const SizedBox(height: 16),
          const SectionTitle('Recurring'),
          for (final r in recurring)
            ListRow(
              title: r.label,
              subtitle: '${r.categoryName} · ${r.cadenceLabel} · ${r.occurrences} payments, '
                  'latest ${shortDate(r.lastPaidDate, now)}',
              trailing: Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(money(r.averageAmount.round()), style: LedgerText.body(tabular: true)),
                  Text('average', style: LedgerText.body(size: 11, color: p.muted)),
                ],
              ),
            ),
        ],
      ],
    ];
  }
}

class _Figure extends StatelessWidget {
  const _Figure({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(label, style: LedgerText.eyebrow(context.palette.muted)),
      const SizedBox(height: 4),
      FittedBox(
        fit: BoxFit.scaleDown,
        alignment: Alignment.centerLeft,
        child: Text(value, style: LedgerText.display(size: 24, letterSpacing: -0.4)),
      ),
    ]);
  }
}
