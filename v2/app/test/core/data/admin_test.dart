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
  });
}
