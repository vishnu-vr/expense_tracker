import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../app/providers.dart';
import '../../core/data/admin.dart';
import '../../core/format/money.dart';
import '../../core/theme/ledger_theme.dart';
import '../../core/widgets/common.dart';

final _count = NumberFormat.decimalPattern('en_IN');
final _compact = NumberFormat.compact(locale: 'en_IN');

/// Formats billing amounts: rupees through [Money]; other currencies as
/// "USD 12.34". Both are masked when "hide amounts" is on.
class _Amounts {
  const _Amounts(this.money, this.currency);

  final Money money;
  final String currency;

  bool get _inr => currency == 'INR';

  String call(double v) {
    if (money.hidden) return hiddenAmount;
    return _inr ? money(v) : '$currency ${v.abs().toStringAsFixed(2)}';
  }

  String signed(double v) {
    if (money.hidden) return hiddenAmount;
    if (_inr) return money.signed(v);
    if (v == 0) return call(0);
    return '${v > 0 ? '+' : '−'}${call(v)}';
  }
}

/// Admin › Billing & usage: what the project costs to run, per month.
class BillingScreen extends ConsumerStatefulWidget {
  const BillingScreen({super.key});

  @override
  ConsumerState<BillingScreen> createState() => _BillingScreenState();
}

class _BillingScreenState extends ConsumerState<BillingScreen> {
  late DateTime _month;
  late DateTime _currentMonth;

  @override
  void initState() {
    super.initState();
    final now = ref.read(nowProvider);
    _currentMonth = DateTime(now.year, now.month);
    _month = _currentMonth;
  }

  void _shift(int delta) => setState(() => _month = DateTime(_month.year, _month.month + delta));

  Future<void> _refresh() async {
    final key = monthKey(_month);
    ref.invalidate(adminDashboardProvider(key));
    try {
      await ref.read(adminDashboardProvider(key).future);
    } catch (_) {
      // Shown by the error state.
    }
  }

  @override
  Widget build(BuildContext context) {
    final key = monthKey(_month);
    final dashboard = ref.watch(adminDashboardProvider(key));
    final atCurrent = !_month.isBefore(_currentMonth);
    final earliest = _month.isBefore(DateTime(2024, 2));

    return Scaffold(
      appBar: AppBar(title: const Text('Billing & usage')),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(20, 4, 20, 32),
          children: [
            PeriodNav(
              label: monthYear(_month),
              onPrevious: earliest ? null : () => _shift(-1),
              onNext: atCurrent ? null : () => _shift(1),
              // Tapping the month jumps back to the current one.
              onTapLabel: () => setState(() => _month = _currentMonth),
            ),
            ...dashboard.when(
              skipLoadingOnRefresh: true,
              loading: () => const [
                Padding(
                  padding: EdgeInsets.symmetric(vertical: 64),
                  child: Center(child: CircularProgressIndicator()),
                ),
              ],
              error: (e, _) => [
                const SizedBox(height: 24),
                EmptyState(
                  e is AdminFailure ? e.message : 'Could not load billing data.',
                  action: 'Retry',
                  onAction: () => ref.invalidate(adminDashboardProvider(key)),
                ),
              ],
              data: (d) => _content(context, d),
            ),
          ],
        ),
      ),
    );
  }

  List<Widget> _content(BuildContext context, AdminDashboard d) {
    final p = context.palette;
    final b = d.billing;
    final amounts = _Amounts(ref.watch(moneyProvider), b.currency);
    return [
      if (d.isSample) ...[
        const Align(alignment: Alignment.centerLeft, child: Pill('Sample data')),
        const SizedBox(height: 12),
      ],
      if (b.configured) ...[
        _Hero(month: _month, billing: b, amounts: amounts),
        const SizedBox(height: 20),
        const SectionTitle('Daily spend'),
        _DailyChart(month: _month, daily: b.daily, amounts: amounts),
        const SizedBox(height: 20),
        const SectionTitle('By service'),
        _ByService(billing: b, amounts: amounts),
        if (b.topSkus.isNotEmpty) ...[
          const SizedBox(height: 12),
          _TopSkus(skus: b.topSkus, amounts: amounts),
        ],
      ] else
        _BillingGapCard(
          gap: b.gap!,
          onRetry: () => ref.invalidate(adminDashboardProvider(monthKey(_month))),
        ),
      const SizedBox(height: 24),
      const SectionTitle('Usage'),
      _Usage(usage: d.usage),
      const SizedBox(height: 16),
      Text(
        'Costs come from the Cloud Billing export to BigQuery and are net of credits. '
        'Usage comes from Cloud Monitoring.',
        style: LedgerText.body(size: 12, color: p.muted, height: 1.4),
      ),
    ];
  }
}

class _Hero extends StatelessWidget {
  const _Hero({required this.month, required this.billing, required this.amounts});

  final DateTime month;
  final BillingSummary billing;
  final _Amounts amounts;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final b = billing;
    final change = b.changeVsPreviousMonth;
    final asOf = b.dataAsOf?.toLocal();
    final line = LedgerText.body(size: 14, color: p.muted, tabular: true, height: 1.35);
    return Container(
      padding: const EdgeInsets.only(bottom: 16),
      decoration: BoxDecoration(border: Border(bottom: BorderSide(color: p.ink))),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('SPENT IN ${monthName(month.month).toUpperCase()}', style: LedgerText.eyebrow(p.muted)),
          const SizedBox(height: 6),
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerLeft,
            child: Text(
              amounts(b.net),
              style: LedgerText.display(size: 48, height: 1, letterSpacing: -1.4),
            ),
          ),
          const SizedBox(height: 10),
          if (b.forecastNet != null)
            Text('About ${amounts(b.forecastNet!)} by month end', style: line),
          if (change != null && b.previousMonthNet != null)
            Text(
              '${amounts.signed(change)} vs last month (${amounts(b.previousMonthNet!)})',
              style: line.copyWith(color: change > 0 ? p.warning : p.positive),
            ),
          if (b.credits != 0)
            Text('${amounts(b.gross)} before ${amounts(b.credits.abs())} in credits', style: line),
          if (asOf != null) ...[
            const SizedBox(height: 6),
            Text(
              'Billing data as of ${shortDate(asOf)}, ${timeOfDay(asOf)}',
              style: LedgerText.body(size: 12, color: p.muted),
            ),
          ],
        ],
      ),
    );
  }
}

class _DailyChart extends StatelessWidget {
  const _DailyChart({required this.month, required this.daily, required this.amounts});

  final DateTime month;
  final List<DailyCost> daily;
  final _Amounts amounts;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final days = DateTime(month.year, month.month + 1, 0).day;
    final byDay = <int, double>{
      for (final d in daily)
        if (d.date.year == month.year && d.date.month == month.month) d.date.day: d.amount,
    };
    final maxY = byDay.values.fold<double>(0, (m, v) => v > m ? v : m);
    if (maxY <= 0) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 12),
        child: Text('No daily costs yet.', style: LedgerText.body(size: 14, color: p.muted)),
      );
    }
    return SizedBox(
      height: 140,
      child: LayoutBuilder(builder: (context, c) {
        final barWidth = (c.maxWidth / days * 0.6).clamp(2.0, 12.0);
        return BarChart(
          BarChartData(
            maxY: maxY * 1.1,
            alignment: BarChartAlignment.spaceBetween,
            gridData: const FlGridData(show: false),
            borderData: FlBorderData(show: true, border: Border(bottom: BorderSide(color: p.line))),
            barTouchData: BarTouchData(
              enabled: !amounts.money.hidden,
              touchTooltipData: BarTouchTooltipData(
                getTooltipColor: (_) => p.ink,
                getTooltipItem: (group, _, rod, _) => BarTooltipItem(
                  '${group.x} ${shortMonth(month.month)}\n${amounts(rod.toY)}',
                  LedgerText.body(size: 12, color: p.onInk, tabular: true),
                ),
              ),
            ),
            titlesData: FlTitlesData(
              leftTitles: const AxisTitles(),
              rightTitles: const AxisTitles(),
              topTitles: const AxisTitles(),
              bottomTitles: AxisTitles(
                sideTitles: SideTitles(
                  showTitles: true,
                  reservedSize: 22,
                  getTitlesWidget: (value, meta) {
                    final day = value.toInt();
                    if (day % 7 != 1) return const SizedBox.shrink(); // 1, 8, 15, 22, 29
                    return SideTitleWidget(
                      meta: meta,
                      child: Text('$day', style: LedgerText.body(size: 11, color: p.muted, tabular: true)),
                    );
                  },
                ),
              ),
            ),
            barGroups: [
              for (var day = 1; day <= days; day++)
                BarChartGroupData(x: day, barRods: [
                  BarChartRodData(
                    toY: byDay[day] ?? 0,
                    width: barWidth,
                    color: p.accent,
                    borderRadius: BorderRadius.vertical(top: Radius.circular(barWidth / 3)),
                  ),
                ]),
            ],
          ),
        );
      }),
    );
  }
}

class _ByService extends StatelessWidget {
  const _ByService({required this.billing, required this.amounts});

  final BillingSummary billing;
  final _Amounts amounts;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final total = billing.byService.fold<double>(0, (s, r) => r.amount > 0 ? s + r.amount : s);
    if (billing.byService.isEmpty) {
      return Text('Nothing billed this month.', style: LedgerText.body(size: 14, color: p.muted));
    }
    return Column(children: [
      for (final (i, s) in billing.byService.indexed)
        _AmountRow(
          topBorder: i > 0,
          title: s.service,
          amount: amounts(s.amount),
          below: ProgressBar(fraction: total > 0 ? s.amount / total : 0, height: 6),
        ),
    ]);
  }
}

/// A ruled row whose title and subtitle may wrap to two lines, with the
/// amount on the right and an optional full-width widget underneath.
class _AmountRow extends StatelessWidget {
  const _AmountRow({required this.title, required this.amount, this.subtitle, this.below, this.topBorder = true});

  final String title;
  final String? subtitle;
  final String amount;
  final Widget? below;
  final bool topBorder;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 10),
      decoration: BoxDecoration(border: topBorder ? Border(top: BorderSide(color: p.line)) : null),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(title, maxLines: 2, overflow: TextOverflow.ellipsis, style: LedgerText.body(weight: 500)),
              if (subtitle != null) ...[
                const SizedBox(height: 2),
                Text(subtitle!,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: LedgerText.body(size: 12, color: p.muted)),
              ],
            ]),
          ),
          const SizedBox(width: 12),
          Text(amount, style: LedgerText.body(weight: 500, tabular: true)),
        ]),
        if (below != null) ...[const SizedBox(height: 8), below!],
      ]),
    );
  }
}

class _TopSkus extends StatefulWidget {
  const _TopSkus({required this.skus, required this.amounts});

  final List<SkuCost> skus;
  final _Amounts amounts;

  @override
  State<_TopSkus> createState() => _TopSkusState();
}

class _TopSkusState extends State<_TopSkus> {
  var _open = false;

  String _usage(SkuCost s) {
    if (s.usage == 0) return s.service;
    final value = s.usage >= 1000 ? _compact.format(s.usage) : _trim(s.usage);
    return '${s.service} · $value ${s.unit}'.trim();
  }

  /// "182", "30.49", "0.81": at most three decimals, no trailing zeros.
  static String _trim(double v) =>
      v.toStringAsFixed(v < 1 ? 3 : 2).replaceFirst(RegExp(r'\.?0+$'), '');

  @override
  Widget build(BuildContext context) {
    return Column(children: [
      SectionTitle(
        'Top SKUs',
        action: _open ? 'Hide' : 'Show ${widget.skus.length}',
        onAction: () => setState(() => _open = !_open),
      ),
      if (_open)
        for (final (i, s) in widget.skus.indexed)
          _AmountRow(topBorder: i > 0, title: s.sku, subtitle: _usage(s), amount: widget.amounts(s.amount)),
    ]);
  }
}

class _BillingGapCard extends StatelessWidget {
  const _BillingGapCard({required this.gap, required this.onRetry});

  final BillingGap gap;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    switch (gap) {
      case BillingGap.noData:
        return const Padding(
          padding: EdgeInsets.only(top: 16),
          child: EmptyState('No billing data for this month. The export starts from the month before it was switched on.'),
        );
      case BillingGap.unavailable:
        return Padding(
          padding: const EdgeInsets.only(top: 16),
          child: EmptyState('Could not read billing data this time.', action: 'Retry', onAction: onRetry),
        );
      case BillingGap.notSetUp:
        final body = LedgerText.body(size: 14, color: p.muted, height: 1.45);
        Widget step(int n, String text) => Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                SizedBox(width: 22, child: Text('$n.', style: body.copyWith(color: p.ink))),
                Expanded(child: Text(text, style: body.copyWith(color: p.ink))),
              ]),
            );
        return Padding(
          padding: const EdgeInsets.only(top: 8),
          child: LedgerCard(
            padding: const EdgeInsets.all(16),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('Billing export not set up', style: LedgerText.display(size: 18)),
              const SizedBox(height: 6),
              Text(
                'Costs show here once Cloud Billing exports to BigQuery. '
                'A billing account admin turns this on once in the Google Cloud console:',
                style: body,
              ),
              step(1, 'Billing › Billing export › BigQuery export.'),
              step(2, 'Standard usage cost › Edit settings.'),
              step(3, 'Project expense-tracker-v2-5c9fa, new dataset billing_export, location US (multi-region).'),
              const SizedBox(height: 10),
              Text(
                'Costs from the start of last month arrive within a few hours; the first export can take up to 5 days.',
                style: body,
              ),
            ]),
          ),
        );
    }
  }
}

class _Usage extends StatelessWidget {
  const _Usage({required this.usage});

  final UsageSummary usage;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final u = usage;
    if (!u.available) {
      return const EmptyState('Usage not available for this month. Cloud Monitoring keeps about six weeks.');
    }
    final figure = LedgerText.body(weight: 500, tabular: true);
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      LayoutBuilder(builder: (context, c) {
        final tile = (c.maxWidth - 12) / 2;
        return Wrap(spacing: 12, runSpacing: 12, children: [
          SizedBox(width: tile, child: _Stat('Assistant questions', _count.format(u.assistantQuestions))),
          SizedBox(width: tile, child: _Stat('Firestore reads', _count.format(u.reads))),
          SizedBox(width: tile, child: _Stat('Firestore writes', _count.format(u.writes))),
          SizedBox(width: tile, child: _Stat('Firestore deletes', _count.format(u.deletes))),
        ]);
      }),
      const SizedBox(height: 16),
      Text('AI TOKENS', style: LedgerText.eyebrow(p.muted)),
      if (u.tokens.isEmpty)
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 8),
          child: Text('No model calls.', style: LedgerText.body(size: 14, color: p.muted)),
        )
      else
        for (final (i, t) in u.tokens.indexed)
          ListRow(
            topBorder: i > 0,
            title: t.model,
            subtitle: 'In ${_count.format(t.input)} · out ${_count.format(t.output)}',
          ),
      const SizedBox(height: 16),
      Text('CALLS PER FUNCTION', style: LedgerText.eyebrow(p.muted)),
      if (u.functionCalls.isEmpty)
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 8),
          child: Text('No function calls.', style: LedgerText.body(size: 14, color: p.muted)),
        )
      else
        for (final (i, f) in u.functionCalls.indexed)
          ListRow(
            topBorder: i > 0,
            title: f.name,
            trailing: Text(_count.format(f.count), style: figure),
          ),
    ]);
  }
}

class _Stat extends StatelessWidget {
  const _Stat(this.label, this.value);

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return LedgerCard(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(label, maxLines: 2, style: LedgerText.body(size: 12, color: p.muted)),
        const SizedBox(height: 4),
        FittedBox(
          fit: BoxFit.scaleDown,
          alignment: Alignment.centerLeft,
          child: Text(value, style: LedgerText.display(size: 20)),
        ),
      ]),
    );
  }
}
