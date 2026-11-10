import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/providers.dart';
import '../../core/data/agent.dart';
import '../../core/format/money.dart';
import '../../core/theme/ledger_theme.dart';
import '../../core/widgets/common.dart';

enum ProposalState { pending, working, accepted, declined }

class ChatMessage {
  ChatMessage.user(String text)
      : fromUser = true,
        blocks = [TextBlock(text)];

  ChatMessage.assistant(this.blocks) : fromUser = false;

  final bool fromUser;
  final List<AgentBlock> blocks;
}

const _suggestions = [
  'Why was last month higher than the one before?',
  'Where can we cut back?',
  'Which bills went up this year?',
  'How are we doing against our budgets?',
];

class AskScreen extends ConsumerStatefulWidget {
  const AskScreen({super.key, this.initialQuestion});

  /// Sent automatically on open (used by "Ask why" on Home).
  final String? initialQuestion;

  @override
  ConsumerState<AskScreen> createState() => _AskScreenState();
}

class _AskScreenState extends ConsumerState<AskScreen> {
  final _input = TextEditingController();
  final _scroll = ScrollController();
  final _messages = <ChatMessage>[];
  final _proposals = <String, ProposalState>{};
  String? _threadId;
  var _busy = false;
  String? _status;
  var _streamed = '';

  @override
  void initState() {
    super.initState();
    final q = widget.initialQuestion;
    if (q != null && q.trim().isNotEmpty) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _send(q));
    }
  }

  @override
  void dispose() {
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  void _toEnd() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) {
        _scroll.animateTo(_scroll.position.maxScrollExtent,
            duration: const Duration(milliseconds: 250), curve: Curves.easeOut);
      }
    });
  }

  Future<void> _send(String text) async {
    final message = text.trim();
    if (message.isEmpty || _busy) return;
    _input.clear();
    setState(() {
      _messages.add(ChatMessage.user(message));
      _busy = true;
      _status = 'Thinking…';
      _streamed = '';
    });
    _toEnd();
    var answered = false;
    try {
      await for (final e
          in ref.read(agentRepositoryProvider).ask(threadId: _threadId, message: message)) {
        if (!mounted) return;
        setState(() {
          switch (e) {
            case AgentStatus(:final text):
              _status = text;
            case AgentTextDelta(:final delta):
              _streamed += delta;
            case AgentDone(:final threadId, :final blocks):
              answered = true;
              _threadId = threadId;
              _messages.add(ChatMessage.assistant(
                  blocks.isEmpty ? [const TextBlock('I could not find an answer to that.')] : blocks));
          }
        });
        _toEnd();
      }
      if (!answered) throw StateError('No answer');
    } catch (_) {
      if (mounted) {
        setState(() => _messages.add(ChatMessage.assistant(const [
              TextBlock('Something went wrong while answering. Check your connection and ask again.'),
            ])));
      }
    } finally {
      if (mounted) {
        setState(() {
          _busy = false;
          _status = null;
          _streamed = '';
        });
        _toEnd();
      }
    }
  }

  Future<void> _resolve(ProposalBlock b, bool accept) async {
    setState(() => _proposals[b.proposalId] = ProposalState.working);
    try {
      await ref.read(agentRepositoryProvider).resolveProposal(
          threadId: _threadId ?? '', proposalId: b.proposalId, accept: accept);
      if (!mounted) return;
      setState(() => _proposals[b.proposalId] =
          accept ? ProposalState.accepted : ProposalState.declined);
    } catch (_) {
      if (!mounted) return;
      setState(() => _proposals[b.proposalId] = ProposalState.pending);
      showToast(context, 'Could not apply that change. Try again.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Ask'),
        actions: [
          if (_messages.isNotEmpty && !_busy)
            TextButton(
              onPressed: () => setState(() {
                _messages.clear();
                _proposals.clear();
                _threadId = null;
              }),
              child: const Text('New chat'),
            ),
          const SizedBox(width: 12),
        ],
      ),
      body: Column(children: [
        Expanded(
          child: _messages.isEmpty
              ? _Welcome(onPick: _send)
              : ListView(
                  controller: _scroll,
                  padding: const EdgeInsets.fromLTRB(24, 20, 24, 12),
                  children: [
                    for (final m in _messages)
                      if (m.fromUser)
                        _UserBubble((m.blocks.first as TextBlock).text)
                      else
                        for (final b in m.blocks)
                          Padding(
                            padding: const EdgeInsets.only(bottom: 14),
                            child: _Block(
                              block: b,
                              proposalState: b is ProposalBlock
                                  ? (_proposals[b.proposalId] ?? ProposalState.pending)
                                  : null,
                              onResolve: _resolve,
                            ),
                          ),
                    if (_busy) ...[
                      if (_streamed.isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 10),
                          child: Text(_streamed, style: LedgerText.body(height: 1.5)),
                        ),
                      Semantics(
                        liveRegion: true,
                        child: Row(children: [
                          SizedBox(
                            width: 14,
                            height: 14,
                            child: CircularProgressIndicator(strokeWidth: 2, color: p.muted),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Text(_status ?? 'Thinking…',
                                style: LedgerText.body(size: 13, color: p.muted)),
                          ),
                        ]),
                      ),
                    ],
                  ],
                ),
        ),
        SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(24, 8, 24, 12),
            child: Row(children: [
              Expanded(
                child: TextField(
                  controller: _input,
                  minLines: 1,
                  maxLines: 4,
                  textCapitalization: TextCapitalization.sentences,
                  textInputAction: TextInputAction.send,
                  onSubmitted: _send,
                  decoration: const InputDecoration(hintText: 'Ask about your money'),
                ),
              ),
              const SizedBox(width: 8),
              IconButton.filled(
                tooltip: 'Send',
                onPressed: _busy ? null : () => _send(_input.text),
                style: IconButton.styleFrom(
                  backgroundColor: p.ink,
                  foregroundColor: p.onInk,
                  disabledBackgroundColor: p.track,
                  fixedSize: const Size(48, 48),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                ),
                icon: const Icon(Icons.arrow_upward, size: 20),
              ),
            ]),
          ),
        ),
      ]),
    );
  }
}

class _Welcome extends StatelessWidget {
  const _Welcome({required this.onPick});

  final ValueChanged<String> onPick;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return ListView(
      padding: const EdgeInsets.fromLTRB(24, 24, 24, 12),
      children: [
        Text('Ask anything about your household\'s money.',
            style: LedgerText.display(size: 24, height: 1.2, letterSpacing: -0.4)),
        const SizedBox(height: 8),
        Text(
          'Answers use your real entries. Figures are calculated, not estimated, and nothing is changed without your say-so.',
          style: LedgerText.body(color: p.muted, height: 1.45),
        ),
        const SizedBox(height: 20),
        for (final s in _suggestions)
          ListRow(
            title: s,
            onTap: () => onPick(s),
            trailing: Icon(Icons.north_east, size: 16, color: p.muted),
          ),
      ],
    );
  }
}

class _UserBubble extends StatelessWidget {
  const _UserBubble(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return Align(
      alignment: Alignment.centerRight,
      child: Container(
        margin: const EdgeInsets.only(bottom: 18, left: 48),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        decoration: BoxDecoration(color: p.ink, borderRadius: BorderRadius.circular(12)),
        child: Text(text, style: LedgerText.body(color: p.onInk, height: 1.4)),
      ),
    );
  }
}

class _Block extends ConsumerWidget {
  const _Block({required this.block, required this.proposalState, required this.onResolve});

  final AgentBlock block;
  final ProposalState? proposalState;
  final void Function(ProposalBlock, bool accept) onResolve;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final p = context.palette;
    final hidden = ref.watch(hideAmountsProvider);
    final mask = ref.watch(moneyProvider).text;
    final b = block;
    switch (b) {
      case TextBlock():
        return Text(mask(b.text), style: LedgerText.body(height: 1.5));

      case StatBlock():
        return Container(
          padding: const EdgeInsets.symmetric(vertical: 14),
          decoration: BoxDecoration(
            border: Border(top: BorderSide(color: p.ink), bottom: BorderSide(color: p.line)),
          ),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(b.label.toUpperCase(), style: LedgerText.eyebrow(p.muted)),
            const SizedBox(height: 4),
            FittedBox(
              fit: BoxFit.scaleDown,
              alignment: Alignment.centerLeft,
              child: Text(hidden ? hiddenAmount : b.value,
                  style: LedgerText.display(size: 34, letterSpacing: -0.7)),
            ),
            if (b.caption != null && !hidden)
              Text(b.caption!, style: LedgerText.body(size: 14, color: p.muted, tabular: true)),
          ]),
        );

      case BarsBlock():
        final max = b.items.fold(0.0, (m, i) => i.value.abs() > m ? i.value.abs() : m);
        return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          if (b.title != null) ...[
            Text(b.title!, style: LedgerText.body(size: 14, weight: 600)),
            const SizedBox(height: 8),
          ],
          for (final i in b.items)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Column(children: [
                Row(children: [
                  Expanded(
                    child: Text(i.label,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: LedgerText.body(size: 14)),
                  ),
                  Text(hidden ? hiddenAmount : i.display,
                      style: LedgerText.body(size: 14, tabular: true)),
                ]),
                const SizedBox(height: 5),
                ProgressBar(fraction: max > 0 ? i.value.abs() / max : 0, height: 8),
              ]),
            ),
        ]);

      case TransactionsBlock():
        final money = ref.watch(moneyProvider);
        final now = ref.watch(nowProvider);
        return Column(children: [
          for (final t in b.items)
            ListRow(
              onTap: () => context.push('/edit/${t.id}'),
              title: t.note.isEmpty ? t.categoryName : t.note,
              subtitle: '${t.categoryName} · ${shortDate(t.date, now)}',
              trailing: Text(
                money.signed(t.isIncome ? t.amount : -t.amount),
                style: LedgerText.body(color: t.isIncome ? p.positive : null, tabular: true),
              ),
            ),
        ]);

      case ProposalBlock():
        final state = proposalState ?? ProposalState.pending;
        return Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: p.surface,
            border: Border.all(color: p.ink),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text('SUGGESTED CHANGE', style: LedgerText.eyebrow(p.muted)),
            const SizedBox(height: 4),
            Text(mask(b.summary), style: LedgerText.body(weight: 500, height: 1.4)),
            const SizedBox(height: 12),
            switch (state) {
              ProposalState.accepted => Row(children: [
                  Icon(Icons.check, size: 18, color: p.positive),
                  const SizedBox(width: 8),
                  Text('Done', style: LedgerText.body(size: 14, weight: 600, color: p.positive)),
                ]),
              ProposalState.declined =>
                Text('Not applied', style: LedgerText.body(size: 14, color: p.muted)),
              _ => Row(children: [
                  Expanded(
                    child: FilledButton(
                      style: FilledButton.styleFrom(
                        backgroundColor: p.accent,
                        foregroundColor: p.onAccent,
                        minimumSize: const Size(64, 44),
                      ),
                      onPressed: state == ProposalState.working ? null : () => onResolve(b, true),
                      child: Text(state == ProposalState.working ? 'Applying…' : 'Confirm'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: OutlinedButton(
                      style: OutlinedButton.styleFrom(minimumSize: const Size(64, 44)),
                      onPressed: state == ProposalState.working ? null : () => onResolve(b, false),
                      child: const Text('Not now'),
                    ),
                  ),
                ]),
            },
          ]),
        );
    }
  }
}
