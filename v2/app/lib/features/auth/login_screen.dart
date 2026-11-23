import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/providers.dart';
import '../../core/data/session.dart';
import '../../core/theme/ledger_theme.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  String? _error;
  String? _busy; // which button is working

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _run(String key, Future<void> Function(SessionRepository) action) async {
    FocusScope.of(context).unfocus();
    setState(() {
      _busy = key;
      _error = null;
    });
    try {
      await action(ref.read(sessionRepositoryProvider));
    } on SessionFailure catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'Something went wrong. Try again.');
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  void _emailSignIn() {
    final email = _email.text.trim();
    if (!email.contains('@') || _password.text.length < 6) {
      setState(() => _error = 'Enter your email and a password of at least 6 characters.');
      return;
    }
    _run('email', (s) => s.signInWithEmail(email, _password.text));
  }

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final busy = _busy != null;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: AutofillGroup(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text('Track Expense',
                        style: LedgerText.display(size: 36, letterSpacing: -1, height: 1.1)),
                    const SizedBox(height: 8),
                    Text('Your household ledger.',
                        style: LedgerText.body(size: 16, color: p.muted)),
                    const SizedBox(height: 32),
                    if (_error != null) ...[
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          border: Border.all(color: p.danger),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Text(_error!,
                            style: LedgerText.body(size: 14, color: p.danger, height: 1.4)),
                      ),
                      const SizedBox(height: 16),
                    ],
                    TextField(
                      controller: _email,
                      keyboardType: TextInputType.emailAddress,
                      autofillHints: const [AutofillHints.email],
                      autocorrect: false,
                      textInputAction: TextInputAction.next,
                      decoration: const InputDecoration(labelText: 'Email'),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: _password,
                      obscureText: true,
                      autofillHints: const [AutofillHints.password],
                      onSubmitted: (_) => _emailSignIn(),
                      decoration: const InputDecoration(labelText: 'Password'),
                    ),
                    const SizedBox(height: 16),
                    FilledButton(
                      onPressed: busy ? null : _emailSignIn,
                      child: Text(_busy == 'email' ? 'Signing in…' : 'Sign in'),
                    ),
                    const SizedBox(height: 24),
                    Row(children: [
                      const Expanded(child: Divider()),
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 12),
                        child: Text('or', style: LedgerText.body(size: 13, color: p.muted)),
                      ),
                      const Expanded(child: Divider()),
                    ]),
                    const SizedBox(height: 24),
                    OutlinedButton(
                      onPressed: busy ? null : () => _run('google', (s) => s.signInWithGoogle()),
                      child: Text(_busy == 'google' ? 'Opening Google…' : 'Continue with Google'),
                    ),
                    if (defaultTargetPlatform == TargetPlatform.iOS) ...[
                      const SizedBox(height: 12),
                      OutlinedButton(
                        onPressed: busy ? null : () => _run('apple', (s) => s.signInWithApple()),
                        child: Text(_busy == 'apple' ? 'Opening Apple…' : 'Continue with Apple'),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
