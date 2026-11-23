import '../domain/models.dart';
import '../domain/report.dart';

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
  /// An update with `autoAdded` false clears the marker (D-031).
  Future<String> saveTransaction(Transaction tx);

  /// "Looks right": the owner checked an auto-added entry (D-031).
  Future<void> markChecked(String id);
  Future<void> deleteTransaction(String id);

  Future<void> saveCategory(Category category);
  Future<void> deleteCategory(String id);

  /// Creates when [tag] has an empty id. Returns the id.
  Future<String> saveTag(Tag tag);
  Future<void> deleteTag(String id);

  /// An [amount] of zero or less removes the budget.
  Future<void> setBudget(String categoryId, double amount);
}

/// A report could not be made; [message] is fit to show the user.
class ReportException implements Exception {
  const ReportException(this.message);

  final String message;

  @override
  String toString() => message;
}

/// Saved expense reports of the household (D-033). Reports are written only
/// by the server; the app reads them and asks for new ones.
abstract class ReportsRepository {
  /// Monthly reports first, then custom ones, newest first.
  Stream<List<ReportSummary>> watchReports();

  /// Null while missing (or not readable).
  Stream<Report?> watchReport(String id);

  /// Asks the server for a report and returns its id once written (about
  /// 5–10 s). [model] is the assistant model key from Profile (D-027).
  /// Throws [ReportException].
  Future<String> generate({
    required DayRange period,
    required CompareMode compare,
    DayRange? customCompare,
    String? model,
  });

  /// Rebuilds a report in place with the entries as they are now.
  /// Throws [ReportException].
  Future<void> refresh(String id, {String? model});
}
