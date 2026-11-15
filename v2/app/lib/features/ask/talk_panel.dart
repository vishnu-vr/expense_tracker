import 'package:flutter/material.dart';

import '../../core/domain/voice.dart';
import '../../core/theme/ledger_theme.dart';
import 'talk_controller.dart';

/// The Talk panel (D-028): replaces the Ask input while a voice conversation
/// runs. Shows the state, the live transcript and End. A tap anywhere on it
/// interrupts an answer, or pauses listening so the transcript can be fixed.
/// Turns appear in the thread above, like typed ones.
class TalkPanel extends StatefulWidget {
  const TalkPanel({super.key, required this.controller});

  final TalkController controller;

  @override
  State<TalkPanel> createState() => _TalkPanelState();
}

class _TalkPanelState extends State<TalkPanel> {
  final _edit = TextEditingController();
  late final AppLifecycleListener _lifecycle;
  var _wasPaused = false;

  TalkController get _c => widget.controller;

  @override
  void initState() {
    super.initState();
    _c.addListener(_changed);
    // Leaving the app (or locking the phone) ends the conversation.
    _lifecycle = AppLifecycleListener(onHide: () {
      if (!_c.requestingPermission) _c.end(TalkEnd.backgrounded);
    });
  }

  void _changed() {
    if (!mounted) return;
    final paused = _c.phase == TalkPhase.paused;
    if (paused && !_wasPaused) _edit.text = _c.transcript;
    _wasPaused = paused;
    setState(() {});
  }

  @override
  void dispose() {
    _c.removeListener(_changed);
    _lifecycle.dispose();
    _edit.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final phase = _c.phase;
    final (icon, label, hint) = switch (phase) {
      TalkPhase.listening => (Icons.mic, 'Listening', 'Ask a question, or say "stop" to end.'),
      TalkPhase.thinking => (Icons.more_horiz, 'Thinking', 'Working out the answer…'),
      TalkPhase.speaking => (Icons.volume_up_outlined, 'Speaking', 'Tap to interrupt.'),
      TalkPhase.paused => (Icons.pause, 'Paused', 'Fix the question, then send it.'),
      _ => (Icons.mic_none, 'Starting', 'Getting the microphone ready…'),
    };
    final transcript = _c.transcript;

    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: phase == TalkPhase.paused ? null : _c.tap,
      child: Container(
        decoration: BoxDecoration(
          color: p.surface,
          border: Border(top: BorderSide(color: p.ink)),
        ),
        padding: const EdgeInsets.fromLTRB(24, 14, 24, 12),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(children: [
              Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(
                  color: phase == TalkPhase.listening ? p.accent : p.track,
                  shape: BoxShape.circle,
                ),
                child: Icon(icon,
                    size: 20, color: phase == TalkPhase.listening ? p.onAccent : p.ink),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Semantics(
                  liveRegion: true,
                  child: Text(label, style: LedgerText.display(size: 18)),
                ),
              ),
              OutlinedButton(
                style: OutlinedButton.styleFrom(minimumSize: const Size(64, 44)),
                onPressed: () => _c.end(TalkEnd.endButton),
                child: const Text('End'),
              ),
            ]),
            if (_c.note != null) ...[
              const SizedBox(height: 6),
              Text(_c.note!, style: LedgerText.body(size: 12, color: p.muted)),
            ],
            const SizedBox(height: 10),
            if (phase == TalkPhase.paused) ...[
              TextField(
                controller: _edit,
                minLines: 1,
                maxLines: 3,
                autofocus: true,
                textCapitalization: TextCapitalization.sentences,
                textInputAction: TextInputAction.send,
                onSubmitted: _c.sendEdited,
                decoration: const InputDecoration(hintText: 'Your question'),
              ),
              const SizedBox(height: 8),
              Row(children: [
                Expanded(
                  child: OutlinedButton(
                    style: OutlinedButton.styleFrom(minimumSize: const Size(64, 44)),
                    onPressed: _c.resume,
                    child: const Text('Listen again'),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: FilledButton(
                    style: FilledButton.styleFrom(
                      backgroundColor: p.ink,
                      foregroundColor: p.onInk,
                      minimumSize: const Size(64, 44),
                    ),
                    onPressed: () => _c.sendEdited(_edit.text),
                    child: const Text('Send'),
                  ),
                ),
              ]),
            ] else ...[
              ConstrainedBox(
                constraints: const BoxConstraints(minHeight: 44),
                child: Text(
                  transcript.isEmpty || phase == TalkPhase.speaking ? hint : transcript,
                  maxLines: 4,
                  overflow: TextOverflow.ellipsis,
                  style: transcript.isEmpty || phase == TalkPhase.speaking
                      ? LedgerText.body(size: 14, color: p.muted, height: 1.4)
                      : LedgerText.body(height: 1.4),
                ),
              ),
              if (phase == TalkPhase.listening && transcript.isNotEmpty)
                Text('Tap to pause and fix it.',
                    style: LedgerText.body(size: 12, color: p.muted)),
            ],
          ],
        ),
      ),
    );
  }
}
