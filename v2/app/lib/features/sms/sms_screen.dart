import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/providers.dart';

import '../../core/data/sms_detection.dart';
import '../../core/theme/ledger_theme.dart';
import '../../core/widgets/common.dart';

class SmsScreen extends ConsumerStatefulWidget {
  const SmsScreen({super.key});

  @override
  ConsumerState<SmsScreen> createState() => _SmsScreenState();
}

class _SmsScreenState extends ConsumerState<SmsScreen> with WidgetsBindingObserver {
  SmsDetectionStatus? _status;
  NanoState? _nano;
  var _checkingNano = false;
  var _failed = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _refresh();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  // Permissions may have changed while the user was in system settings.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _refresh();
  }

  Future<void> _run(Future<SmsDetectionStatus> Function(SmsDetection) action) async {
    try {
      final s = await action(ref.read(smsDetectionProvider));
      if (mounted) {
        setState(() {
          _status = s;
          _failed = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _failed = true);
    }
  }

  Future<void> _refresh() async {
    await _run((d) => d.status());
    ref.invalidate(smsReviewQueueProvider);
    if (_status?.autoAdd ?? false) _checkNano();
  }

  Future<void> _checkNano() async {
    if (_checkingNano) return;
    setState(() => _checkingNano = true);
    NanoState n;
    try {
      n = await ref.read(smsDetectionProvider).nanoStatus();
    } catch (_) {
      n = const NanoState(NanoStatus.error, 'no answer');
    }
    if (mounted) {
      setState(() {
        _nano = n;
        _checkingNano = false;
      });
    }
  }

  Future<void> _forgetPayees() async {
    final ok = await confirmDialog(
      context,
      title: 'Forget remembered payees?',
      message:
          'Payments to people and shops you labelled before will be asked about again. Saved entries stay as they are.',
      confirmLabel: 'Forget',
      destructive: true,
    );
    if (!ok || !mounted) return;
    await _run((d) => d.forgetPayees());
    if (mounted) showToast(context, 'Remembered payees forgotten');
  }

  Future<void> _toggleAutoAdd(bool on) async {
    await _run((d) => d.setAutoAdd(on));
    if (on) _checkNano();
  }

  Future<void> _toggle(bool on) async {
    if (!on) return _run((d) => d.setEnabled(false));
    await _run((d) => d.requestPermissions());
    final s = _status;
    if (s == null || !mounted) return;
    if (s.smsGranted) {
      await _run((d) => d.setEnabled(true));
    } else {
      showToast(context, 'SMS permission is needed to detect bank messages.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final s = _status;
    return Scaffold(
      appBar: AppBar(title: const Text('Bank SMS detection')),
      body: _failed
          ? const Center(child: EmptyState('Not available on this device.'))
          : s == null
              ? const Center(child: CircularProgressIndicator())
              : ListView(
                  padding: const EdgeInsets.fromLTRB(24, 16, 24, 24),
                  children: [
                    Text(
                      s.autoAdd
                          ? 'When a bank or UPI message arrives, Track Expense adds the entry when it is sure of the category, and asks you to review the rest.'
                          : 'When a bank or UPI message arrives, Track Expense can suggest an entry with the amount filled in. You review and save it; nothing is added on its own.',
                      style: LedgerText.body(height: 1.45),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      'Messages are read on this phone only. The message itself is never stored or uploaded; only the amount, date, payee and bank with the last digits of the account are kept, in the entry or the review list.',
                      style: LedgerText.body(size: 13, color: p.muted, height: 1.45),
                    ),
                    const SizedBox(height: 16),
                    MergeSemantics(
                      child: ListRow(
                        title: 'Suggest entries from bank messages',
                        onTap: () => _toggle(!s.enabled),
                        trailing: Switch(value: s.enabled, onChanged: _toggle),
                      ),
                    ),
                    MergeSemantics(
                      child: ListRow(
                        title: 'Auto-add confident entries',
                        subtitle: 'Experimental. Needs detection on.',
                        onTap: s.enabled ? () => _toggleAutoAdd(!s.autoAdd) : null,
                        trailing: Switch(
                          value: s.autoAdd,
                          onChanged: s.enabled ? _toggleAutoAdd : null,
                        ),
                      ),
                    ),
                    if (s.autoAdd) ...[
                      ListRow(
                        title: 'Review detected entries',
                        onTap: () => context.push('/sms/review'),
                        trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                          Text('${ref.watch(smsReviewQueueProvider).value?.length ?? 0}',
                              style: LedgerText.body(size: 14, color: p.muted, tabular: true)),
                          const SizedBox(width: 4),
                          Icon(Icons.chevron_right, color: p.muted),
                        ]),
                      ),
                      MergeSemantics(
                        child: ListRow(
                          title: 'Evening reminder',
                          below: _Note('About 8:30 pm, if detected payments still need a description'),
                          onTap: () => _run((d) => d.setEveningReminder(!s.evening)),
                          trailing: Switch(
                            value: s.evening,
                            onChanged: (on) => _run((d) => d.setEveningReminder(on)),
                          ),
                        ),
                      ),
                      ListRow(
                        title: 'On-device AI',
                        below: _Note(
                          _nano?.status.hint ?? 'Checking…',
                          detail: _nano?.code,
                        ),
                        trailing: TextButton(
                          onPressed: _checkingNano ? null : _checkNano,
                          child: const Text('Check again'),
                        ),
                      ),
                      ListRow(
                        title: 'Forget remembered payees',
                        below: _Note(switch (s.rememberedPayees) {
                          0 => 'None yet. Payees you label are added on their own next time.',
                          1 => '1 payee is added on its own with the category you gave.',
                          final n => '$n payees are added on their own with the categories you gave.',
                        }),
                        onTap: s.rememberedPayees == 0 ? null : _forgetPayees,
                      ),
                    ],
                    _Check(label: 'SMS permission', ok: s.smsGranted),
                    _Check(label: 'Notification permission', ok: s.notificationsGranted),
                    if (s.enabled && !s.working) ...[
                      const SizedBox(height: 16),
                      Text(
                        'Suggestions are paused until both permissions are allowed.',
                        style: LedgerText.body(size: 14, color: p.warning, height: 1.4),
                      ),
                    ],
                    if (!s.smsGranted || !s.notificationsGranted) ...[
                      const SizedBox(height: 16),
                      OutlinedButton(
                        onPressed: () => _run((d) => d.requestPermissions()),
                        child: const Text('Allow permissions'),
                      ),
                      const SizedBox(height: 8),
                      TextButton(
                        onPressed: () => ref.read(smsDetectionProvider).openAppSettings(),
                        child: const Text('Open app settings'),
                      ),
                    ],
                  ],
                ),
    );
  }
}

/// A muted line under a row title that wraps instead of being cut off.
class _Note extends StatelessWidget {
  const _Note(this.text, {this.detail});

  final String text;
  final String? detail;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(text, style: LedgerText.body(size: 12, color: p.muted, height: 1.35)),
      if (detail != null) ...[
        const SizedBox(height: 2),
        Text(detail!, style: LedgerText.body(size: 11, color: p.muted)),
      ],
    ]);
  }
}

class _Check extends StatelessWidget {
  const _Check({required this.label, required this.ok});

  final String label;
  final bool ok;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return ListRow(
      title: label,
      trailing: Row(mainAxisSize: MainAxisSize.min, children: [
        Icon(ok ? Icons.check : Icons.close, size: 18, color: ok ? p.positive : p.muted),
        const SizedBox(width: 6),
        Text(ok ? 'Allowed' : 'Not allowed',
            style: LedgerText.body(size: 14, color: ok ? p.positive : p.muted)),
      ]),
    );
  }
}
