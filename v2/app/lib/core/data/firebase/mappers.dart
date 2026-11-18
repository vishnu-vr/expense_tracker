/// Firestore document <-> domain model mapping for schema v2
/// (see `v2/backend/SCHEMA.md`). Kept free of Firestore calls so it is testable.
library;

import 'package:cloud_firestore/cloud_firestore.dart' show Timestamp;

import '../../domain/models.dart';
import '../agent.dart';
import '../repositories.dart';

DateTime? dateFrom(Object? v) => switch (v) {
      Timestamp t => t.toDate(),
      String s => DateTime.tryParse(s)?.toLocal(),
      int ms => DateTime.fromMillisecondsSinceEpoch(ms),
      _ => null,
    };

TransactionType typeFrom(Object? v) =>
    v == 'income' ? TransactionType.income : TransactionType.expense;

List<String> stringList(Object? v) =>
    v is List ? [for (final e in v) if (e is String) e] : const [];

Transaction? transactionFromDoc(String id, Map<String, dynamic> d) {
  final date = dateFrom(d['date']);
  final amount = d['amount'];
  if (date == null || amount is! num) return null;
  return Transaction(
    id: id,
    amount: amount.toDouble(),
    categoryId: (d['categoryId'] as String?) ?? '',
    date: date,
    type: typeFrom(d['type']),
    note: d['note'] as String?,
    userId: d['userId'] as String?,
    userEmail: d['userEmail'] as String?,
    homeId: d['homeId'] as String?,
    tagIds: stringList(d['tagIds']),
    source: d['source'] == 'sms' ? 'sms' : null,
    autoAdded: d['autoAdded'] == true,
  );
}

/// Fields the owner may write. Ownership fields and timestamps are added by
/// the repository. `source` is written only when set, so editing an entry
/// added from SMS keeps its marker. `autoAdded` is written only when true
/// (D-031); the repository removes it on an update that clears it.
Map<String, dynamic> transactionToDoc(Transaction t) => {
      'amount': t.amount,
      'categoryId': t.categoryId,
      'date': Timestamp.fromDate(t.date),
      'note': (t.note ?? '').trim().isEmpty ? null : t.note!.trim(),
      'type': t.type.name,
      'tagIds': t.tagIds,
      if (t.source != null) 'source': t.source,
      if (t.autoAdded) 'autoAdded': true,
    };

Category categoryFromDoc(String id, Map<String, dynamic> d) => Category(
      id: id,
      name: (d['name'] as String?) ?? id,
      icon: (d['icon'] as String?) ?? 'category',
      color: (d['color'] as String?) ?? '#3B82F6',
      type: typeFrom(d['type']),
    );

Map<String, dynamic> categoryToDoc(Category c) =>
    {'name': c.name, 'icon': c.icon, 'color': c.color, 'type': c.type.name};

Tag tagFromDoc(String id, Map<String, dynamic> d) => Tag(
      id: id,
      name: (d['name'] as String?) ?? '',
      color: d['color'] as String?,
      note: d['note'] as String?,
      createdBy: d['createdBy'] as String?,
      createdAt: dateFrom(d['createdAt']),
    );

/// Budgets written by old app versions per month carry `year`/`month`; those
/// are ignored, as in the original app.
CategoryBudget? budgetFromDoc(String id, Map<String, dynamic> d) {
  final amount = d['amount'];
  if (amount is! num || amount <= 0 || d.containsKey('year') || d.containsKey('month')) {
    return null;
  }
  return CategoryBudget(categoryId: (d['categoryId'] as String?) ?? id, amount: amount.toDouble());
}

Home homeFromDoc(String id, Map<String, dynamic> d) => Home(
      id: id,
      name: (d['name'] as String?) ?? 'Household',
      displayId: (d['displayId'] as String?) ?? '',
      ownerId: (d['ownerId'] as String?) ?? '',
      memberIds: stringList(d['memberIds']),
      createdAt: dateFrom(d['createdAt']),
    );

Member memberFromDoc(String id, Map<String, dynamic> d) => Member(
      id: id,
      name: (d['name'] as String?) ?? '',
      email: d['email'] as String?,
      photoUrl: d['photoURL'] as String?,
    );

HouseholdNotification? notificationFromDoc(String id, Map<String, dynamic> d) {
  final at = dateFrom(d['createdAt']);
  if (at == null) return null;
  return HouseholdNotification(
    id: id,
    type: switch (d['type']) {
      'transaction_updated' => HouseholdNotificationType.transactionUpdated,
      'transaction_deleted' => HouseholdNotificationType.transactionDeleted,
      _ => HouseholdNotificationType.transactionAdded,
    },
    message: (d['message'] as String?) ?? '',
    createdBy: (d['createdBy'] as String?) ?? '',
    createdByName: (d['createdByName'] as String?) ?? '',
    createdAt: at,
    transactionId: d['transactionId'] as String?,
    homeId: d['homeId'] as String?,
    readBy: stringList(d['readBy']),
  );
}

/// Null when the document is unusable or [userId] has dismissed it.
InsightCard? insightFromDoc(String id, Map<String, dynamic> d, String userId) {
  final at = dateFrom(d['createdAt']);
  final title = d['title'];
  if (at == null || title is! String || title.isEmpty) return null;
  if (stringList(d['dismissedBy']).contains(userId)) return null;
  return InsightCard(
    id: id,
    kind: (d['kind'] as String?) ?? '',
    title: title,
    body: (d['body'] as String?) ?? '',
    createdAt: at,
  );
}

int _count(Object? v) => v is num && v.isFinite && v > 0 ? v.round() : 0;

AgentUsage agentUsageFrom(Object? v) {
  if (v is! Map) return const AgentUsage();
  return AgentUsage(
    questions: _count(v['questions']),
    inputTokens: _count(v['inputTokens']),
    outputTokens: _count(v['outputTokens']),
    modelCalls: _count(v['modelCalls']),
  );
}

/// `homes/{homeId}/aiThreads/{id}`. Null without an `updatedAt` yet (a
/// pending server timestamp) so the list never shows a dateless row.
AgentThreadSummary? threadSummaryFromDoc(String id, Map<String, dynamic> d) {
  final updatedAt = dateFrom(d['updatedAt']) ?? dateFrom(d['createdAt']);
  if (updatedAt == null) return null;
  final title = d['title'];
  return AgentThreadSummary(
    id: id,
    title: title is String && title.trim().isNotEmpty ? title : 'Conversation',
    createdAt: dateFrom(d['createdAt']),
    updatedAt: updatedAt,
    lastMessagePreview: (d['lastMessagePreview'] as String?) ?? '',
    lastModel: d['lastModel'] as String?,
    usage: agentUsageFrom(d['usage']),
  );
}

/// `…/messages/{id}`: blocks parsed with [AgentBlock.fromJson]; unknown ones
/// are dropped. Null when nothing renderable is left.
AgentStoredMessage? storedMessageFromDoc(Map<String, dynamic> d) {
  final raw = d['blocks'];
  final blocks = [
    if (raw is List)
      for (final b in raw)
        if (b is Map) ?AgentBlock.fromJson(Map<String, dynamic>.from(b)),
  ];
  if (blocks.isEmpty) return null;
  return AgentStoredMessage(
    fromUser: d['role'] != 'assistant',
    blocks: blocks,
    createdAt: dateFrom(d['createdAt']),
  );
}

ProposalStatus proposalStatusFrom(Object? v) => switch (v) {
      'applied' => ProposalStatus.applied,
      'rejected' => ProposalStatus.rejected,
      _ => ProposalStatus.pending,
    };
