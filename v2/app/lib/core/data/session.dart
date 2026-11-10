import 'dart:async';

class AppUser {
  const AppUser({required this.id, this.email, this.name, this.photoUrl});

  final String id;
  final String? email;
  final String? name;
  final String? photoUrl;

  String get displayName {
    if (name != null && name!.trim().isNotEmpty) return name!.trim();
    return email?.split('@').first ?? 'You';
  }
}

/// Who is signed in and which household they belong to.
class Session {
  const Session({this.loading = false, this.user, this.homeId});

  const Session.loading() : this(loading: true);

  final bool loading;
  final AppUser? user;
  final String? homeId;

  bool get signedIn => user != null;
  bool get ready => user != null && homeId != null;
}

/// A sign-in or household action failed with a message fit to show the user.
class SessionFailure implements Exception {
  const SessionFailure(this.message);

  final String message;

  @override
  String toString() => message;
}

abstract class SessionRepository {
  Stream<Session> watch();

  Future<void> signInWithEmail(String email, String password);
  Future<void> signInWithGoogle();
  Future<void> signInWithApple();
  Future<void> signOut();

  Future<void> createHome(String name);

  /// Joins by six-character invite code.
  Future<void> joinHome(String code);
  Future<void> leaveHome();
}

/// In-memory session for development and tests.
class DemoSessionRepository implements SessionRepository {
  DemoSessionRepository({Session initial = _signedIn}) : _session = initial;

  static const _user = AppUser(id: 'u1', email: 'asha@example.com', name: 'Asha');
  static const _signedIn = Session(user: _user, homeId: 'demo');

  Session _session;
  final _controller = StreamController<Session>.broadcast();

  void _set(Session s) {
    _session = s;
    _controller.add(s);
  }

  @override
  Stream<Session> watch() => Stream.multi((c) {
        c.add(_session);
        final sub = _controller.stream.listen(c.add);
        c.onCancel = sub.cancel;
      });

  @override
  Future<void> signInWithEmail(String email, String password) async {
    if (password == 'wrong') {
      throw const SessionFailure('Wrong email or password.');
    }
    _set(_signedIn);
  }

  @override
  Future<void> signInWithGoogle() async => _set(_signedIn);

  @override
  Future<void> signInWithApple() async => _set(_signedIn);

  @override
  Future<void> signOut() async => _set(const Session());

  @override
  Future<void> createHome(String name) async => _set(_signedIn);

  @override
  Future<void> joinHome(String code) async {
    if (code.toUpperCase() != 'DEMO42') {
      throw const SessionFailure('No household found for that code.');
    }
    _set(_signedIn);
  }

  @override
  Future<void> leaveHome() async => _set(const Session(user: _user));
}
