import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:share_plus/share_plus.dart';

import '../../app/providers.dart';
import '../../core/data/repositories.dart';
import '../../core/data/session.dart';
import '../../core/domain/agent_models.dart';
import '../../core/domain/analysis.dart';
import '../../core/domain/models.dart';
import '../../core/format/money.dart';
import '../../core/theme/ledger_theme.dart';
import '../../core/widgets/common.dart';

class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});

  Future<void> _export(BuildContext context, WidgetRef ref) async {
    final now = ref.read(nowProvider);
    final choice = await showModalBottomSheet<DateTimeRange>(
      context: context,
      builder: (context) => _ExportSheet(now: now),
    );
    if (choice == null || !context.mounted) return;
    final end = DateTime(choice.end.year, choice.end.month, choice.end.day + 1);
    final txs = (ref.read(transactionsProvider).value ?? const <Transaction>[])
        .where((t) => !t.date.isBefore(choice.start) && t.date.isBefore(end))
        .toList();
    if (txs.isEmpty) {
      showToast(context, 'No entries in that period.');
      return;
    }
    final cats = ref.read(categoryByIdProvider);
    final tags = ref.read(tagByIdProvider);
    final csv = buildTransactionsCsv(
      txs,
      categoryName: (id) => cats[id]?.name ?? 'Uncategorized',
      tagName: (id) => tags[id]?.name ?? '',
      userName: ref.read(memberNameProvider),
    );
    String day(DateTime d) =>
        '${d.year}${d.month.toString().padLeft(2, '0')}${d.day.toString().padLeft(2, '0')}';
    final name = 'track-expense-${day(choice.start)}-${day(choice.end)}.csv';
    try {
      await SharePlus.instance.share(ShareParams(
        files: [XFile.fromData(utf8.encode(csv), mimeType: 'text/csv', name: name)],
        fileNameOverrides: [name],
        subject: 'Track Expense export',
      ));
    } catch (_) {
      if (context.mounted) showToast(context, 'Could not export. Try again.');
    }
  }

  Future<void> _chooseModel(BuildContext context, WidgetRef ref) async {
    final key = await showModalBottomSheet<String>(
      context: context,
      builder: (context) => _ModelSheet(selected: ref.read(agentModelProvider)),
    );
    if (key != null) ref.read(agentModelProvider.notifier).set(key);
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final p = context.palette;
    final session = ref.watch(sessionProvider).value;
    final user = session?.user;
    final home = ref.watch(homeProvider).value;
    final members = ref.watch(membersProvider).value ?? const <Member>[];
    final memberName = ref.watch(memberNameProvider);
    final sessionRepo = ref.read(sessionRepositoryProvider);

    Future<void> guarded(Future<void> Function() action) async {
      try {
        await action();
      } on SessionFailure catch (e) {
        if (context.mounted) showToast(context, e.message);
      } catch (_) {
        if (context.mounted) showToast(context, 'Something went wrong. Try again.');
      }
    }

    Widget nav(String title, String route, {String? subtitle}) => ListRow(
          title: title,
          subtitle: subtitle,
          onTap: () => context.push(route),
          trailing: Icon(Icons.chevron_right, color: p.muted),
        );

    return Scaffold(
      appBar: AppBar(title: const Text('Profile')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(24, 16, 24, 24),
        children: [
          Row(children: [
            CircleAvatar(
              radius: 26,
              backgroundColor: p.ink,
              foregroundImage: user?.photoUrl == null ? null : NetworkImage(user!.photoUrl!),
              child: Text(
                (user?.displayName ?? '?').characters.first.toUpperCase(),
                style: LedgerText.display(size: 20, color: p.onInk),
              ),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(user?.displayName ?? 'You',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: LedgerText.display(size: 18)),
                if (user?.email != null)
                  Text(user!.email!,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: LedgerText.body(size: 13, color: p.muted)),
              ]),
            ),
          ]),
          if (home != null) ...[
            const SizedBox(height: 24),
            const SectionTitle('Household'),
            LedgerCard(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(home.name, style: LedgerText.body(size: 16, weight: 600)),
                const SizedBox(height: 10),
                Row(children: [
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text('INVITE CODE', style: LedgerText.eyebrow(p.muted)),
                      const SizedBox(height: 2),
                      Text(home.displayId, style: LedgerText.display(size: 22, letterSpacing: 4)),
                    ]),
                  ),
                  OutlinedButton.icon(
                    onPressed: () async {
                      await Clipboard.setData(ClipboardData(text: home.displayId));
                      if (context.mounted) showToast(context, 'Invite code copied');
                    },
                    icon: const Icon(Icons.copy, size: 16),
                    label: const Text('Copy'),
                  ),
                ]),
                const SizedBox(height: 12),
                Text('MEMBERS (${members.length})', style: LedgerText.eyebrow(p.muted)),
                const SizedBox(height: 6),
                for (final m in members)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 4),
                    child: Row(children: [
                      Expanded(
                        child: Text(
                          m.id == user?.id ? '${memberName(m.id)} (you)' : memberName(m.id),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: LedgerText.body(size: 14),
                        ),
                      ),
                      if (m.id == home.ownerId) const Pill('Owner'),
                    ]),
                  ),
              ]),
            ),
          ],
          const SizedBox(height: 24),
          const SectionTitle('Appearance'),
          Segmented<ThemeMode>(
            options: const {
              ThemeMode.system: 'System',
              ThemeMode.light: 'Light',
              ThemeMode.dark: 'Dark',
            },
            selected: ref.watch(themeModeProvider),
            onChanged: ref.read(themeModeProvider.notifier).set,
          ),
          const SizedBox(height: 12),
          MergeSemantics(
            child: ListRow(
              topBorder: false,
              title: 'Hide amounts',
              subtitle: 'Mask every figure on screen',
              onTap: ref.read(hideAmountsProvider.notifier).toggle,
              trailing: Switch(
                value: ref.watch(hideAmountsProvider),
                onChanged: ref.read(hideAmountsProvider.notifier).set,
              ),
            ),
          ),
          const SizedBox(height: 12),
          const SectionTitle('Assistant'),
          ListRow(
            topBorder: false,
            title: 'Model',
            subtitle: agentModelOption(ref.watch(agentModelProvider)).label,
            onTap: () => _chooseModel(context, ref),
            trailing: Icon(Icons.chevron_right, size: 20, color: p.muted),
          ),
          const SizedBox(height: 12),
          const SectionTitle('Manage'),
          nav('Categories', '/categories'),
          nav('Tags', '/tags'),
          nav('Budgets', '/budgets-manage'),
          ListRow(
            title: 'Export to CSV',
            subtitle: 'Share your entries as a spreadsheet file',
            onTap: () => _export(context, ref),
            trailing: Icon(Icons.ios_share, size: 20, color: p.muted),
          ),
          if (defaultTargetPlatform == TargetPlatform.android)
            nav('Bank SMS detection', '/sms', subtitle: 'Suggest entries from transaction messages'),
          if (user?.isAdmin ?? false) ...[
            const SizedBox(height: 12),
            const SectionTitle('Admin'),
            nav('Billing & usage', '/admin/billing', subtitle: 'What the app costs to run'),
          ],
          const SizedBox(height: 24),
          OutlinedButton(
            onPressed: () => guarded(() async {
              await ref.read(pushServiceProvider)?.unregister();
              await sessionRepo.signOut();
            }),
            child: const Text('Sign out'),
          ),
          if (home != null) ...[
            const SizedBox(height: 8),
            TextButton(
              style: TextButton.styleFrom(foregroundColor: p.danger),
              onPressed: () async {
                final ok = await confirmDialog(
                  context,
                  title: 'Leave ${home.name}?',
                  message:
                      'You will stop seeing this household\'s ledger. Entries you added stay with the household.',
                  confirmLabel: 'Leave',
                  destructive: true,
                );
                if (ok) await guarded(sessionRepo.leaveHome);
              },
              child: const Text('Leave household'),
            ),
          ],
        ],
      ),
    );
  }
}

class _ExportSheet extends StatelessWidget {
  const _ExportSheet({required this.now});

  final DateTime now;

  @override
  Widget build(BuildContext context) {
    final thisMonth = DateTimeRange(
        start: DateTime(now.year, now.month), end: DateTime(now.year, now.month + 1, 0));
    final lastMonth = DateTimeRange(
        start: DateTime(now.year, now.month - 1), end: DateTime(now.year, now.month, 0));
    final thisYear = DateTimeRange(start: DateTime(now.year), end: DateTime(now.year, 12, 31));
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(24, 0, 24, 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Export to CSV', style: LedgerText.display(size: 18)),
            const SizedBox(height: 8),
            ListRow(
              topBorder: false,
              title: 'This month',
              subtitle: monthYear(thisMonth.start),
              onTap: () => Navigator.pop(context, thisMonth),
            ),
            ListRow(
              title: 'Last month',
              subtitle: monthYear(lastMonth.start),
              onTap: () => Navigator.pop(context, lastMonth),
            ),
            ListRow(
              title: 'This year',
              subtitle: '${now.year}',
              onTap: () => Navigator.pop(context, thisYear),
            ),
            ListRow(
              title: 'Choose dates',
              onTap: () async {
                final picked = await showDateRangePicker(
                  context: context,
                  firstDate: DateTime(2000),
                  lastDate: DateTime(now.year + 1, 12, 31),
                );
                if (picked != null && context.mounted) Navigator.pop(context, picked);
              },
            ),
          ],
        ),
      ),
    );
  }
}

/// Picks the assistant model (D-027). Same layout as [_ExportSheet].
class _ModelSheet extends StatelessWidget {
  const _ModelSheet({required this.selected});

  final String selected;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(24, 0, 24, 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Assistant model', style: LedgerText.display(size: 18)),
            const SizedBox(height: 8),
            for (final (i, o) in agentModelOptions.indexed)
              Semantics(
                selected: o.key == selected,
                child: ListRow(
                  topBorder: i > 0,
                  title: o.label,
                  subtitle: o.note,
                  onTap: () => Navigator.pop(context, o.key),
                  trailing: o.key == selected
                      ? Icon(Icons.check, size: 20, color: p.ink)
                      : const SizedBox(width: 20),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
