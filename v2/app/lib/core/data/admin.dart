/// Admin billing and usage dashboard (D-024): Google Cloud costs from the
/// billing export plus usage from Cloud Monitoring, one month at a time.
/// Every number is computed on the server; the app only shows it.
library;

double _num(Object? v) => switch (v) {
      num n when n.isFinite => n.toDouble(),
      String s => double.tryParse(s) ?? 0,
      _ => 0,
    };

double? _numOrNull(Object? v) => v == null ? null : _num(v);

int _int(Object? v) => _num(v).round();

String _str(Object? v, [String fallback = '']) => v is String && v.isNotEmpty ? v : fallback;

List<T> _list<T>(Object? raw, T? Function(Map<String, dynamic>) parse) => [
      if (raw is List)
        for (final item in raw)
          if (item is Map) ?parse(Map<String, dynamic>.from(item)),
    ];

class ServiceCost {
  const ServiceCost(this.service, this.amount);

  final String service;
  final double amount;
}

class SkuCost {
  const SkuCost({
    required this.service,
    required this.sku,
    required this.amount,
    required this.usage,
    required this.unit,
  });

  final String service;
  final String sku;
  final double amount;
  final double usage;
  final String unit;
}

class DailyCost {
  const DailyCost(this.date, this.amount);

  /// Day in India time.
  final DateTime date;
  final double amount;
}

/// Why there are no billing numbers for a month.
enum BillingGap {
  /// The BigQuery billing export has not been switched on yet.
  notSetUp,

  /// The export exists but has nothing for this month.
  noData,

  /// Reading the export failed this time.
  unavailable,
}

class BillingSummary {
  const BillingSummary({
    this.gap,
    this.currency = 'INR',
    this.dataAsOf,
    this.net = 0,
    this.gross = 0,
    this.credits = 0,
    this.previousMonthNet,
    this.forecastNet,
    this.changeVsPreviousMonth,
    this.byService = const [],
    this.topSkus = const [],
    this.daily = const [],
  });

  const BillingSummary.missing(BillingGap gap) : this(gap: gap);

  /// Null when there are numbers to show.
  final BillingGap? gap;
  final String currency;
  final DateTime? dataAsOf;
  final double net;
  final double gross;

  /// Negative: free tier, promotions and discounts.
  final double credits;
  final double? previousMonthNet;
  final double? forecastNet;

  /// Forecast (current month) or actual net minus last month's net.
  final double? changeVsPreviousMonth;
  final List<ServiceCost> byService;
  final List<SkuCost> topSkus;
  final List<DailyCost> daily;

  bool get configured => gap == null;

  factory BillingSummary.fromJson(Map<String, dynamic> json) {
    if (json['configured'] != true) {
      return BillingSummary.missing(switch (json['reason']) {
        'no_data' => BillingGap.noData,
        'unavailable' => BillingGap.unavailable,
        _ => BillingGap.notSetUp,
      });
    }
    return BillingSummary(
      currency: _str(json['currency'], 'INR'),
      dataAsOf: DateTime.tryParse(_str(json['dataAsOf'])),
      net: _num(json['net']),
      gross: _num(json['gross']),
      credits: _num(json['credits']),
      previousMonthNet: _numOrNull(json['previousMonthNet']),
      forecastNet: _numOrNull(json['forecastNet']),
      changeVsPreviousMonth: _numOrNull(json['changeVsPreviousMonth']),
      byService: _list(json['byService'], (m) => ServiceCost(_str(m['service'], 'Unknown'), _num(m['amount']))),
      topSkus: _list(
        json['topSkus'],
        (m) => SkuCost(
          service: _str(m['service'], 'Unknown'),
          sku: _str(m['sku'], 'Unknown'),
          amount: _num(m['amount']),
          usage: _num(m['usage']),
          unit: _str(m['unit']),
        ),
      ),
      daily: _list(json['daily'], (m) {
        final date = DateTime.tryParse(_str(m['date']));
        return date == null ? null : DailyCost(date, _num(m['amount']));
      }),
    );
  }
}

class FunctionCalls {
  const FunctionCalls(this.name, this.count);

  final String name;
  final int count;
}

class ModelTokens {
  const ModelTokens(this.model, this.input, this.output);

  final String model;
  final int input;
  final int output;
}

class UsageSummary {
  const UsageSummary({
    this.available = false,
    this.assistantQuestions = 0,
    this.functionCalls = const [],
    this.reads = 0,
    this.writes = 0,
    this.deletes = 0,
    this.tokens = const [],
  });

  /// False for months older than Cloud Monitoring keeps (about six weeks).
  final bool available;
  final int assistantQuestions;
  final List<FunctionCalls> functionCalls;
  final int reads;
  final int writes;
  final int deletes;
  final List<ModelTokens> tokens;

  factory UsageSummary.fromJson(Map<String, dynamic> json) {
    final fs = json['firestore'] is Map ? Map<String, dynamic>.from(json['firestore'] as Map) : const <String, dynamic>{};
    return UsageSummary(
      available: json['available'] == true,
      assistantQuestions: _int(json['assistantQuestions']),
      functionCalls: _list(json['functionCalls'], (m) => FunctionCalls(_str(m['name'], 'unknown'), _int(m['count']))),
      reads: _int(fs['reads']),
      writes: _int(fs['writes']),
      deletes: _int(fs['deletes']),
      tokens: _list(json['tokens'], (m) => ModelTokens(_str(m['model'], 'unknown'), _int(m['input']), _int(m['output']))),
    );
  }
}

class HouseholdAssistantUsage {
  const HouseholdAssistantUsage({
    required this.homeId,
    required this.homeName,
    required this.questions,
    required this.inputTokens,
    required this.outputTokens,
  });

  final String homeId;
  final String homeName;
  final int questions;
  final int inputTokens;
  final int outputTokens;

  int get tokens => inputTokens + outputTokens;
}

/// Assistant usage for the month from the server-only `aiUsage` rollup
/// (D-025). Counts and household names only, no conversation content.
class AssistantUsageSummary {
  const AssistantUsageSummary({
    this.available = false,
    this.questions = 0,
    this.inputTokens = 0,
    this.outputTokens = 0,
    this.modelCalls = 0,
    this.activeHouseholds = 0,
    this.byHousehold = const [],
  });

  /// False when the rollup could not be read (or an older backend sent none).
  final bool available;
  final int questions;
  final int inputTokens;
  final int outputTokens;
  final int modelCalls;
  final int activeHouseholds;

  /// Highest token use first.
  final List<HouseholdAssistantUsage> byHousehold;

  factory AssistantUsageSummary.fromJson(Map<String, dynamic> json) => AssistantUsageSummary(
        available: json['available'] == true,
        questions: _int(json['questions']),
        inputTokens: _int(json['inputTokens']),
        outputTokens: _int(json['outputTokens']),
        modelCalls: _int(json['modelCalls']),
        activeHouseholds: _int(json['activeHouseholds']),
        byHousehold: _list(json['byHousehold'], (m) {
          final id = _str(m['homeId']);
          if (id.isEmpty) return null;
          return HouseholdAssistantUsage(
            homeId: id,
            homeName: _str(m['homeName'], 'Household'),
            questions: _int(m['questions']),
            inputTokens: _int(m['inputTokens']),
            outputTokens: _int(m['outputTokens']),
          );
        }),
      );
}

class AdminDashboard {
  const AdminDashboard({
    required this.month,
    required this.billing,
    required this.usage,
    this.assistant = const AssistantUsageSummary(),
    this.isSample = false,
  });

  /// "2026-11".
  final String month;
  final BillingSummary billing;
  final UsageSummary usage;
  final AssistantUsageSummary assistant;

  /// Demo data, labelled "Sample data" on screen.
  final bool isSample;

  static Map<String, dynamic> _map(Object? v) =>
      v is Map ? Map<String, dynamic>.from(v) : const <String, dynamic>{};

  factory AdminDashboard.fromJson(Map<String, dynamic> json, {String fallbackMonth = ''}) => AdminDashboard(
        month: _str(json['month'], fallbackMonth),
        billing: BillingSummary.fromJson(_map(json['billing'])),
        usage: UsageSummary.fromJson(_map(json['usage'])),
        assistant: AssistantUsageSummary.fromJson(_map(json['assistant'])),
      );
}

/// "2026-11" for the month containing [d].
String monthKey(DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}';

/// Failure fit to show the admin.
class AdminFailure implements Exception {
  const AdminFailure(this.message);

  final String message;

  @override
  String toString() => message;
}

abstract class AdminRepository {
  /// Costs and usage for [month] ("YYYY-MM"). Throws [AdminFailure].
  Future<AdminDashboard> dashboard(String month);
}

/// Sample numbers for demo mode and tests. The current and previous month
/// have billing data; older months show the "not set up" state, and months
/// more than one back have no usage.
class DemoAdminRepository implements AdminRepository {
  DemoAdminRepository(this.now);

  final DateTime now;

  @override
  Future<AdminDashboard> dashboard(String month) async {
    final current = monthKey(now);
    final previous = monthKey(DateTime(now.year, now.month - 1));
    final isCurrent = month == current;
    final scale = isCurrent ? 1.0 : 1.4;
    final usage = month == current || month == previous
        ? UsageSummary(
            available: true,
            assistantQuestions: isCurrent ? 42 : 61,
            functionCalls: [
              FunctionCalls('askagent', isCurrent ? 42 : 61),
              FunctionCalls('ontransactionwritten', isCurrent ? 318 : 455),
              const FunctionCalls('generateinsights', 10),
              const FunctionCalls('joinhome', 2),
            ]..sort((a, b) => b.count.compareTo(a.count)),
            reads: isCurrent ? 30492 : 41250,
            writes: isCurrent ? 1240 : 1710,
            deletes: 12,
            tokens: [
              ModelTokens('gemini-3.8-flash', isCurrent ? 812400 : 1104000, isCurrent ? 41200 : 58800),
              ModelTokens('gemini-embedding-001', isCurrent ? 96000 : 132000, 0),
            ],
          )
        : const UsageSummary();
    final assistant = month == current || month == previous
        ? AssistantUsageSummary(
            available: true,
            questions: isCurrent ? 42 : 61,
            inputTokens: isCurrent ? 278400 : 401200,
            outputTokens: isCurrent ? 8820 : 12650,
            modelCalls: isCurrent ? 97 : 140,
            activeHouseholds: 3,
            byHousehold: [
              HouseholdAssistantUsage(
                  homeId: 'demo', homeName: 'Sharma household', questions: isCurrent ? 27 : 38,
                  inputTokens: isCurrent ? 181000 : 252000, outputTokens: isCurrent ? 5700 : 7900),
              HouseholdAssistantUsage(
                  homeId: 'h2', homeName: 'Iyer family', questions: isCurrent ? 11 : 17,
                  inputTokens: isCurrent ? 71400 : 112200, outputTokens: isCurrent ? 2320 : 3550),
              HouseholdAssistantUsage(
                  homeId: 'h3', homeName: 'Flat 4B, Koramangala', questions: isCurrent ? 4 : 6,
                  inputTokens: isCurrent ? 26000 : 37000, outputTokens: isCurrent ? 800 : 1200),
            ],
          )
        : const AssistantUsageSummary(available: true);
    if (month != current && month != previous) {
      return AdminDashboard(
        month: month,
        billing: const BillingSummary.missing(BillingGap.notSetUp),
        usage: usage,
        assistant: assistant,
        isSample: true,
      );
    }
    double r(double v) => (v * scale * 100).roundToDouble() / 100;
    final net = r(227.25);
    final days = isCurrent ? now.day : DateTime(now.year, now.month, 0).day;
    final start = isCurrent ? DateTime(now.year, now.month) : DateTime(now.year, now.month - 1);
    final weights = [for (var i = 0; i < days; i++) 14 + (i * 7 % 11) + (i % 4 == 0 ? 9 : 0)];
    final weightSum = weights.fold<int>(0, (s, w) => s + w);
    final daily = [
      for (var i = 0; i < days; i++)
        DailyCost(DateTime(start.year, start.month, start.day + i),
            (net * weights[i] / weightSum * 100).roundToDouble() / 100),
    ];
    final daysInMonth = DateTime(now.year, now.month + 1, 0).day;
    final forecast = isCurrent ? (net / now.day * daysInMonth * 100).roundToDouble() / 100 : null;
    final previousNet = isCurrent ? 318.15 : 280.1;
    return AdminDashboard(
      month: month,
      isSample: true,
      usage: usage,
      assistant: assistant,
      billing: BillingSummary(
        currency: 'INR',
        dataAsOf: isCurrent ? DateTime(now.year, now.month, now.day, 6, 30) : DateTime(now.year, now.month, 2, 9),
        gross: r(268.4),
        credits: r(-41.15),
        net: net,
        previousMonthNet: previousNet,
        forecastNet: forecast,
        changeVsPreviousMonth: (((forecast ?? net) - previousNet) * 100).roundToDouble() / 100,
        byService: [
          ServiceCost('Vertex AI', r(118.4)),
          ServiceCost('Cloud Firestore', r(52.1)),
          ServiceCost('Cloud Run Functions', r(24.8)),
          ServiceCost('Cloud Build', r(14.6)),
          ServiceCost('Artifact Registry', r(9.2)),
          ServiceCost('Other', r(8.15)),
        ],
        topSkus: [
          SkuCost(service: 'Vertex AI', sku: 'Gemini 3.8 Flash input tokens', amount: r(71.2), usage: 0.81, unit: '1M tokens'),
          SkuCost(service: 'Vertex AI', sku: 'Gemini 3.8 Flash output tokens', amount: r(39.5), usage: 0.04, unit: '1M tokens'),
          SkuCost(service: 'Cloud Firestore', sku: 'Cloud Firestore Read Ops', amount: r(31.4), usage: 30.49, unit: '100K count'),
          SkuCost(service: 'Cloud Run Functions', sku: 'CPU Allocation Time (tier 1)', amount: r(16.3), usage: 5210, unit: 'vCPU-second'),
          SkuCost(service: 'Cloud Build', sku: 'Build time (e2-standard-2)', amount: r(14.6), usage: 182, unit: 'minute'),
        ],
        daily: daily,
      ),
    );
  }
}
