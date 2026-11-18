import 'package:flutter_test/flutter_test.dart';
import 'package:track_expense/core/data/admin.dart';

void main() {
  group('AdminDashboard.fromJson', () {
    test('parses a full response', () {
      final d = AdminDashboard.fromJson({
        'month': '2026-11',
        'billing': {
          'configured': true,
          'currency': 'INR',
          'dataAsOf': '2026-11-10T09:00:00Z',
          'net': 140,
          'gross': 150.5,
          'credits': -10.5,
          'previousMonthNet': 200,
          'forecastNet': 420,
          'changeVsPreviousMonth': 220,
          'byService': [
            {'service': 'Vertex AI', 'amount': 90},
            {'service': 'Cloud Firestore', 'amount': 50},
          ],
          'topSkus': [
            {'service': 'Vertex AI', 'sku': 'Gemini output', 'amount': 80, 'usage': 1.5, 'unit': '1M tokens'},
          ],
          'daily': [
            {'date': '2026-11-01', 'amount': 14},
          ],
        },
        'usage': {
          'available': true,
          'assistantQuestions': 7,
          'functionCalls': [
            {'name': 'askagent', 'count': 7},
          ],
          'firestore': {'reads': 1234, 'writes': 5, 'deletes': 1},
          'tokens': [
            {'model': 'gemini-3.8-flash', 'input': 900, 'output': 100},
          ],
        },
      });
      expect(d.month, '2026-11');
      final b = d.billing;
      expect(b.configured, isTrue);
      expect(b.net, 140);
      expect(b.gross, 150.5);
      expect(b.credits, -10.5);
      expect(b.forecastNet, 420);
      expect(b.changeVsPreviousMonth, 220);
      expect(b.dataAsOf, DateTime.utc(2026, 11, 10, 9));
      expect(b.byService.map((s) => s.service), ['Vertex AI', 'Cloud Firestore']);
      expect(b.topSkus.single.unit, '1M tokens');
      expect(b.daily.single.date, DateTime(2026, 11, 1));
      expect(d.usage.available, isTrue);
      expect(d.usage.assistantQuestions, 7);
      expect(d.usage.reads, 1234);
      expect(d.usage.tokens.single.output, 100);
      expect(d.isSample, isFalse);
    });

    test('maps the not-configured reasons', () {
      BillingGap? gap(Object? reason) =>
          BillingSummary.fromJson({'configured': false, 'reason': ?reason}).gap;
      expect(gap('not_set_up'), BillingGap.notSetUp);
      expect(gap('no_data'), BillingGap.noData);
      expect(gap('unavailable'), BillingGap.unavailable);
      expect(gap(null), BillingGap.notSetUp);
    });

    test('tolerates missing and malformed fields', () {
      final d = AdminDashboard.fromJson({
        'billing': {
          'configured': true,
          'net': 'oops',
          'forecastNet': null,
          'byService': [
            'not a map',
            {'amount': '12.5'},
          ],
          'daily': [
            {'date': 'not a date', 'amount': 3},
          ],
        },
        'usage': 'nope',
      }, fallbackMonth: '2026-10');
      expect(d.month, '2026-10');
      expect(d.billing.net, 0);
      expect(d.billing.forecastNet, isNull);
      expect(d.billing.currency, 'INR');
      expect(d.billing.byService.single.service, 'Unknown');
      expect(d.billing.byService.single.amount, 12.5);
      expect(d.billing.daily, isEmpty);
      expect(d.usage.available, isFalse);
      expect(d.usage.functionCalls, isEmpty);
    });

    test('an empty response is not configured', () {
      final d = AdminDashboard.fromJson(const {});
      expect(d.billing.configured, isFalse);
      expect(d.usage.available, isFalse);
    });
  });

  test('parses the assistant section and tolerates a missing one', () {
    final d = AdminDashboard.fromJson({
      'assistant': {
        'available': true,
        'questions': 4,
        'inputTokens': 6000,
        'outputTokens': 150,
        'modelCalls': 8,
        'activeHouseholds': 2,
        'byHousehold': [
          {'homeId': 'h2', 'homeName': 'Iyer', 'questions': 1, 'inputTokens': 5000, 'outputTokens': 50},
          {'homeId': 'h1', 'questions': '3', 'inputTokens': 1000, 'outputTokens': 100},
          {'homeName': 'no id'},
          'junk',
        ],
      },
    });
    final a = d.assistant;
    expect(a.available, isTrue);
    expect([a.questions, a.inputTokens, a.outputTokens, a.modelCalls, a.activeHouseholds], [4, 6000, 150, 8, 2]);
    expect(a.byHousehold.map((h) => h.homeName), ['Iyer', 'Household']);
    expect(a.byHousehold.first.tokens, 5050);
    expect(a.byHousehold.last.questions, 3);
    expect(AdminDashboard.fromJson(const {}).assistant.available, isFalse);
    expect(AdminDashboard.fromJson(const {}).assistant.byHousehold, isEmpty);
    // SMS category suggestions (D-032) are their own numbers; older backends send none.
    expect(a.smsSuggestions, 0);
    final sms = AdminDashboard.fromJson({
      'assistant': {
        'available': true,
        'sms': {'suggestions': 12, 'inputTokens': 2400, 'outputTokens': 60},
      },
    }).assistant;
    expect([sms.smsSuggestions, sms.smsInputTokens, sms.smsOutputTokens], [12, 2400, 60]);
  });

  test('parses the households section and tolerates a missing one', () {
    final d = AdminDashboard.fromJson({
      'households': {
        'available': true,
        'households': 3,
        'entries': 2521,
        'entriesInMonth': 40,
        'activeInMonth': 1,
        'byHousehold': [
          {'homeId': 'h1', 'homeName': 'Sharma', 'members': 2, 'entries': 2424, 'entriesInMonth': 40,
           'lastEntryAt': '2026-11-09T10:00:00.000Z'},
          {'homeId': 'h3', 'members': '1', 'entries': 0, 'entriesInMonth': 0, 'lastEntryAt': null},
          {'homeName': 'no id'},
          'junk',
        ],
      },
    });
    final h = d.households;
    expect(h.available, isTrue);
    expect([h.households, h.entries, h.entriesInMonth, h.activeInMonth], [3, 2521, 40, 1]);
    expect(h.byHousehold.map((r) => r.homeName), ['Sharma', 'Household']);
    expect(h.byHousehold.first.lastEntryAt, DateTime.utc(2026, 11, 9, 10).toLocal());
    expect(h.byHousehold.last.lastEntryAt, isNull);
    expect(h.byHousehold.last.members, 1);
    expect(AdminDashboard.fromJson(const {}).households.available, isFalse);
  });

  test('monthKey pads the month', () {
    expect(monthKey(DateTime(2026, 3, 9)), '2026-03');
  });

  test('demo data is labelled and internally consistent', () async {
    final repo = DemoAdminRepository(DateTime(2026, 11, 10));
    final now = await repo.dashboard('2026-11');
    expect(now.isSample, isTrue);
    expect(now.billing.forecastNet, 681.75);
    final last = await repo.dashboard('2026-10');
    expect(now.billing.previousMonthNet, last.billing.net);
    expect(last.billing.forecastNet, isNull);
    final old = await repo.dashboard('2026-08');
    expect(old.billing.gap, BillingGap.notSetUp);
    expect(old.usage.available, isFalse);
    expect(old.assistant.available, isTrue);
    expect(old.assistant.byHousehold, isEmpty);
    // Demo assistant totals match their households.
    final a = now.assistant;
    expect(a.byHousehold.fold<int>(0, (s, h) => s + h.questions), a.questions);
    expect(a.byHousehold.fold<int>(0, (s, h) => s + h.inputTokens), a.inputTokens);
    expect(a.byHousehold.fold<int>(0, (s, h) => s + h.outputTokens), a.outputTokens);
    expect(a.activeHouseholds, a.byHousehold.length);
  });
}
