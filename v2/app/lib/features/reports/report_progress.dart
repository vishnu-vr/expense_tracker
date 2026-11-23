import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/domain/report.dart';
import '../../core/theme/ledger_theme.dart';

/// Spinner, a wait message that changes as time passes, and the seconds so
/// far, so a report that takes 20–30 s does not look stuck (D-033).
class ReportProgress extends StatefulWidget {
  const ReportProgress({super.key, required this.modelKey, this.refreshing = false});

  final String? modelKey;
  final bool refreshing;

  @override
  State<ReportProgress> createState() => _ReportProgressState();
}

class _ReportProgressState extends State<ReportProgress> {
  final _watch = Stopwatch()..start();
  late final Timer _tick;

  @override
  void initState() {
    super.initState();
    _tick = Timer.periodic(const Duration(seconds: 1), (_) => setState(() {}));
  }

  @override
  void dispose() {
    _tick.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final elapsed = _watch.elapsed;
    return Row(children: [
      const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)),
      const SizedBox(width: 12),
      Expanded(
        child: Text(
          reportWaitMessage(widget.modelKey, elapsed, refreshing: widget.refreshing),
          style: LedgerText.body(size: 13, color: p.muted),
        ),
      ),
      const SizedBox(width: 8),
      Text('${elapsed.inSeconds} s', style: LedgerText.body(size: 13, color: p.muted)),
    ]);
  }
}
