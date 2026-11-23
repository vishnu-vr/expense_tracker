/// Expense reports (D-033): the saved report as the app reads it, and the
/// period and comparison choices of the New report sheet. Pure Dart.
///
/// Every figure is computed by the server (`backend/functions/src/core/report.ts`).
/// Parsing is lenient: unknown sections and fields are skipped and malformed
/// rows dropped, so the server can add sections without breaking older builds.
library;

// ---------------------------------------------------------------- parsing

Map<String, dynamic>? _map(Object? v) => v is Map ? Map<String, dynamic>.from(v) : null;
List<Map<String, dynamic>> _maps(Object? v) =>
    v is List ? [for (final e in v) ?_map(e)] : const [];
String? _str(Object? v) => v is String && v.isNotEmpty ? v : null;
String _s(Object? v, [String fallback = '']) => v is String ? v : fallback;
double? _num(Object? v) => v is num && v.isFinite ? v.toDouble() : null;
double _n(Object? v) => _num(v) ?? 0;
int _int(Object? v) => v is num && v.isFinite ? v.round() : 0;
List<String> _strings(Object? v) => v is List ? [for (final e in v) if (e is String && e.isNotEmpty) e] : const [];

/// Parses each row with [f], dropping any that throw.
List<T> _rows<T>(Object? v, T? Function(Map<String, dynamic>) f) {
  final out = <T>[];
  for (final m in _maps(v)) {
    try {
      final r = f(m);
      if (r != null) out.add(r);
    } catch (_) {}
  }
  return out;
}

// ---------------------------------------------------------------- shapes

/// This period against the baseline. All deltas are this − baseline.
class FigureCompare {
  const FigureCompare({
    required this.base,
    required this.baseDisplay,
    required this.delta,
    required this.deltaDisplay,
    this.deltaPct,
    this.deltaPctDisplay,
  });

  final double base;
  final String baseDisplay;
  final double delta;
  final String deltaDisplay;
  final double? deltaPct;
  final String? deltaPctDisplay;

  static FigureCompare? fromJson(Object? v) {
    final m = _map(v);
    if (m == null || _num(m['delta']) == null) return null;
    return FigureCompare(
      base: _n(m['base']),
      baseDisplay: _s(m['baseDisplay']),
      delta: _n(m['delta']),
      deltaDisplay: _s(m['deltaDisplay']),
      deltaPct: _num(m['deltaPct']),
      deltaPctDisplay: _str(m['deltaPctDisplay']),
    );
  }
}

class ReportMetric {
  const ReportMetric({required this.key, required this.label, this.value, this.display, this.compare});

  final String key;
  final String label;
  final double? value;
  final String? display;
  final FigureCompare? compare;

  /// Spending and per-day spending going up is bad news; everything else going up is good.
  bool get higherIsWorse => key == 'spent' || key == 'dailyAverage';
}

class ReportCategory {
  const ReportCategory({
    required this.categoryId,
    required this.name,
    required this.total,
    required this.shareDisplay,
    required this.count,
    this.compare,
    this.status,
  });

  final String categoryId;
  final String name;
  final double total;
  final String shareDisplay;
  final int count;
  final FigureCompare? compare;

  /// `new`, `gone` or null.
  final String? status;
}

class ReportMember {
  const ReportMember({
    required this.memberId,
    required this.name,
    required this.spent,
    required this.sharePct,
    required this.shareDisplay,
    required this.count,
    this.compare,
  });

  final String memberId;
  final String name;
  final double spent;
  final double sharePct;
  final String shareDisplay;
  final int count;
  final FigureCompare? compare;
}

class ReportWeek {
  const ReportWeek({required this.weekStart, required this.label, required this.total});

  final String weekStart;
  final String label;
  final double total;
}

class ReportRhythm {
  const ReportRhythm({
    required this.weeks,
    required this.weekendShareDisplay,
    this.baseWeekendShareDisplay,
    required this.biggestDayLabel,
    required this.biggestDayTotal,
    required this.biggestDayCount,
  });

  final List<ReportWeek> weeks;
  final String weekendShareDisplay;
  final String? baseWeekendShareDisplay;
  final String biggestDayLabel;
  final double biggestDayTotal;
  final int biggestDayCount;
}

class ReportMerchant {
  const ReportMerchant({
    required this.name,
    required this.total,
    required this.count,
    required this.rank,
    this.rankChange,
    this.isNew = false,
  });

  final String name;
  final double total;
  final int count;
  final int rank;
  final int? rankChange;
  final bool isNew;
}

class ReportEntry {
  const ReportEntry({
    required this.id,
    required this.dateLabel,
    required this.label,
    required this.categoryName,
    required this.amount,
    required this.memberName,
    this.isIncome = false,
  });

  final String id;
  final String dateLabel;
  final String label;
  final String categoryName;
  final double amount;
  final String memberName;
  final bool isIncome;

  static ReportEntry? fromJson(Map<String, dynamic> m) {
    final id = _str(m['id']);
    if (id == null) return null;
    return ReportEntry(
      id: id,
      dateLabel: _s(m['dateLabel']),
      label: _s(m['label']),
      categoryName: _s(m['categoryName']),
      amount: _n(m['amount']),
      memberName: _s(m['memberName']),
      isIncome: m['type'] == 'income',
    );
  }
}

class ReportAnomaly {
  const ReportAnomaly({required this.entry, required this.typicalAmountDisplay, required this.timesTypicalDisplay, required this.basisLabel});

  final ReportEntry entry;
  final String typicalAmountDisplay;
  final String timesTypicalDisplay;
  final String basisLabel;
}

class ReportDuplicate {
  const ReportDuplicate({required this.dateLabel, required this.label, required this.amountDisplay, required this.count, required this.transactionIds});

  final String dateLabel;
  final String label;
  final String amountDisplay;
  final int count;
  final List<String> transactionIds;
}

class ReportNotable {
  const ReportNotable({this.largest = const [], this.anomalies = const [], this.duplicates = const []});

  final List<ReportEntry> largest;
  final List<ReportAnomaly> anomalies;
  final List<ReportDuplicate> duplicates;
}

class ReportBill {
  const ReportBill({required this.label, required this.categoryName, required this.cadence, required this.amount, required this.dateLabel, this.count = 0});

  final String label;
  final String categoryName;
  final String cadence;
  final double amount;
  final String dateLabel;
  final int count;
}

class ReportPriceChange {
  const ReportPriceChange({required this.label, required this.previousAmountDisplay, required this.currentAmountDisplay, required this.deltaPctDisplay, required this.up});

  final String label;
  final String previousAmountDisplay;
  final String currentAmountDisplay;
  final String deltaPctDisplay;
  final bool up;
}

class ReportBills {
  const ReportBills({this.paid = const [], this.missed = const [], this.priceChanges = const []});

  final List<ReportBill> paid;
  final List<ReportBill> missed;
  final List<ReportPriceChange> priceChanges;
}

class ReportBudget {
  const ReportBudget({
    required this.categoryId,
    required this.categoryName,
    required this.budget,
    required this.spent,
    required this.usedPct,
    required this.usedPctDisplay,
    required this.status,
    this.baseUsedPctDisplay,
  });

  final String categoryId;
  final String categoryName;
  final double budget;
  final double spent;
  final double usedPct;
  final String usedPctDisplay;

  /// `over`, `will_cross` or `within`.
  final String status;
  final String? baseUsedPctDisplay;
}

class ReportBudgets {
  const ReportBudgets({required this.monthLabel, required this.rows, required this.totalUsedPctDisplay, this.baseLabel});

  final String monthLabel;
  final List<ReportBudget> rows;
  final String totalUsedPctDisplay;
  final String? baseLabel;
}

class ReportTag {
  const ReportTag({required this.tagId, required this.name, required this.total, required this.count, this.compare});

  final String tagId;
  final String name;
  final double total;
  final int count;
  final FigureCompare? compare;
}

class ReportNarrative {
  const ReportNarrative({required this.headline, required this.summary, this.changes = const [], this.suggestions = const []});

  final String headline;
  final String summary;
  final List<String> changes;
  final List<String> suggestions;
}

class ReportCompareInfo {
  const ReportCompareInfo({required this.mode, required this.label, required this.from, required this.to, this.periods = 1, this.periodsUsed = 1});

  final String mode;
  final String label;
  final String from;
  final String to;
  final int periods;
  final int periodsUsed;
}

/// One row of the reports list.
class ReportSummary {
  const ReportSummary({
    required this.id,
    required this.kind,
    required this.periodLabel,
    required this.from,
    required this.to,
    this.compareLabel,
    this.headline,
    required this.generatedAt,
  });

  final String id;

  /// `monthly` or `custom`.
  final String kind;
  final String periodLabel;
  final String from;
  final String to;
  final String? compareLabel;
  final String? headline;
  final DateTime generatedAt;

  bool get isMonthly => kind == 'monthly';
}

class Report {
  const Report({
    required this.summary,
    this.compare,
    required this.metrics,
    this.baselineNote,
    required this.narrative,
    required this.fromModel,
    this.modelLabel,
    this.categories = const [],
    this.members = const [],
    this.rhythm,
    this.merchantsBySpend = const [],
    this.merchantsByVisits = const [],
    this.notable,
    this.bills,
    this.budgets,
    this.tags = const [],
    this.periodDays = 0,
  });

  final ReportSummary summary;
  final ReportCompareInfo? compare;
  final List<ReportMetric> metrics;
  final String? baselineNote;
  final ReportNarrative narrative;

  /// False when the narrative was built from the figures (model unavailable).
  final bool fromModel;
  final String? modelLabel;
  final List<ReportCategory> categories;
  final List<ReportMember> members;
  final ReportRhythm? rhythm;
  final List<ReportMerchant> merchantsBySpend;
  final List<ReportMerchant> merchantsByVisits;
  final ReportNotable? notable;
  final ReportBills? bills;
  final ReportBudgets? budgets;
  final List<ReportTag> tags;
  final int periodDays;

  String get id => summary.id;

  ReportMetric? metric(String key) => metrics.where((m) => m.key == key).firstOrNull;

  /// "Written by Gemini Flash" or a note that the figures wrote it.
  String get writtenBy =>
      fromModel && modelLabel != null ? 'Written by $modelLabel' : 'Summary built from the figures';

  /// A question for the assistant about the same periods.
  String get askQuestion {
    final c = compare;
    final period = 'from ${summary.from} to ${summary.to}';
    return c == null
        ? 'Tell me more about my spending $period.'
        : 'Compare my spending $period with ${c.from} to ${c.to}. What changed and why?';
  }

  /// [data] is the report document with timestamps already converted to
  /// [DateTime] (see `reportFromDoc`). Null when it is unusable.
  static Report? fromJson(String id, Map<String, dynamic> data) {
    final period = _map(data['period']);
    final from = _str(period?['from']);
    final to = _str(period?['to']);
    if (from == null || to == null) return null;
    final at = data['generatedAt'] is DateTime
        ? data['generatedAt'] as DateTime
        : data['createdAt'] is DateTime
            ? data['createdAt'] as DateTime
            : null;
    if (at == null) return null;
    final c = _map(data['compare']);
    final n = _map(data['narrative']) ?? const {};
    final s = _map(data['sections']) ?? const {};
    final head = _map(s['headline']) ?? const {};
    final narrative = ReportNarrative(
      headline: _s(n['headline']),
      summary: _s(n['summary']),
      changes: _strings(n['changes']),
      suggestions: _strings(n['suggestions']),
    );
    final summary = ReportSummary(
      id: id,
      kind: data['kind'] == 'monthly' ? 'monthly' : 'custom',
      periodLabel: _s(period?['label'], '$from – $to'),
      from: from,
      to: to,
      compareLabel: _str(c?['label']),
      headline: _str(narrative.headline),
      generatedAt: at,
    );
    final rhythm = _map(s['rhythm']);
    final bigDay = _map(rhythm?['biggestDay']);
    final merchants = _map(s['merchants']);
    ReportMerchant merchant(Map<String, dynamic> m) => ReportMerchant(
          name: _s(m['name']),
          total: _n(m['total']),
          count: _int(m['count']),
          rank: _int(m['rank']),
          rankChange: m['rankChange'] is num ? _int(m['rankChange']) : null,
          isNew: m['isNew'] == true,
        );
    final notable = _map(s['notable']);
    final bills = _map(s['bills']);
    ReportBill bill(Map<String, dynamic> m) => ReportBill(
          label: _s(m['label']),
          categoryName: _s(m['categoryName']),
          cadence: _s(m['cadence']),
          amount: _n(m['amount']),
          dateLabel: _s(m['dateLabel']),
          count: _int(m['count']),
        );
    final budgets = _map(s['budgets']);
    return Report(
      summary: summary,
      periodDays: _int(period?['days']),
      compare: c == null || _str(c['label']) == null
          ? null
          : ReportCompareInfo(
              mode: _s(c['mode']),
              label: _s(c['label']),
              from: _s(c['from']),
              to: _s(c['to']),
              periods: _int(c['periods']),
              periodsUsed: _int(c['periodsUsed']),
            ),
      metrics: _rows(head['metrics'], (m) {
        final key = _str(m['key']);
        if (key == null) return null;
        return ReportMetric(
          key: key,
          label: _s(m['label'], key),
          value: _num(m['value']),
          display: _str(m['display']),
          compare: FigureCompare.fromJson(m['compare']),
        );
      }),
      baselineNote: _str(head['baselineNote']),
      narrative: narrative,
      fromModel: data['narrativeSource'] == 'model',
      modelLabel: _str(data['modelLabel']),
      categories: _rows(_map(s['categories'])?['rows'], (m) => ReportCategory(
            categoryId: _s(m['categoryId']),
            name: _s(m['name'], 'Uncategorized'),
            total: _n(m['total']),
            shareDisplay: _s(m['shareDisplay']),
            count: _int(m['count']),
            compare: FigureCompare.fromJson(m['compare']),
            status: _str(m['status']),
          )),
      members: _rows(_map(s['members'])?['rows'], (m) => ReportMember(
            memberId: _s(m['memberId']),
            name: _s(m['name'], 'Member'),
            spent: _n(m['spent']),
            sharePct: _n(m['sharePct']),
            shareDisplay: _s(m['shareDisplay']),
            count: _int(m['count']),
            compare: FigureCompare.fromJson(m['compare']),
          )),
      rhythm: rhythm == null || bigDay == null
          ? null
          : ReportRhythm(
              weeks: _rows(rhythm['weeks'], (m) => ReportWeek(
                    weekStart: _s(m['weekStart']),
                    label: _s(m['label']),
                    total: _n(m['total']),
                  )),
              weekendShareDisplay: _s(rhythm['weekendShareDisplay']),
              baseWeekendShareDisplay: _str(rhythm['baseWeekendShareDisplay']),
              biggestDayLabel: _s(bigDay['label']),
              biggestDayTotal: _n(bigDay['total']),
              biggestDayCount: _int(bigDay['count']),
            ),
      merchantsBySpend: _rows(merchants?['bySpend'], merchant),
      merchantsByVisits: _rows(merchants?['byVisits'], merchant),
      notable: notable == null
          ? null
          : ReportNotable(
              largest: _rows(notable['largest'], ReportEntry.fromJson),
              anomalies: _rows(notable['anomalies'], (m) {
                final e = _map(m['entry']);
                final entry = e == null ? null : ReportEntry.fromJson(e);
                if (entry == null) return null;
                return ReportAnomaly(
                  entry: entry,
                  typicalAmountDisplay: _s(m['typicalAmountDisplay']),
                  timesTypicalDisplay: _s(m['timesTypicalDisplay']),
                  basisLabel: _s(m['basisLabel']),
                );
              }),
              duplicates: _rows(notable['duplicates'], (m) => ReportDuplicate(
                    dateLabel: _s(m['dateLabel']),
                    label: _s(m['label']),
                    amountDisplay: _s(m['amountDisplay']),
                    count: _int(m['count']),
                    transactionIds: _strings(m['transactionIds']),
                  )),
            ),
      bills: bills == null
          ? null
          : ReportBills(
              paid: _rows(bills['paid'], bill),
              missed: _rows(bills['missed'], bill),
              priceChanges: _rows(bills['priceChanges'], (m) => ReportPriceChange(
                    label: _s(m['label']),
                    previousAmountDisplay: _s(m['previousAmountDisplay']),
                    currentAmountDisplay: _s(m['currentAmountDisplay']),
                    deltaPctDisplay: _s(m['deltaPctDisplay']),
                    up: m['direction'] == 'up',
                  )),
            ),
      budgets: budgets == null
          ? null
          : ReportBudgets(
              monthLabel: _s(budgets['monthLabel']),
              totalUsedPctDisplay: _s(budgets['totalUsedPctDisplay']),
              baseLabel: _str(budgets['baseLabel']),
              rows: _rows(budgets['rows'], (m) => ReportBudget(
                    categoryId: _s(m['categoryId']),
                    categoryName: _s(m['categoryName']),
                    budget: _n(m['budget']),
                    spent: _n(m['spent']),
                    usedPct: _n(m['usedPct']),
                    usedPctDisplay: _s(m['usedPctDisplay']),
                    status: _s(m['status'], 'within'),
                    baseUsedPctDisplay: _str(_map(m['base'])?['usedPctDisplay']),
                  )),
            ),
      tags: _rows(_map(s['tags'])?['rows'], (m) => ReportTag(
            tagId: _s(m['tagId']),
            name: _s(m['name'], 'Tag'),
            total: _n(m['total']),
            count: _int(m['count']),
            compare: FigureCompare.fromJson(m['compare']),
          )),
    );
  }
}

/// Monthly reports first, then custom ones; newest first within each.
List<ReportSummary> sortReports(Iterable<ReportSummary> reports) {
  final list = [...reports];
  list.sort((a, b) {
    if (a.isMonthly != b.isMonthly) return a.isMonthly ? -1 : 1;
    if (a.isMonthly) return b.from.compareTo(a.from);
    return b.generatedAt.compareTo(a.generatedAt);
  });
  return list;
}

// ---------------------------------------------------------------- the New report sheet

const _months = [
  'January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December',
];
String _short(int month) => _months[month - 1].substring(0, 3);

/// Calendar day (time of day dropped).
DateTime _day(DateTime d) => DateTime(d.year, d.month, d.day);

/// `YYYY-MM-DD` of a calendar day, as the callables expect.
String dayKey(DateTime d) =>
    '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

int _daysIn(int year, int month) => DateTime(year, month + 1, 0).day;

/// An inclusive range of calendar days.
class DayRange {
  DayRange(DateTime from, DateTime to) : from = _day(from), to = _day(to);

  final DateTime from;
  final DateTime to;

  int get days => to.difference(from).inDays + 1;

  bool get isWholeMonth =>
      from.day == 1 && from.year == to.year && from.month == to.month && to.day == _daysIn(to.year, to.month);

  bool get isMonthToDate =>
      from.day == 1 && from.year == to.year && from.month == to.month && !isWholeMonth;

  /// "October 2026", "1–23 Nov 2026", "25 Aug – 3 Sep 2026", "3 Mar 2026"; same as the server.
  String get label {
    if (isWholeMonth) return '${_months[from.month - 1]} ${from.year}';
    if (from == to) return '${from.day} ${_short(from.month)} ${from.year}';
    if (from.year == to.year && from.month == to.month) {
      return '${from.day}–${to.day} ${_short(to.month)} ${to.year}';
    }
    if (from.year == to.year) {
      return '${from.day} ${_short(from.month)} – ${to.day} ${_short(to.month)} ${to.year}';
    }
    return '${from.day} ${_short(from.month)} ${from.year} – ${to.day} ${_short(to.month)} ${to.year}';
  }

  @override
  bool operator ==(Object other) => other is DayRange && other.from == from && other.to == to;

  @override
  int get hashCode => Object.hash(from, to);
}

enum ReportPreset { lastMonth, thisMonth, last7, last30, pickMonth, custom }

extension ReportPresetLabel on ReportPreset {
  String get label => switch (this) {
        ReportPreset.lastMonth => 'Last month',
        ReportPreset.thisMonth => 'This month so far',
        ReportPreset.last7 => 'Last 7 days',
        ReportPreset.last30 => 'Last 30 days',
        ReportPreset.pickMonth => 'A month',
        ReportPreset.custom => 'Custom range',
      };
}

/// The period of a preset on [today]. [month] is used by `pickMonth`,
/// [custom] by `custom`; both return null until chosen.
DayRange? presetRange(ReportPreset preset, DateTime today, {DateTime? month, DayRange? custom}) {
  final t = _day(today);
  switch (preset) {
    case ReportPreset.lastMonth:
      return DayRange(DateTime(t.year, t.month - 1, 1), DateTime(t.year, t.month, 0));
    case ReportPreset.thisMonth:
      return DayRange(DateTime(t.year, t.month, 1), t);
    case ReportPreset.last7:
      return DayRange(t.subtract(const Duration(days: 6)), t);
    case ReportPreset.last30:
      return DayRange(t.subtract(const Duration(days: 29)), t);
    case ReportPreset.pickMonth:
      if (month == null) return null;
      final end = DateTime(month.year, month.month + 1, 0);
      return DayRange(DateTime(month.year, month.month, 1), end.isAfter(t) ? t : end);
    case ReportPreset.custom:
      return custom;
  }
}

/// Comparison modes, as sent to `generateReport`.
enum CompareMode { previous, lastYear, average, custom, none }

extension CompareModeKey on CompareMode {
  String get key => switch (this) {
        CompareMode.previous => 'previous',
        CompareMode.lastYear => 'last_year',
        CompareMode.average => 'average',
        CompareMode.custom => 'custom',
        CompareMode.none => 'none',
      };

  String get label => switch (this) {
        CompareMode.previous => 'Previous period',
        CompareMode.lastYear => 'Same time last year',
        CompareMode.average => 'Typical (3-period average)',
        CompareMode.custom => 'Another range',
        CompareMode.none => 'No comparison',
      };
}

DateTime _sameDayClamped(int year, int month, int day) =>
    DateTime(year, month, day > _daysIn(year, month) ? _daysIn(year, month) : day);

/// The baseline the server will use for [period] (same rules as
/// `resolveComparison`), so the sheet can say "vs September 2026" before
/// anything is sent. Average returns its whole span.
DayRange? comparisonRange(DayRange period, CompareMode mode, {DayRange? custom}) {
  final f = period.from;
  final t = period.to;
  DayRange sameDays(int monthsBack) {
    final start = DateTime(f.year, f.month - monthsBack, 1);
    return DayRange(start, _sameDayClamped(start.year, start.month, t.day));
  }

  DayRange windowBefore(int k) =>
      DayRange(f.subtract(Duration(days: period.days * k)), f.subtract(Duration(days: period.days * (k - 1) + 1)));

  switch (mode) {
    case CompareMode.none:
      return null;
    case CompareMode.custom:
      return custom;
    case CompareMode.previous:
      if (period.isWholeMonth) return DayRange(DateTime(f.year, f.month - 1, 1), DateTime(f.year, f.month, 0));
      return period.isMonthToDate ? sameDays(1) : windowBefore(1);
    case CompareMode.lastYear:
      if (period.isWholeMonth) return DayRange(DateTime(f.year - 1, f.month, 1), DateTime(f.year - 1, f.month + 1, 0));
      return DayRange(_sameDayClamped(f.year - 1, f.month, f.day), _sameDayClamped(t.year - 1, t.month, t.day));
    case CompareMode.average:
      if (period.isWholeMonth) return DayRange(DateTime(f.year, f.month - 3, 1), DateTime(f.year, f.month, 0));
      if (period.isMonthToDate) return DayRange(sameDays(3).from, sameDays(1).to);
      return DayRange(windowBefore(3).from, windowBefore(1).to);
  }
}

/// "vs September 2026", "vs a typical month (Jul–Sep 2026)", or null for none.
String? comparisonLabel(DayRange period, CompareMode mode, {DayRange? custom}) {
  final r = comparisonRange(period, mode, custom: custom);
  if (r == null) return null;
  if (mode == CompareMode.average) {
    final span = r.from.year == r.to.year
        ? '${_short(r.from.month)}–${_short(r.to.month)} ${r.to.year}'
        : '${_short(r.from.month)} ${r.from.year}–${_short(r.to.month)} ${r.to.year}';
    if (period.isWholeMonth) return 'vs a typical month ($span)';
    if (period.isMonthToDate) return 'vs the same days in $span, averaged';
    return 'vs the average of the 3 periods before (${r.label})';
  }
  return 'vs ${r.label}';
}

/// Why a period cannot be reported on, or null when it is fine.
String? periodProblem(DayRange? period, DateTime today, {int maxDays = 366}) {
  if (period == null) return 'Pick the dates first.';
  if (period.to.isAfter(_day(today))) return 'A report cannot include future days.';
  if (period.days > maxDays) return 'A report can cover at most $maxDays days.';
  return null;
}
