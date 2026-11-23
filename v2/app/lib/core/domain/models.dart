/// Domain models shared across features. Pure Dart: no Flutter or Firebase imports.
library;

enum TransactionType { income, expense }

class Transaction {
  const Transaction({
    required this.id,
    required this.amount,
    required this.categoryId,
    required this.date,
    required this.type,
    this.note,
    this.userId,
    this.userEmail,
    this.homeId,
    this.tagIds = const [],
    this.source,
    this.autoAdded = false,
  });

  final String id;
  final double amount;
  final String categoryId;
  final DateTime date;
  final TransactionType type;
  final String? note;
  final String? userId;
  final String? userEmail;
  final String? homeId;
  final List<String> tagIds;

  /// How the entry was made: null when typed in, `sms` when added from a
  /// bank message (D-029).
  final String? source;

  bool get fromSms => source == 'sms';

  /// Saved by the phone from a bank message without asking anyone (rules,
  /// history or a remembered payee; D-031) and not yet checked by its owner.
  /// Cleared by "Looks right" or by editing the entry. Firestore field
  /// `autoAdded`.
  final bool autoAdded;

  bool get isExpense => type == TransactionType.expense;
  bool get isIncome => type == TransactionType.income;

  Transaction copyWith({
    String? id,
    double? amount,
    String? categoryId,
    DateTime? date,
    TransactionType? type,
    String? note,
    String? userId,
    String? userEmail,
    String? homeId,
    List<String>? tagIds,
    String? source,
    bool? autoAdded,
  }) {
    return Transaction(
      id: id ?? this.id,
      amount: amount ?? this.amount,
      categoryId: categoryId ?? this.categoryId,
      date: date ?? this.date,
      type: type ?? this.type,
      note: note ?? this.note,
      userId: userId ?? this.userId,
      userEmail: userEmail ?? this.userEmail,
      homeId: homeId ?? this.homeId,
      tagIds: tagIds ?? this.tagIds,
      source: source ?? this.source,
      autoAdded: autoAdded ?? this.autoAdded,
    );
  }
}

class Tag {
  const Tag({
    required this.id,
    required this.name,
    this.color,
    this.note,
    this.createdBy,
    this.createdAt,
  });

  final String id;
  final String name;
  final String? color;
  final String? note;
  final String? createdBy;
  final DateTime? createdAt;
}

class Category {
  const Category({
    required this.id,
    required this.name,
    required this.icon,
    required this.color,
    required this.type,
    this.isDefault = false,
  });

  final String id;
  final String name;

  /// Material icon name, as stored by the original app.
  final String icon;

  /// Hex colour string such as `#FF8A65`.
  final String color;
  final TransactionType type;
  final bool isDefault;
}

/// Recurring monthly cap for one expense category, scoped to a household.
class CategoryBudget {
  const CategoryBudget({required this.categoryId, required this.amount});

  final String categoryId;
  final double amount;
}

class Home {
  const Home({
    required this.id,
    required this.name,
    required this.displayId,
    required this.ownerId,
    required this.memberIds,
    this.createdAt,
  });

  final String id;
  final String name;

  /// Six-character invite code.
  final String displayId;
  final String ownerId;
  final List<String> memberIds;
  final DateTime? createdAt;
}

enum HouseholdNotificationType {
  transactionAdded,
  transactionUpdated,
  transactionDeleted,

  /// A monthly report is ready (D-033); addressed to one member.
  reportReady,
}

class HouseholdNotification {
  const HouseholdNotification({
    required this.id,
    required this.type,
    required this.message,
    required this.createdBy,
    required this.createdByName,
    required this.createdAt,
    this.transactionId,
    this.homeId,
    this.readBy = const [],
    this.reportId,
    this.recipientId,
  });

  final String id;
  final HouseholdNotificationType type;
  final String message;
  final String createdBy;
  final String createdByName;
  final DateTime createdAt;
  final String? transactionId;
  final String? homeId;
  final List<String> readBy;
  final String? reportId;

  /// Set when the notification is for one member only.
  final String? recipientId;

  /// Whether [userId] should see it in their activity list.
  bool isFor(String userId) => recipientId == null || recipientId == userId;
}

/// A finding written by the server's scheduled insight job
/// (`homes/{homeId}/insights`).
class InsightCard {
  const InsightCard({
    required this.id,
    required this.kind,
    required this.title,
    required this.body,
    required this.createdAt,
    this.reportId,
  });

  final String id;
  final String kind;
  final String title;
  final String body;
  final DateTime createdAt;

  /// The month's report, on a `month_review` card (D-033).
  final String? reportId;
}
