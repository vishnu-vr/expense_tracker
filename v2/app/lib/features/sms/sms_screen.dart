import 'dart:async';

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
  GemmaState? _gemma;
  Timer? _gemmaPoll;
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
    _gemmaPoll?.cancel();
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
    if (_status?.autoAdd ?? false) {
      _checkNano();
      _gemmaRun((d) => d.gemmaStatus());
    }
  }

  /// Runs a Gemma action and keeps checking every 2 s while a download is queued or running.
  Future<void> _gemmaRun(Future<GemmaState> Function(SmsDetection) action) async {
    GemmaState g;
    try {
      g = await action(ref.read(smsDetectionProvider));
    } catch (_) {
      g = const GemmaState(GemmaStatus.notAvailable);
    }
    if (!mounted) return;
    setState(() => _gemma = g);
    _gemmaPoll?.cancel();
    if (g.status.busy) {
      _gemmaPoll = Timer(const Duration(seconds: 2), () => _gemmaRun((d) => d.gemmaStatus()));
    }
  }

  Future<void> _deleteGemma() async {
    final ok = await confirmDialog(
      context,
      title: 'Delete the on-device model?',
      message: 'It frees about ${GemmaState.size(_gemma?.total ?? 0)}. Category suggestions turn off until you download it again or pick Cloud.',
      confirmLabel: 'Delete',
      destructive: true,
    );
    if (!ok || !mounted) return;
    await _gemmaRun((d) => d.gemmaDelete());
    await _run((d) => d.status());
    if (mounted) showToast(context, 'On-device model deleted');
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
    if (on) {
      _checkNano();
      _gemmaRun((d) => d.gemmaStatus());
    }
  }

  /// Gemini Nano is listed as a choice only on phones that support it.
  bool get _nanoSupported => switch (_nano?.status) {
        NanoStatus.available ||
        NanoStatus.downloadable ||
        NanoStatus.waitingForWifi ||
        NanoStatus.downloading ||
        NanoStatus.preparing ||
        NanoStatus.busy ||
        NanoStatus.noSpace =>
          true,
        _ => false,
      };

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
                      _CategorySuggestions(
                        status: s,
                        gemma: _gemma,
                        nano: _nano,
                        nanoSupported: _nanoSupported,
                        checkingNano: _checkingNano,
                        onMode: (mode) => _run((d) => d.setAiMode(mode)),
                        onCloudModel: (key) => _run((d) => d.setCloudModel(key)),
                        onDownload: () => _gemmaRun((d) => d.gemmaDownload()),
                        onCancel: () => _gemmaRun((d) => d.gemmaCancel()),
                        onDelete: _deleteGemma,
                        onCheckNano: _checkNano,
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

/// "Category suggestions" (D-032): Off, Cloud (Flash-Lite or Flash), Gemma 3 1B
/// downloaded to the phone, or Gemini Nano where supported. Whatever the AI
/// suggests waits for the user's approval.
class _CategorySuggestions extends StatelessWidget {
  const _CategorySuggestions({
    required this.status,
    required this.gemma,
    required this.nano,
    required this.nanoSupported,
    required this.checkingNano,
    required this.onMode,
    required this.onCloudModel,
    required this.onDownload,
    required this.onCancel,
    required this.onDelete,
    required this.onCheckNano,
  });

  final SmsDetectionStatus status;
  final GemmaState? gemma;
  final NanoState? nano;
  final bool nanoSupported;
  final bool checkingNano;
  final ValueChanged<CategoryAiMode> onMode;
  final ValueChanged<String> onCloudModel;
  final VoidCallback onDownload;
  final VoidCallback onCancel;
  final VoidCallback onDelete;
  final VoidCallback onCheckNano;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final mode = status.aiMode;
    final g = gemma;
    Widget option(CategoryAiMode m, String title, Widget below) => MergeSemantics(
          child: Semantics(
            inMutuallyExclusiveGroup: true,
            checked: mode == m,
            child: ListRow(
              title: title,
              leading: Icon(
                mode == m ? Icons.radio_button_checked : Icons.radio_button_unchecked,
                color: mode == m ? p.accent : p.muted,
              ),
              below: below,
              onTap: mode == m ? null : () => onMode(m),
            ),
          ),
        );
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      const SizedBox(height: 20),
      Text('CATEGORY SUGGESTIONS', style: LedgerText.eyebrow(p.muted)),
      const SizedBox(height: 4),
      Text(
        'For payees your entries and remembered payees cannot place, and replies that are not clear. An AI suggestion is never saved by itself: it waits for your Approve.',
        style: LedgerText.body(size: 13, color: p.muted, height: 1.45),
      ),
      const SizedBox(height: 8),
      option(CategoryAiMode.off, 'Off', const _Note('Only your entries, remembered payees and known shops.')),
      option(
        CategoryAiMode.cloud,
        'Cloud',
        Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const _Note('Sends only the payee name or your reply words, never the SMS.'),
          if (mode == CategoryAiMode.cloud) ...[
            const SizedBox(height: 6),
            Wrap(spacing: 8, children: [
              for (final (key, label) in const [('flash-lite', 'Flash-Lite'), ('flash', 'Flash')])
                ChoiceChip(
                  label: Text(label),
                  selected: status.cloudModel == key,
                  onSelected: (_) => onCloudModel(key),
                ),
            ]),
            const SizedBox(height: 2),
            const _Note('Flash-Lite costs less; Flash is a little better.'),
          ],
        ]),
      ),
      option(
        CategoryAiMode.gemma,
        'On-device: Gemma 3 1B',
        Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const _Note('Nothing leaves the phone.'),
          const SizedBox(height: 2),
          _Note(g?.hint ?? 'Checking…'),
          if (g?.status == GemmaStatus.downloading) ...[
            const SizedBox(height: 6),
            LinearProgressIndicator(value: g!.progress),
          ],
          if (g != null) ...[
            const SizedBox(height: 4),
            Wrap(spacing: 8, children: [
              if (g.status == GemmaStatus.ready)
                TextButton(onPressed: onDelete, child: const Text('Delete'))
              else if (g.status.busy)
                TextButton(onPressed: onCancel, child: const Text('Cancel download'))
              else
                TextButton(
                  onPressed: onDownload,
                  child: Text(switch (g.status) {
                    GemmaStatus.failed => 'Try again',
                    // Asks the bucket again: the model may have been uploaded since.
                    GemmaStatus.notAvailable || GemmaStatus.signIn || GemmaStatus.noSpace => 'Check again',
                    _ => 'Download on Wi-Fi',
                  }),
                ),
            ]),
          ],
          if (mode == CategoryAiMode.gemma && g?.status != GemmaStatus.ready)
            const _Note('Suggestions start once the model is on the phone.'),
          const SizedBox(height: 4),
          Text(
            'Gemma is provided under and subject to the Gemma Terms of Use found at ai.google.dev/gemma/terms.',
            style: LedgerText.body(size: 11, color: p.muted, height: 1.35),
          ),
        ]),
      ),
      if (nanoSupported)
        option(
          CategoryAiMode.nano,
          'Gemini Nano',
          _Note('On this phone, while the review list is open. ${nano!.status.hint}', detail: nano!.code),
        )
      else
        ListRow(
          title: 'Gemini Nano',
          below: _Note(nano?.status.hint ?? 'Checking…', detail: nano?.code),
          trailing: TextButton(
            onPressed: checkingNano ? null : onCheckNano,
            child: const Text('Check again'),
          ),
        ),
    ]);
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
