import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/foundation.dart' show visibleForTesting;

import '../agent.dart';

/// The assistant running in Cloud Functions (`askAgent`, `confirmProposal`).
class FunctionsAgentRepository implements AgentRepository {
  FunctionsAgentRepository(this._functions, {required this.timeZone});

  final FirebaseFunctions _functions;

  /// IANA zone name, e.g. `Asia/Kolkata`, so "this month" means the user's month.
  final String timeZone;

  static List<AgentBlock> _blocks(Object? raw) => [
        if (raw is List)
          for (final b in raw)
            if (b is Map) ?AgentBlock.fromJson(Map<String, dynamic>.from(b)),
      ];

  /// The `askAgent` request body (see `backend/SCHEMA.md`).
  @visibleForTesting
  static Map<String, Object?> askPayload({
    String? threadId,
    required String message,
    required String timeZone,
    String? model,
  }) =>
      {
        'threadId': ?threadId,
        'message': message,
        'timeZone': timeZone,
        'model': ?model,
      };

  @override
  Stream<AgentEvent> ask({String? threadId, required String message, String? model}) async* {
    final callable = _functions.httpsCallable(
      'askAgent',
      options: HttpsCallableOptions(timeout: const Duration(minutes: 3)),
    );
    var done = false;
    await for (final response in callable.stream<Object?, Object?>(
        askPayload(threadId: threadId, message: message, timeZone: timeZone, model: model))) {
      switch (response) {
        case Chunk(:final partialData):
          final chunk = partialData;
          if (chunk is! Map) continue;
          if (chunk['type'] == 'status' && chunk['text'] is String) {
            yield AgentStatus(chunk['text'] as String);
          } else if (chunk['type'] == 'text' && chunk['delta'] is String) {
            yield AgentTextDelta(chunk['delta'] as String);
          }
        case Result(:final result):
          final data = result.data;
          if (data is! Map || data['threadId'] is! String) {
            throw StateError('Unexpected askAgent response');
          }
          done = true;
          yield AgentDone(threadId: data['threadId'] as String, blocks: _blocks(data['blocks']));
      }
    }
    // A server-side failure can end the stream without a result or an error.
    if (!done) throw StateError('askAgent ended without a result');
  }

  @override
  Future<void> resolveProposal({
    required String threadId,
    required String proposalId,
    required bool accept,
  }) =>
      _functions.httpsCallable('confirmProposal').call({
        'threadId': threadId,
        'proposalId': proposalId,
        'accept': accept,
      });
}
