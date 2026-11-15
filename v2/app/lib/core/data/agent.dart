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
  /// continue a conversation. [model] is the user's model key (D-027); null
  /// means the server default.
  Stream<AgentEvent> ask({String? threadId, required String message, String? model});

  Future<void> resolveProposal({
    required String threadId,
    required String proposalId,
    required bool accept,
  });
}

/// Running totals the server keeps on a thread (D-025).
class AgentUsage {
  const AgentUsage({
    this.questions = 0,
    this.inputTokens = 0,
    this.outputTokens = 0,
    this.modelCalls = 0,
  });

  final int questions;
  final int inputTokens;
  final int outputTokens;
  final int modelCalls;

  int get tokens => inputTokens + outputTokens;

  /// "6 questions · 48k tokens".
  String get label => '${questionCount(questions)} · ${tokenCount(tokens)}';
}

/// Joins a number and its unit so a narrow line never wraps between them.
const _nbsp = '\u00a0';

/// "1 question", "6 questions" (non-breaking space).
String questionCount(int n) => n == 1 ? '1${_nbsp}question' : '$n${_nbsp}questions';

/// "850 tokens", "48k tokens", "1.2M tokens" (non-breaking space).
String tokenCount(int n) {
  if (n < 1000) return '$n${_nbsp}tokens';
  if (n < 999500) return '${(n / 1000).round()}k${_nbsp}tokens';
  final m = n / 1000000;
  return '${m >= 10 ? m.round() : m.toStringAsFixed(1).replaceFirst(RegExp(r'\.0$'), '')}M${_nbsp}tokens';
}

/// One past conversation in the list. Only the signed-in user's own threads
/// are ever listed (threads are personal).
class AgentThreadSummary {
  const AgentThreadSummary({
    required this.id,
    required this.title,
    required this.updatedAt,
    this.createdAt,
    this.lastMessagePreview = '',
    this.lastModel,
    this.usage = const AgentUsage(),
  });

  final String id;
  final String title;
  final DateTime updatedAt;
  final DateTime? createdAt;
  final String lastMessagePreview;
  final String? lastModel;
  final AgentUsage usage;
}

/// Server-side state of a stored proposal.
enum ProposalStatus { pending, applied, rejected }

/// A stored message of a past conversation.
class AgentStoredMessage {
  const AgentStoredMessage({required this.fromUser, required this.blocks, this.createdAt});

  final bool fromUser;
  final List<AgentBlock> blocks;
  final DateTime? createdAt;
}

/// A past conversation with its messages (oldest first) and the status of
/// each proposal in it, so resolved ones do not offer Confirm again.
class AgentThread {
  const AgentThread({
    required this.summary,
    required this.messages,
    this.proposalStatus = const {},
  });

  final AgentThreadSummary summary;
  final List<AgentStoredMessage> messages;
  final Map<String, ProposalStatus> proposalStatus;
}

/// The signed-in user's past conversations.
abstract class AgentHistoryRepository {
  /// Newest first (most recently updated), at most 50.
  Stream<List<AgentThreadSummary>> watchThreads();

  /// Null when the thread does not exist or belongs to someone else.
  Future<AgentThread?> loadThread(String threadId);
}

/// Sample conversations for demo mode and tests.
class DemoAgentHistoryRepository implements AgentHistoryRepository {
  DemoAgentHistoryRepository(DateTime now, {List<AgentThread>? threads})
      : _threads = threads ?? _samples(now);

  final List<AgentThread> _threads;

  static List<AgentThread> _samples(DateTime now) {
    final yesterday = now.subtract(const Duration(days: 1, hours: 2));
    final lastWeek = now.subtract(const Duration(days: 6, hours: 5));
    return [
      AgentThread(
        summary: AgentThreadSummary(
          id: 'demo-dining',
          title: 'Why was October dining so high?',
          createdAt: yesterday.subtract(const Duration(minutes: 4)),
          updatedAt: yesterday,
          lastMessagePreview: 'Swiggy and Zomato orders made up most of the rise in October.',
          lastModel: 'vertexai/gemini-3.8-flash',
          usage: const AgentUsage(questions: 2, inputTokens: 13240, outputTokens: 430, modelCalls: 5),
        ),
        messages: [
          const AgentStoredMessage(fromUser: true, blocks: [TextBlock('Why was October dining so high?')]),
          AgentStoredMessage(fromUser: false, blocks: [
            const StatBlock(label: 'Food in October', value: '₹9,840', caption: '₹6,120 in September'),
            const BarsBlock(title: 'Where it went', items: [
              BarItem(label: 'Swiggy', value: 4210, display: '₹4,210'),
              BarItem(label: 'Zomato', value: 2890, display: '₹2,890'),
              BarItem(label: 'Restaurants', value: 2740, display: '₹2,740'),
            ]),
            const TextBlock('Swiggy and Zomato orders made up most of the rise in October.'),
          ]),
          const AgentStoredMessage(fromUser: true, blocks: [TextBlock('Set a food budget for me')]),
          const AgentStoredMessage(fromUser: false, blocks: [
            TextBlock('A budget a little under October keeps you honest without being unrealistic.'),
            ProposalBlock(
              proposalId: 'demo-p-applied',
              action: 'set_budget',
              summary: 'Set a monthly Food budget of ₹8,000',
            ),
          ]),
        ],
        proposalStatus: const {'demo-p-applied': ProposalStatus.applied},
      ),
      AgentThread(
        summary: AgentThreadSummary(
          id: 'demo-bills',
          title: 'Which bills went up this year?',
          createdAt: lastWeek,
          updatedAt: lastWeek,
          lastMessagePreview: 'Netflix went from ₹649 to ₹799 in October; electricity is up 18% on last year.',
          lastModel: 'vertexai/gemini-3.8-flash',
          usage: const AgentUsage(questions: 1, inputTokens: 6610, outputTokens: 205, modelCalls: 2),
        ),
        messages: const [
          AgentStoredMessage(fromUser: true, blocks: [TextBlock('Which bills went up this year?')]),
          AgentStoredMessage(fromUser: false, blocks: [
            BarsBlock(title: 'Price changes', items: [
              BarItem(label: 'Netflix', value: 150, display: '+₹150'),
              BarItem(label: 'Electricity', value: 412, display: '+₹412'),
            ]),
            TextBlock('Netflix went from ₹649 to ₹799 in October; electricity is up 18% on last year.'),
            ProposalBlock(
              proposalId: 'demo-p-pending',
              action: 'set_budget',
              summary: 'Set a monthly Entertainment budget of ₹1,000',
            ),
          ]),
        ],
        proposalStatus: const {'demo-p-pending': ProposalStatus.pending},
      ),
    ];
  }

  @override
  Stream<List<AgentThreadSummary>> watchThreads() async* {
    yield [for (final t in _threads) t.summary]
      ..sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
  }

  @override
  Future<AgentThread?> loadThread(String threadId) async =>
      _threads.where((t) => t.summary.id == threadId).firstOrNull;
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
  Stream<AgentEvent> ask({String? threadId, required String message, String? model}) async* {
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

