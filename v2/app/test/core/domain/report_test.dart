import 'package:flutter_test/flutter_test.dart';
import 'package:track_expense/core/data/demo_repository.dart';
import 'package:track_expense/core/domain/report.dart';

void main() {
  final today = DateTime(2026, 11, 23, 21);

  group('periods and comparisons (same rules as the server)', () {
    test('presets resolve on today', () {
      expect(presetRange(ReportPreset.lastMonth, today)!.label, 'October 2026');
      expect(presetRange(ReportPreset.thisMonth, today)!.label, '1–23 Nov 2026');
      expect(presetRange(ReportPreset.last7, today)!.label, '17–23 Nov 2026');
      expect(presetRange(ReportPreset.last30, today)!.days, 30);
      expect(presetRange(ReportPreset.pickMonth, today, month: DateTime(2026, 2))!.label, 'February 2026');
      // The current month is cut at today.
      expect(presetRange(ReportPreset.pickMonth, today, month: DateTime(2026, 11))!.label, '1–23 Nov 2026');
      expect(presetRange(ReportPreset.custom, today), isNull);
      expect(DayRange(DateTime(2025, 12, 25), DateTime(2026, 1, 3)).label, '25 Dec 2025 – 3 Jan 2026');
      expect(DayRange(DateTime(2026, 8, 25), DateTime(2026, 9, 3)).label, '25 Aug – 3 Sep 2026');
    });

    test('previous, last year, average and custom labels show the resolved dates', () {
      final oct = presetRange(ReportPreset.lastMonth, today)!;
      expect(comparisonLabel(oct, CompareMode.previous), 'vs September 2026');
      expect(comparisonLabel(oct, CompareMode.lastYear), 'vs October 2025');
      expect(comparisonLabel(oct, CompareMode.average), 'vs a typical month (Jul–Sep 2026)');
      expect(comparisonLabel(oct, CompareMode.none), isNull);
      final custom = DayRange(DateTime(2026, 8, 1), DateTime(2026, 8, 15));
      expect(comparisonLabel(oct, CompareMode.custom, custom: custom), 'vs 1–15 Aug 2026');

      final mtd = presetRange(ReportPreset.thisMonth, today)!;
      expect(comparisonLabel(mtd, CompareMode.previous), 'vs 1–23 Oct 2026');
      expect(comparisonLabel(mtd, CompareMode.average), 'vs the same days in Aug–Oct 2026, averaged');
      // 1–30 March so far: February ends on the 28th.
      expect(comparisonRange(DayRange(DateTime(2026, 3, 1), DateTime(2026, 3, 30)), CompareMode.previous),
          DayRange(DateTime(2026, 2, 1), DateTime(2026, 2, 28)));

      final week = presetRange(ReportPreset.last7, today)!;
      expect(comparisonLabel(week, CompareMode.previous), 'vs 10–16 Nov 2026');
      expect(comparisonRange(week, CompareMode.average)!.label, '27 Oct – 16 Nov 2026');
      expect(comparisonLabel(DayRange(DateTime(2028, 2, 29), DateTime(2028, 3, 5)), CompareMode.lastYear), 'vs 28 Feb – 5 Mar 2027');
    });

    test('problems: future days, more than 366 days, nothing picked', () {
      expect(periodProblem(DayRange(DateTime(2026, 11, 1), DateTime(2026, 11, 24)), today), contains('future'));
      expect(periodProblem(DayRange(DateTime(2025, 11, 22), DateTime(2026, 11, 23)), today), contains('366'));
      expect(periodProblem(DayRange(DateTime(2025, 11, 23), DateTime(2026, 11, 23)), today), isNull);
      expect(periodProblem(null, today), isNotNull);
      expect(dayKey(DateTime(2026, 3, 4)), '2026-03-04');
    });
  });

  group('Report.fromJson', () {
    final doc = demoMonthlyReport(DateTime(2026, 10), DateTime(2026, 11, 1, 7));

    test('reads every section of a report and skips sections it does not know', () {
      final r = Report.fromJson('monthly_2026-10', Map<String, dynamic>.from(doc))!;
      expect(r.summary.periodLabel, 'October 2026');
      expect(r.summary.isMonthly, isTrue);
      expect(r.compare!.label, 'September 2026');
      expect(r.metric('spent')!.compare!.deltaPctDisplay, '+14.2%');
      expect(r.metric('spent')!.higherIsWorse, isTrue);
      expect(r.metric('income')!.higherIsWorse, isFalse);
      expect(r.writtenBy, 'Written by Gemini Flash');
      expect(r.categories.map((c) => c.name), ['Home', 'Food', 'Grocery', 'Shopping', 'Health']);
      expect(r.categories.last.status, 'new');
      expect(r.members.map((m) => m.name), ['Asha', 'Rohan']);
      expect(r.rhythm!.weeks, hasLength(4));
      expect(r.merchantsBySpend.first.rankChange, 2);
      expect(r.notable!.anomalies.single.entry.id, 'demo-dinner');
      expect(r.bills!.priceChanges.single.up, isTrue);
      expect(r.budgets!.rows.first.status, 'over');
      expect(r.tags.single.name, 'Goa trip');
      expect(r.askQuestion, 'Compare my spending from 2026-10-01 to 2026-10-31 with 2026-09-01 to 2026-09-30. What changed and why?');
    });

    test('is lenient: malformed rows are dropped, missing sections are empty, a template narrative says so', () {
      final r = Report.fromJson('x', {
        'kind': 'custom',
        'period': {'from': '2026-10-01', 'to': '2026-10-31'},
        'createdAt': DateTime(2026, 11, 2),
        'narrativeSource': 'template',
        'narrative': {'headline': 'Spent ₹500', 'summary': 's', 'changes': ['a', 3, null]},
        'sections': {
          'headline': {'metrics': [{'key': 'spent', 'label': 'Spent', 'value': 500, 'display': '₹500'}, 'junk', {'label': 'no key'}]},
          'categories': {'rows': [{'categoryId': 'food', 'total': 'not a number'}]},
          'rhythm': {'weeks': []},
        },
      })!;
      expect(r.metrics.map((m) => m.key), ['spent']);
      expect(r.narrative.changes, ['a']);
      expect(r.categories.single.total, 0);
      expect(r.rhythm, isNull);
      expect(r.compare, isNull);
      expect(r.writtenBy, 'Summary built from the figures');
      expect(r.summary.periodLabel, '2026-10-01 – 2026-10-31');
      expect(Report.fromJson('y', {'period': {'from': '2026-10-01'}, 'createdAt': DateTime(2026)}), isNull);
      expect(Report.fromJson('z', {'period': {'from': '2026-10-01', 'to': '2026-10-02'}}), isNull);
    });

    test('monthly reports list first, newest first', () {
      ReportSummary s(String id, String kind, String from, DateTime at) =>
          ReportSummary(id: id, kind: kind, periodLabel: id, from: from, to: from, generatedAt: at);
      final sorted = sortReports([
        s('c-old', 'custom', '2026-01-01', DateTime(2026, 1, 5)),
        s('m-sep', 'monthly', '2026-09-01', DateTime(2026, 11, 20)),
        s('c-new', 'custom', '2026-01-01', DateTime(2026, 11, 22)),
        s('m-oct', 'monthly', '2026-10-01', DateTime(2026, 11, 1)),
      ]);
      expect(sorted.map((r) => r.id), ['m-oct', 'm-sep', 'c-new', 'c-old']);
    });
  });
}
