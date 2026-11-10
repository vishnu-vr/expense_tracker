import '../domain/analysis.dart';
import '../domain/models.dart';
import '../format/money.dart';
import 'repositories.dart';

/// One piece of an assistant reply. Mirrors the block shapes returned by the
/// `askAgent` Cloud Function (see `v2/backend/SCHEMA.md`).
sealed class AgentBlock {
  const AgentBlock();

  /// Unknown or malformed blocks are dropped rather than breaking the reply.
  static AgentBlock? fromJson(Map<String, dynamic> j) {
    try {
      switch (j['type']) {
        case 'text':
          return TextBlock(j['text'] as String);
        case 'stat':
          return StatBlock(
            label: j['label'] as String,
            value: j['value'] as String,
            caption: j['caption'] as String?,
          );
        case 'bars':
          return BarsBlock(
            title: j['title'] as String?,
            items: [
              for (final i in j['items'] as List)
                BarItem(
                  label: i['label'] as String,
                  value: (i['value'] as num).toDouble(),
                  display: i['display'] as String,
                ),
            ],
          );
        case 'transactions':
          return TransactionsBlock([
            for (final i in j['items'] as List)
              AgentTransaction(
                id: i['id'] as String,
                note: (i['note'] as String?) ?? '',
                categoryName: (i['categoryName'] as String?) ?? '',
                amount: (i['amount'] as num).toDouble(),
                isIncome: i['type'] == 'income',
                date: DateTime.parse(i['date'] as String).toLocal(),
              ),
          ]);
        case 'proposal':
          return ProposalBlock(
            proposalId: j['proposalId'] as String,
            action: j['action'] as String,
            summary: j['summary'] as String,
          );
      }
    } catch (_) {}
    return null;
  }
}

class TextBlock extends AgentBlock {
  const TextBlock(this.text);

  final String text;
}

class StatBlock extends AgentBlock {
  const StatBlock({required this.label, required this.value, this.caption});

  final String label;
  final String value;
  final String? caption;
}

class BarItem {
  const BarItem({required this.label, required this.value, required this.display});

  final String label;
  final double value;
  final String display;
}

class BarsBlock extends AgentBlock {
  const BarsBlock({this.title, required this.items});

  final String? title;
  final List<BarItem> items;
}

class AgentTransaction {
  const AgentTransaction({
    required this.id,
    required this.note,
    required this.categoryName,
    required this.amount,
    required this.isIncome,
    required this.date,
  });

  final String id;
  final String note;
  final String categoryName;
  final double amount;
  final bool isIncome;
  final DateTime date;
}

class TransactionsBlock extends AgentBlock {
  const TransactionsBlock(this.items);

  final List<AgentTransaction> items;
}

/// A change the assistant suggests. Nothing is written until the user confirms.
class ProposalBlock extends AgentBlock {
  const ProposalBlock({required this.proposalId, required this.action, required this.summary});

  final String proposalId;
  final String action;
  final String summary;
}

sealed class AgentEvent {
  const AgentEvent();
}

/// What the assistant is doing right now ("Comparing months…").
class AgentStatus extends AgentEvent {
  const AgentStatus(this.text);

  final String text;
}

/// Streamed text of the reply so far.
class AgentTextDelta extends AgentEvent {
  const AgentTextDelta(this.delta);

  final String delta;
}

class AgentDone extends AgentEvent {
  const AgentDone({required this.threadId, required this.blocks});

  final String threadId;
  final List<AgentBlock> blocks;
}

abstract class AgentRepository {
  /// Sends [message]; pass the [threadId] from the previous [AgentDone] to
  /// continue a conversation.
  Stream<AgentEvent> ask({String? threadId, required String message});

  Future<void> resolveProposal({
    required String threadId,
    required String proposalId,
    required bool accept,
  });
}

/// Stand-in assistant for development: it answers every question with a real
/// month-over-month comparison computed from the household's data. It does not
/// understand the question.
class DemoAgentRepository implements AgentRepository {
  DemoAgentRepository(this._household, this._transactions, this._now, this._categoryName);

  final HouseholdRepository _household;
  final List<Transaction> Function() _transactions;
  final DateTime _now;
  final String Function(String id) _categoryName;
  final _proposals = <String, ({String categoryId, double amount})>{};

  @override
  Stream<AgentEvent> ask({String? threadId, required String message}) async* {
    yield const AgentStatus('Comparing the last two months…');
    final txs = _transactions();
    final thisStart = DateTime(_now.year, _now.month - 1);
    final prevStart = DateTime(_now.year, _now.month - 2);
    final cur = categoryBreakdown(txs, start: thisStart, end: DateTime(_now.year, _now.month));
    final prev = categoryBreakdown(txs, start: prevStart, end: thisStart);
    final prevBy = {for (final c in prev.categories) c.categoryId: c.total};
    final deltas = [
      for (final c in cur.categories)
        (id: c.categoryId, delta: c.total - (prevBy[c.categoryId] ?? 0), total: c.total),
    ]..sort((a, b) => b.delta.compareTo(a.delta));
    final risers = deltas.where((d) => d.delta > 0).take(3).toList();
    final diff = cur.total - prev.total;
    final a = monthName(thisStart.month), b = monthName(prevStart.month);

    final blocks = <AgentBlock>[
      TextBlock(diff >= 0
          ? '$a spending was higher than $b.'
          : '$a spending was lower than $b.'),
      StatBlock(
        label: '$a vs $b',
        value: formatSignedMoney(diff),
        caption: '${formatMoney(cur.total)} vs ${formatMoney(prev.total)}',
      ),
      if (risers.isNotEmpty)
        BarsBlock(title: 'Biggest increases', items: [
          for (final r in risers)
            BarItem(
              label: _categoryName(r.id),
              value: r.delta,
              display: formatSignedMoney(r.delta),
            ),
        ]),
    ];
    if (risers.isNotEmpty) {
      final top = risers.first;
      final amount = (top.total / 500).ceil() * 500.0;
      final id = 'p${_proposals.length + 1}';
      _proposals[id] = (categoryId: top.id, amount: amount);
      blocks.add(ProposalBlock(
        proposalId: id,
        action: 'set_budget',
        summary: 'Set ${_categoryName(top.id)} budget to ${formatMoney(amount)} a month',
      ));
    }
    yield AgentDone(threadId: threadId ?? 'demo-thread', blocks: blocks);
  }

  @override
  Future<void> resolveProposal({
    required String threadId,
    required String proposalId,
    required bool accept,
  }) async {
    final p = _proposals.remove(proposalId);
    if (accept && p != null) await _household.setBudget(p.categoryId, p.amount);
  }
}

