import 'dart:async';

import '../domain/models.dart';
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
