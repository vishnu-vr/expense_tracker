import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/providers.dart';
import '../../core/data/session.dart';
import '../../core/theme/ledger_theme.dart';
import '../../core/widgets/common.dart';

/// Shown to a signed-in user who is not in a household yet.
class OnboardingScreen extends ConsumerStatefulWidget {
  const OnboardingScreen({super.key});

  @override
  ConsumerState<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends ConsumerState<OnboardingScreen> {
  var _join = false;
  final _name = TextEditingController();
  final _code = TextEditingController();
  String? _error;
  var _busy = false;

  @override
  void dispose() {
    _name.dispose();
    _code.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final value = (_join ? _code : _name).text.trim();
    if (value.isEmpty || (_join && value.length != 6)) {
      setState(() => _error = _join
          ? 'Enter the 6-character invite code.'
          : 'Give your household a name.');
      return;
    }
    FocusScope.of(context).unfocus();
    setState(() {
      _busy = true;
      _error = null;
    });
    final session = ref.read(sessionRepositoryProvider);
    try {
      await (_join ? session.joinHome(value.toUpperCase()) : session.createHome(value));
    } on SessionFailure catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'Something went wrong. Try again.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text('Set up your household',
                      style: LedgerText.display(size: 28, letterSpacing: -0.6, height: 1.15)),
                  const SizedBox(height: 8),
                  Text(
                    'Everyone in a household shares one ledger. Start a new one, or join with a code from someone already in it.',
                    style: LedgerText.body(color: p.muted, height: 1.45),
                  ),
                  const SizedBox(height: 24),
                  Segmented<bool>(
                    options: const {false: 'Create new', true: 'Join with code'},
                    selected: _join,
                    onChanged: (j) => setState(() {
                      _join = j;
                      _error = null;
                    }),
                  ),
                  const SizedBox(height: 16),
                  if (_join)
                    TextField(
                      controller: _code,
                      maxLength: 6,
                      autocorrect: false,
                      textCapitalization: TextCapitalization.characters,
                      inputFormatters: [
                        FilteringTextInputFormatter.allow(RegExp('[a-zA-Z0-9]')),
                      ],
                      style: LedgerText.display(size: 22, letterSpacing: 4),
                      decoration: InputDecoration(
                        labelText: 'Invite code',
                        counterText: '',
                        errorText: _error,
                      ),
                      onSubmitted: (_) => _submit(),
                    )
                  else
                    TextField(
                      controller: _name,
                      maxLength: 40,
                      textCapitalization: TextCapitalization.words,
                      decoration: InputDecoration(
                        labelText: 'Household name',
                        counterText: '',
                        errorText: _error,
                      ),
                      onSubmitted: (_) => _submit(),
                    ),
                  const SizedBox(height: 16),
                  FilledButton(
                    onPressed: _busy ? null : _submit,
                    child: Text(_busy
                        ? (_join ? 'Joining…' : 'Creating…')
                        : (_join ? 'Join household' : 'Create household')),
                  ),
                  const SizedBox(height: 12),
                  TextButton(
                    onPressed: _busy ? null : ref.read(sessionRepositoryProvider).signOut,
                    child: const Text('Sign out'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
