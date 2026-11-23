import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/foundation.dart' show visibleForTesting;

import '../../domain/report.dart';
import '../repositories.dart';
import 'mappers.dart';

/// Household reports in Firestore (`homes/{homeId}/reports`, read-only for
/// clients) and the `generateReport` / `refreshReport` callables (D-033).
class FirebaseReportsRepository implements ReportsRepository {
  FirebaseReportsRepository({
    required FirebaseFirestore firestore,
    required this._functions,
    required this.homeId,
    required this.timeZone,
  }) : _db = firestore;

  final FirebaseFirestore _db;
  final FirebaseFunctions _functions;
  final String homeId;

  /// IANA zone, so "this month" and "today" mean the user's own.
  final String timeZone;

  CollectionReference<Map<String, dynamic>> get _reports =>
      _db.collection('homes').doc(homeId).collection('reports');

  @override
  Stream<List<ReportSummary>> watchReports() => _reports
      .orderBy('createdAt', descending: true)
      .limit(100)
      .snapshots()
      .map((s) => sortReports([for (final d in s.docs) ?reportFromDoc(d.id, d.data())?.summary]));

  @override
  Stream<Report?> watchReport(String id) =>
      _reports.doc(id).snapshots().map((d) => d.data() == null ? null : reportFromDoc(d.id, d.data()!));

  /// The `generateReport` request body (see `backend/SCHEMA.md`).
  @visibleForTesting
  static Map<String, Object?> generatePayload({
    required DayRange period,
    required CompareMode compare,
    DayRange? customCompare,
    required String timeZone,
    String? model,
  }) =>
      {
        'from': dayKey(period.from),
        'to': dayKey(period.to),
        'compare': {
          'mode': compare.key,
          if (compare == CompareMode.custom && customCompare != null) ...{
            'from': dayKey(customCompare.from),
            'to': dayKey(customCompare.to),
          },
        },
        'timeZone': timeZone,
        'model': ?model,
      };

  static ReportException _error(FirebaseFunctionsException e) => ReportException(switch (e.code) {
        'resource-exhausted' => e.message ?? 'You have made the most reports allowed today. Try again tomorrow.',
        'invalid-argument' => e.message ?? 'Those dates cannot be reported on.',
        'not-found' => 'That report no longer exists.',
        'unavailable' || 'deadline-exceeded' => 'Could not reach the server. Try again.',
        _ => 'Could not make the report. Try again.',
      });

  HttpsCallable _callable(String name) =>
      _functions.httpsCallable(name, options: HttpsCallableOptions(timeout: const Duration(minutes: 2)));

  @override
  Future<String> generate({
    required DayRange period,
    required CompareMode compare,
    DayRange? customCompare,
    String? model,
  }) async {
    try {
      final res = await _callable('generateReport').call<Object?>(generatePayload(
        period: period,
        compare: compare,
        customCompare: customCompare,
        timeZone: timeZone,
        model: model,
      ));
      final data = res.data;
      if (data is Map && data['reportId'] is String) return data['reportId'] as String;
      throw const ReportException('Could not make the report. Try again.');
    } on FirebaseFunctionsException catch (e) {
      throw _error(e);
    }
  }

  @override
  Future<void> refresh(String id, {String? model}) async {
    try {
      await _callable('refreshReport').call<Object?>({'reportId': id, 'timeZone': timeZone, 'model': ?model});
    } on FirebaseFunctionsException catch (e) {
      throw _error(e);
    }
  }
}
