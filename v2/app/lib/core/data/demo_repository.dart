import 'dart:async';

import '../domain/models.dart';
import '../domain/report.dart';
import 'repositories.dart';

class _Store<T> {
  _Store(this.value);

  T value;
  final _controller = StreamController<T>.broadcast();

  Stream<T> watch() => Stream.multi((c) {
        c.add(value);
        final sub = _controller.stream.listen(c.add);
        c.onCancel = sub.cancel;
      });

  void set(T next) {
    value = next;
    _controller.add(next);
  }
}

/// In-memory sample household, dated relative to [now] so there is always a
/// current month to show. Development and tests only; nothing is persisted.
class DemoHouseholdRepository implements HouseholdRepository {
  DemoHouseholdRepository(this.now) {
    _transactions = _Store(_seed());
  }

  final DateTime now;
  var _nextId = 1000;

  late final _Store<List<Transaction>> _transactions;
  final _categories = _Store<List<Category>>(const []);
  final _tags = _Store<List<Tag>>(const [
    Tag(id: 'goa', name: 'Goa trip', color: '#1D4ED8', note: 'December holiday'),
  ]);
  final _budgets = _Store<List<CategoryBudget>>(const [
    CategoryBudget(categoryId: 'food', amount: 12000),
    CategoryBudget(categoryId: 'transportation', amount: 6000),
    CategoryBudget(categoryId: 'home', amount: 28000),
    CategoryBudget(categoryId: 'bills', amount: 8000),
    CategoryBudget(categoryId: 'shopping', amount: 16000),
  ]);

  static const _members = [
    Member(id: 'u1', name: 'Asha', email: 'asha@example.com'),
    Member(id: 'u2', name: 'Rohan', email: 'rohan@example.com'),
  ];

  @override
  String get currentUserId => 'u1';

  @override
  Stream<Home?> watchHome() => Stream.value(const Home(
        id: 'demo',
        name: 'Sharma household',
        displayId: 'DEMO42',
        ownerId: 'u1',
        memberIds: ['u1', 'u2'],
      ));

  @override
  Stream<List<Member>> watchMembers() => Stream.value(_members);

  @override
  Stream<List<Transaction>> watchTransactions() => _transactions.watch();

  @override
  Stream<List<Category>> watchCustomCategories() => _categories.watch();

  @override
  Stream<List<CategoryBudget>> watchBudgets() => _budgets.watch();

  @override
  Stream<List<Tag>> watchTags() => _tags.watch();

  late final _notifications = _Store<List<HouseholdNotification>>([
    HouseholdNotification(
      id: 'n1',
      type: HouseholdNotificationType.transactionAdded,
      message: 'Rohan added ₹649 in Bills',
      createdBy: 'u2',
      createdByName: 'Rohan',
      createdAt: now.subtract(const Duration(hours: 3)),
      transactionId: _transactions.value
          .where((t) => t.note == 'Netflix')
          .lastOrNull
          ?.id,
    ),
    HouseholdNotification(
      id: 'n2',
      type: HouseholdNotificationType.transactionUpdated,
      message: 'Rohan updated an entry in Shopping',
      createdBy: 'u2',
      createdByName: 'Rohan',
      createdAt: now.subtract(const Duration(days: 2)),
      readBy: const ['u1'],
    ),
  ]);

  late final _insights = _Store<List<InsightCard>>([
    InsightCard(
      id: 'i1',
      kind: 'subscription_price_change',
      title: 'Netflix may have gone up',
      body: 'The last charge was ₹649. Earlier this year it was ₹499 a month.',
      createdAt: now.subtract(const Duration(hours: 6)),
    ),
    InsightCard(
      id: 'i2',
      kind: 'missing_bill',
      title: 'Electricity not logged yet',
      body: 'It is usually paid by the 7th. Nothing has been entered this month.',
      createdAt: now.subtract(const Duration(days: 1)),
    ),
    // Opens the month's report (D-033).
    InsightCard(
      id: 'i3',
      kind: 'month_review',
      title: 'Last month in review',
      body: 'Your monthly report is ready: what changed and why.',
      createdAt: now.subtract(const Duration(days: 2)),
      reportId: 'monthly_${now.month == 1 ? now.year - 1 : now.year}-${(now.month == 1 ? 12 : now.month - 1).toString().padLeft(2, '0')}',
    ),
  ]);

  @override
  Stream<List<InsightCard>> watchInsights() => _insights.watch();

  @override
  Future<void> dismissInsight(String id) async =>
      _insights.set(_insights.value.where((i) => i.id != id).toList());

  @override
  Stream<List<HouseholdNotification>> watchNotifications() => _notifications.watch();

  @override
  Future<void> markNotificationsRead(List<String> ids) async => _notifications.set([
        for (final n in _notifications.value)
          ids.contains(n.id) && !n.readBy.contains(currentUserId)
              ? HouseholdNotification(
                  id: n.id,
                  type: n.type,
                  message: n.message,
                  createdBy: n.createdBy,
                  createdByName: n.createdByName,
                  createdAt: n.createdAt,
                  transactionId: n.transactionId,
                  homeId: n.homeId,
                  readBy: [...n.readBy, currentUserId],
                )
              : n,
      ]);

  @override
  Future<String> saveTransaction(Transaction tx) async {
    final list = [..._transactions.value];
    if (tx.id.isEmpty) {
      final created = tx.copyWith(
        id: 'demo${_nextId++}',
        userId: currentUserId,
        userEmail: _members.first.email,
        homeId: 'demo',
      );
      _transactions.set([...list, created]);
      return created.id;
    }
    final i = list.indexWhere((t) => t.id == tx.id);
    if (i >= 0) list[i] = tx;
    _transactions.set(list);
    return tx.id;
  }

  @override
  Future<void> markChecked(String id) async => _transactions.set([
        for (final t in _transactions.value) t.id == id ? t.copyWith(autoAdded: false) : t,
      ]);

  @override
  Future<void> deleteTransaction(String id) async =>
      _transactions.set(_transactions.value.where((t) => t.id != id).toList());

  @override
  Future<void> saveCategory(Category category) async => _categories.set([
        ..._categories.value.where((c) => c.id != category.id),
        category,
      ]);

  @override
  Future<void> deleteCategory(String id) async =>
      _categories.set(_categories.value.where((c) => c.id != id).toList());

  @override
  Future<String> saveTag(Tag tag) async {
    final saved = tag.id.isEmpty
        ? Tag(
            id: 'tag${_nextId++}',
            name: tag.name,
            color: tag.color,
            note: tag.note,
            createdBy: currentUserId,
            createdAt: DateTime.now(),
          )
        : tag;
    _tags.set([..._tags.value.where((t) => t.id != saved.id), saved]);
    return saved.id;
  }

  @override
  Future<void> deleteTag(String id) async =>
      _tags.set(_tags.value.where((t) => t.id != id).toList());

  @override
  Future<void> setBudget(String categoryId, double amount) async => _budgets.set([
        ..._budgets.value.where((b) => b.categoryId != categoryId),
        if (amount > 0) CategoryBudget(categoryId: categoryId, amount: amount),
      ]);

  List<Transaction> _seed() {
    var n = 0;
    final txs = <Transaction>[];
    void add(DateTime date, double amount, String cat, String note,
        {String user = 'u1',
        TransactionType type = TransactionType.expense,
        List<String> tags = const [],
        bool sms = false,
        bool auto = false}) {
      if (date.isAfter(now)) return;
      txs.add(Transaction(
        id: 'demo${n++}',
        amount: amount,
        categoryId: cat,
        date: date,
        type: type,
        note: note,
        userId: user,
        userEmail: user == 'u1' ? 'asha@example.com' : 'rohan@example.com',
        homeId: 'demo',
        tagIds: tags,
        source: sms || auto ? 'sms' : null,
        autoAdded: auto,
      ));
    }

    // Five earlier months of steady recurring items, then the current month.
    for (var back = 5; back >= 0; back--) {
      DateTime day(int d, [int h = 12]) =>
          DateTime(now.year, now.month - back, d, h);
      add(day(1, 9), 120000, 'salary', 'Salary', type: TransactionType.income);
      add(day(3), 28000, 'home', 'House rent');
      add(day(5), 649, 'bills', 'Netflix', user: 'u2');
      add(day(7), 1840, 'bills', 'Electricity bescom');
      for (final d in [2, 6, 9, 13, 16, 20, 23, 27]) {
        add(day(d, 20), 420 + (d * 37 % 260), 'food', 'Swiggy dinner',
            user: d.isEven ? 'u1' : 'u2');
      }
      for (final d in [4, 8, 11, 15, 18, 22, 25]) {
        add(day(d, 9), 240 + (d * 53 % 180), 'transportation', 'Uber to office');
      }
      add(day(12), 2600 + back * 300, 'shopping', 'Amazon order', user: 'u2');
      add(day(21), 3900, 'grocery', 'BigBasket groceries', user: 'u2');
      if (back == 1) {
        add(day(14), 8200, 'transportation', 'Flight to Goa', tags: const ['goa']);
        add(day(15), 5400, 'entertainment', 'Scuba booking',
            user: 'u2', tags: const ['goa']);
      }
      if (back == 0) {
        // From bank messages: two saved by the phone on its own and not yet
        // checked (D-031), one Rohan's, one confirmed from a notification.
        add(day(8, 13), 186, 'food', 'Chaayos · HDFC XX1234', sms: true);
        add(day(9, 18), 1499, 'shopping', 'Decathlon · HDFC XX1234', auto: true);
        add(day(10, 8), 150, 'transportation', 'auto to office · Ramesh K', auto: true);
        add(day(10, 10), 320, 'grocery', 'Ramesh Stores · Kotak X5678',
            user: 'u2', auto: true);
      }
    }
    return txs;
  }
}

// ------------------------------------------------------------------ reports

const _monthNames = [
  'January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December',
];

Map<String, Object?> _cmp(num base, String baseDisplay, num delta, String deltaDisplay, [String? pct]) => {
      'base': base,
      'baseDisplay': baseDisplay,
      'delta': delta,
      'deltaDisplay': deltaDisplay,
      'deltaPct': pct == null ? null : double.tryParse(pct.replaceAll(RegExp(r'[+%]'), '')),
      'deltaPctDisplay': pct,
    };

/// A sample monthly report in the server's document shape (D-033).
Map<String, Object?> demoMonthlyReport(DateTime month, DateTime madeAt) {
  final label = '${_monthNames[month.month - 1]} ${month.year}';
  final prev = DateTime(month.year, month.month - 1);
  final prevLabel = '${_monthNames[prev.month - 1]} ${prev.year}';
  String day(int d, DateTime m) =>
      '${m.year}-${m.month.toString().padLeft(2, '0')}-${d.toString().padLeft(2, '0')}';
  final last = DateTime(month.year, month.month + 1, 0).day;
  final short = _monthNames[month.month - 1].substring(0, 3);
  return {
    'kind': 'monthly',
    'period': {'from': day(1, month), 'to': day(last, month), 'label': label, 'days': last},
    'compare': {
      'mode': 'previous', 'label': prevLabel, 'from': day(1, prev),
      'to': day(DateTime(prev.year, prev.month + 1, 0).day, prev), 'periods': 1, 'periodsUsed': 1,
    },
    'narrativeSource': 'model',
    'model': 'vertexai/gemini-3.8-flash',
    'modelLabel': 'Gemini Flash',
    'createdAt': madeAt,
    'generatedAt': madeAt,
    'narrative': {
      'headline': 'Food delivery pushed spending up 14.2% on $prevLabel',
      'summary': 'You spent ₹62,480 against income of ₹1,45,000, saving 56.9%. '
          'Food rose the most, and Rohan\'s grocery runs were steady.',
      'changes': [
        'Food went from ₹9,120 to ₹13,640, mostly Swiggy, which had 11 visits.',
        'Shopping fell by ₹2,150 after a big Amazon order in $prevLabel.',
        'Netflix went from ₹649 to ₹799.',
      ],
      'suggestions': [
        'Food used 113.7% of its ₹12,000 budget; worth checking whether the budget still fits.',
      ],
    },
    'sections': {
      'headline': {
        'metrics': [
          {'key': 'spent', 'label': 'Spent', 'value': 62480, 'display': '₹62,480', 'compare': _cmp(54710, '₹54,710', 7770, '+₹7,770', '+14.2%')},
          {'key': 'income', 'label': 'Income', 'value': 145000, 'display': '₹1,45,000', 'compare': _cmp(145000, '₹1,45,000', 0, '₹0', '0%')},
          {'key': 'net', 'label': 'Net', 'value': 82520, 'display': '₹82,520', 'compare': _cmp(90290, '₹90,290', -7770, '-₹7,770', '-8.6%')},
          {'key': 'savingsRate', 'label': 'Savings rate', 'value': 56.9, 'display': '56.9%', 'compare': _cmp(62.3, '62.3%', -5.4, '-5.4 pts')},
          {'key': 'entries', 'label': 'Entries', 'value': 74, 'display': '74', 'compare': _cmp(66, '66', 8, '+8', '+12.1%')},
          {'key': 'dailyAverage', 'label': 'Spent per day', 'value': 2015.48, 'display': '₹2,015.48', 'compare': _cmp(1823.67, '₹1,823.67', 191.81, '+₹191.81', '+10.5%')},
        ],
        'baselineNote': null,
      },
      'categories': {
        'rows': [
          {'categoryId': 'home', 'name': 'Home', 'total': 25000, 'shareDisplay': '40%', 'count': 1, 'compare': _cmp(25000, '₹25,000', 0, '₹0', '0%'), 'status': null},
          {'categoryId': 'food', 'name': 'Food', 'total': 13640, 'shareDisplay': '21.8%', 'count': 31, 'compare': _cmp(9120, '₹9,120', 4520, '+₹4,520', '+49.6%'), 'status': null},
          {'categoryId': 'grocery', 'name': 'Grocery', 'total': 9830, 'shareDisplay': '15.7%', 'count': 12, 'compare': _cmp(9410, '₹9,410', 420, '+₹420', '+4.5%'), 'status': null},
          {'categoryId': 'shopping', 'name': 'Shopping', 'total': 6210, 'shareDisplay': '9.9%', 'count': 5, 'compare': _cmp(8360, '₹8,360', -2150, '-₹2,150', '-25.7%'), 'status': null},
          {'categoryId': 'health', 'name': 'Health', 'total': 1800, 'shareDisplay': '2.9%', 'count': 1, 'compare': _cmp(0, '₹0', 1800, '+₹1,800'), 'status': 'new'},
        ],
        'truncated': false,
      },
      'members': {
        'rows': [
          {'memberId': 'u1', 'name': 'Asha', 'spent': 38720, 'sharePct': 62, 'shareDisplay': '62%', 'count': 45, 'compare': _cmp(33100, '₹33,100', 5620, '+₹5,620', '+17%')},
          {'memberId': 'u2', 'name': 'Rohan', 'spent': 23760, 'sharePct': 38, 'shareDisplay': '38%', 'count': 29, 'compare': _cmp(21610, '₹21,610', 2150, '+₹2,150', '+9.9%')},
        ],
      },
      'rhythm': {
        'weeks': [
          {'weekStart': day(1, month), 'label': 'Week of 1 $short', 'total': 31200},
          {'weekStart': day(8, month), 'label': 'Week of 8 $short', 'total': 9400},
          {'weekStart': day(15, month), 'label': 'Week of 15 $short', 'total': 12100},
          {'weekStart': day(22, month), 'label': 'Week of 22 $short', 'total': 9780},
        ],
        'weekendSharePct': 34.1,
        'weekendShareDisplay': '34.1%',
        'baseWeekendShareDisplay': '29.4%',
        'biggestDay': {'date': day(3, month), 'label': '3 $short ${month.year}', 'total': 25640, 'count': 3},
      },
      'merchants': {
        'bySpend': [
          {'name': 'Swiggy', 'total': 6840, 'count': 11, 'rank': 1, 'rankChange': 2, 'isNew': false},
          {'name': 'DMart', 'total': 5120, 'count': 4, 'rank': 2, 'rankChange': 0, 'isNew': false},
          {'name': 'Amazon', 'total': 3990, 'count': 2, 'rank': 3, 'rankChange': -2, 'isNew': false},
        ],
        'byVisits': [
          {'name': 'Swiggy', 'total': 6840, 'count': 11, 'rank': 1, 'rankChange': 0, 'isNew': false},
          {'name': 'Uber', 'total': 1460, 'count': 7, 'rank': 2, 'rankChange': 1, 'isNew': false},
        ],
      },
      'notable': {
        'largest': [
          {'id': 'demo-rent', 'date': day(3, month), 'dateLabel': '3 $short ${month.year}', 'label': 'House rent', 'categoryName': 'Home', 'amount': 25000, 'memberName': 'Asha', 'type': 'expense'},
          {'id': 'demo-phone', 'date': day(19, month), 'dateLabel': '19 $short ${month.year}', 'label': 'Amazon', 'categoryName': 'Shopping', 'amount': 3490, 'memberName': 'Rohan', 'type': 'expense'},
        ],
        'anomalies': [
          {
            'entry': {'id': 'demo-dinner', 'date': day(18, month), 'dateLabel': '18 $short ${month.year}', 'label': 'Dinner', 'categoryName': 'Food', 'amount': 3200, 'memberName': 'Asha', 'type': 'expense'},
            'basisLabel': 'Food', 'typicalAmountDisplay': '₹320', 'timesTypical': 10, 'timesTypicalDisplay': '10×',
          },
        ],
        'duplicates': [],
      },
      'bills': {
        'paid': [
          {'label': 'House rent', 'categoryName': 'Home', 'cadence': 'monthly', 'amount': 25000, 'count': 1, 'dateLabel': '3 $short ${month.year}'},
          {'label': 'Netflix', 'categoryName': 'Entertainment', 'cadence': 'monthly', 'amount': 799, 'count': 1, 'dateLabel': '5 $short ${month.year}'},
        ],
        'missed': [],
        'priceChanges': [
          {'label': 'Netflix', 'previousAmountDisplay': '₹649', 'currentAmountDisplay': '₹799', 'deltaPctDisplay': '+23.1%', 'direction': 'up'},
        ],
      },
      'budgets': {
        'monthLabel': label,
        'baseLabel': prevLabel,
        'totalUsedPctDisplay': '84.3%',
        'rows': [
          {'categoryId': 'food', 'categoryName': 'Food', 'budget': 12000, 'spent': 13640, 'usedPct': 113.7, 'usedPctDisplay': '113.7%', 'status': 'over', 'base': {'usedPctDisplay': '76%'}},
          {'categoryId': 'shopping', 'categoryName': 'Shopping', 'budget': 16000, 'spent': 6210, 'usedPct': 38.8, 'usedPctDisplay': '38.8%', 'status': 'within', 'base': {'usedPctDisplay': '52.3%'}},
        ],
      },
      'tags': {
        'rows': [
          {'tagId': 'goa', 'name': 'Goa trip', 'total': 4200, 'count': 3, 'compare': _cmp(0, '₹0', 4200, '+₹4,200')},
        ],
      },
      // A section this build does not know: skipped.
      'futureSection': {'rows': [1, 2, 3]},
    },
  };
}

/// Reports for demo mode and tests: last month's monthly report and one
/// custom report. New reports are made from the same sample figures.
class DemoReportsRepository implements ReportsRepository {
  DemoReportsRepository(this.now) {
    final lastMonth = DateTime(now.year, now.month - 1);
    _docs['monthly_${dayKey(lastMonth).substring(0, 7)}'] =
        demoMonthlyReport(lastMonth, DateTime(now.year, now.month, 1, 7));
    final custom = demoMonthlyReport(lastMonth, now.subtract(const Duration(days: 2)));
    custom['kind'] = 'custom';
    custom['period'] = {'from': dayKey(now.subtract(const Duration(days: 9))), 'to': dayKey(now.subtract(const Duration(days: 3))), 'label': 'Last week', 'days': 7};
    custom['compare'] = null;
    _docs['demo-custom'] = custom;
    _store = _Store(_summaries());
  }

  final DateTime now;
  final _docs = <String, Map<String, Object?>>{};
  late final _Store<List<ReportSummary>> _store;
  var _next = 1;

  /// Every generate call, for tests.
  final requests = <({DayRange period, CompareMode compare, DayRange? customCompare, String? model})>[];
  final refreshed = <({String id, String? model})>[];

  Report? _report(String id) {
    final d = _docs[id];
    return d == null ? null : Report.fromJson(id, Map<String, dynamic>.from(d));
  }

  List<ReportSummary> _summaries() => sortReports([for (final id in _docs.keys) ?_report(id)?.summary]);

  @override
  Stream<List<ReportSummary>> watchReports() => _store.watch();

  @override
  Stream<Report?> watchReport(String id) => _store.watch().map((_) => _report(id));

  @override
  Future<String> generate({
    required DayRange period,
    required CompareMode compare,
    DayRange? customCompare,
    String? model,
  }) async {
    requests.add((period: period, compare: compare, customCompare: customCompare, model: model));
    await Future<void>.delayed(const Duration(milliseconds: 600));
    final id = 'demo-${_next++}';
    final doc = demoMonthlyReport(DateTime(period.from.year, period.from.month), now);
    doc['kind'] = 'custom';
    doc['period'] = {'from': dayKey(period.from), 'to': dayKey(period.to), 'label': period.label, 'days': period.days};
    final base = comparisonRange(period, compare, custom: customCompare);
    doc['compare'] = base == null
        ? null
        : {'mode': compare.key, 'label': comparisonLabel(period, compare, custom: customCompare)!.replaceFirst('vs ', ''), 'from': dayKey(base.from), 'to': dayKey(base.to)};
    if (model == 'flash-lite') doc['modelLabel'] = 'Gemini Flash-Lite';
    _docs[id] = doc;
    _store.set(_summaries());
    return id;
  }

  @override
  Future<void> refresh(String id, {String? model}) async {
    if (!_docs.containsKey(id)) throw const ReportException('That report no longer exists.');
    refreshed.add((id: id, model: model));
    await Future<void>.delayed(const Duration(milliseconds: 300));
    _docs[id] = {..._docs[id]!, 'generatedAt': now};
    _store.set(_summaries());
  }
}
