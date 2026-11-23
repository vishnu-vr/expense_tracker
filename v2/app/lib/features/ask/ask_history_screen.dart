import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/providers.dart';
import '../../core/data/agent.dart';
import '../../core/format/money.dart';
import '../../core/theme/ledger_theme.dart';
import '../../core/widgets/common.dart';

/// Ask › Past conversations: the signed-in user's own threads, newest first.
/// Tapping one returns its id to the Ask screen, which opens it.
class AskHistoryScreen extends ConsumerWidget {
  const AskHistoryScreen({super.key});

  void _open(BuildContext context, String id) {
    if (context.canPop()) {
      context.pop(id);
    } else {
      context.go('/ask?thread=${Uri.encodeQueryComponent(id)}');
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final threads = ref.watch(agentThreadsProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Past conversations')),
      body: threads.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (_, _) => ListView(
          padding: const EdgeInsets.symmetric(horizontal: 24),
          children: [
            EmptyState(
              'Could not load your conversations.',
              action: 'Retry',
              onAction: () => ref.invalidate(agentThreadsProvider),
            ),
          ],
        ),
        data: (list) => list.isEmpty
            ? ListView(
                padding: const EdgeInsets.symmetric(horizontal: 24),
                children: const [
                  EmptyState(
                    'No past conversations yet. Questions you ask are saved here, and only you can see them.',
                  ),
                ],
              )
            : ListView(
                padding: const EdgeInsets.fromLTRB(24, 8, 24, 24),
                children: [
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Text(
                      'Only you can see your conversations.',
                      style: LedgerText.body(size: 13, color: context.palette.muted),
                    ),
                  ),
                  for (final (i, t) in list.indexed)
                    _ThreadRow(thread: t, topBorder: i > 0, onTap: () => _open(context, t.id)),
                ],
              ),
      ),
    );
  }
}

class _ThreadRow extends ConsumerWidget {
  const _ThreadRow({required this.thread, required this.onTap, this.topBorder = true});

  final AgentThreadSummary thread;
  final VoidCallback onTap;
  final bool topBorder;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final p = context.palette;
    final now = ref.watch(nowProvider);
    final mask = ref.watch(moneyProvider).text;
    final t = thread;
    final meta = [
      relativeDay(t.updatedAt, now),
      if (t.usage.questions > 0) t.usage.label,
    ].join(' · ');
    return Semantics(
      button: true,
      child: InkWell(
        onTap: onTap,
        child: Container(
          constraints: const BoxConstraints(minHeight: 56),
          padding: const EdgeInsets.symmetric(vertical: 12),
          decoration: BoxDecoration(
            border: topBorder ? Border(top: BorderSide(color: p.line)) : null,
          ),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text(mask(t.title),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: LedgerText.body(weight: 500, height: 1.3)),
            if (t.lastMessagePreview.isNotEmpty) ...[
              const SizedBox(height: 4),
              Text(mask(t.lastMessagePreview),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: LedgerText.body(size: 14, color: p.muted, height: 1.35)),
            ],
            const SizedBox(height: 6),
            Text(meta,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: LedgerText.body(size: 12, color: p.muted, tabular: true)),
          ]),
        ),
      ),
    );
  }
}
