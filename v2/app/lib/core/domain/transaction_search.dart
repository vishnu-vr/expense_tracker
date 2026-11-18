/// View-layer match for the transactions list search.
/// Ported from `src/app/core/utils/transaction-search.ts`.
library;

import 'models.dart';

bool transactionMatchesQuery(
  Transaction transaction,
  String query, {
  String? categoryName,
  List<String> tagNames = const [],
}) {
  final q = query.trim().toLowerCase();
  if (q.isEmpty) return true;

  final amount = transaction.amount;
  // Whole amounts match as "1200", not "1200.0".
  final plainAmount =
      amount == amount.truncateToDouble() ? amount.toInt().toString() : '$amount';

  final haystacks = <String>[
    categoryName ?? '',
    transaction.note ?? '',
    transaction.type.name,
    transaction.userEmail ?? '',
    plainAmount,
    amount.toStringAsFixed(2),
    ...tagNames,
  ];
  return haystacks.any((value) => value.toLowerCase().contains(q));
}
