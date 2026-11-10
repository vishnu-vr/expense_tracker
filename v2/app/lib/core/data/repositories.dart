import '../domain/models.dart';

class Member {
  const Member({required this.id, required this.name, this.email, this.photoUrl});

  final String id;
  final String name;
  final String? email;
  final String? photoUrl;
}

/// Data for the signed-in user's household. Implemented in memory for
/// development ([DemoHouseholdRepository]) and by Firestore for real use.
abstract class HouseholdRepository {
  String get currentUserId;

  Stream<Home?> watchHome();
  Stream<List<Member>> watchMembers();
  Stream<List<Transaction>> watchTransactions();

  /// Custom categories only; built-in defaults are merged in by the app.
  Stream<List<Category>> watchCustomCategories();
  Stream<List<CategoryBudget>> watchBudgets();
  Stream<List<Tag>> watchTags();

  /// Household activity, newest first.
  Stream<List<HouseholdNotification>> watchNotifications();
  Future<void> markNotificationsRead(List<String> ids);

  /// Server-generated insights the current user has not dismissed, newest first.
  Stream<List<InsightCard>> watchInsights();
  Future<void> dismissInsight(String id);

  /// Creates when [tx] has an empty id, otherwise updates. Returns the id.
  Future<String> saveTransaction(Transaction tx);
  Future<void> deleteTransaction(String id);

  Future<void> saveCategory(Category category);
  Future<void> deleteCategory(String id);

  /// Creates when [tag] has an empty id. Returns the id.
  Future<String> saveTag(Tag tag);
  Future<void> deleteTag(String id);

  /// An [amount] of zero or less removes the budget.
  Future<void> setBudget(String categoryId, double amount);
}
