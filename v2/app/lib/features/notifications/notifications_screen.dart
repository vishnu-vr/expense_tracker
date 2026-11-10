import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/providers.dart';
import '../../core/domain/models.dart';
import '../../core/format/money.dart';
import '../../core/theme/ledger_theme.dart';
import '../../core/widgets/common.dart';

String _ago(DateTime at, DateTime now) {
  final d = now.difference(at);
  if (d.inMinutes < 1) return 'Just now';
  if (d.inMinutes < 60) return '${d.inMinutes} min ago';
  if (d.inHours < 24) return '${d.inHours} h ago';
  if (d.inDays < 7) return '${d.inDays} d ago';
  return shortDate(at, now);
}

class NotificationsScreen extends ConsumerWidget {
  const NotificationsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final p = context.palette;
    final all = ref.watch(notificationsProvider).value;
    final unread = {for (final n in ref.watch(unreadNotificationsProvider)) n.id};
    final now = ref.watch(nowProvider);
    final txIds = {
      for (final t in ref.watch(transactionsProvider).value ?? const <Transaction>[]) t.id,
    };
    final repo = ref.read(householdRepositoryProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Activity'),
        actions: [
          if (unread.isNotEmpty)
            TextButton(
              onPressed: () => repo.markNotificationsRead(unread.toList()),
              child: const Text('Mark all read'),
            ),
          const SizedBox(width: 12),
        ],
      ),
      body: all == null
          ? const Center(child: CircularProgressIndicator())
          : all.isEmpty
              ? const Center(child: EmptyState('Nothing yet. Changes by other members show up here.'))
              : ListView(
                  padding: const EdgeInsets.fromLTRB(24, 8, 24, 24),
                  children: [
                    for (final n in all)
                      ListRow(
                        topBorder: n != all.first,
                        onTap: () {
                          repo.markNotificationsRead([n.id]);
                          final id = n.transactionId;
                          if (id != null && txIds.contains(id)) context.push('/edit/$id');
                        },
                        leading: Container(
                          width: 8,
                          height: 8,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            color: unread.contains(n.id) ? p.accent : Colors.transparent,
                          ),
                        ),
                        title: ref.watch(moneyProvider).text(n.message),
                        subtitle: _ago(n.createdAt, now),
                      ),
                  ],
                ),
    );
  }
}
