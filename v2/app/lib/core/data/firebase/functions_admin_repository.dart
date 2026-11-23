import 'package:cloud_functions/cloud_functions.dart';

import '../admin.dart';

/// The `getAdminDashboard` callable (admins only; see backend/SCHEMA.md).
class FunctionsAdminRepository implements AdminRepository {
  FunctionsAdminRepository(this._functions);

  final FirebaseFunctions _functions;

  @override
  Future<AdminDashboard> dashboard(String month) async {
    try {
      final result = await _functions
          .httpsCallable('getAdminDashboard', options: HttpsCallableOptions(timeout: const Duration(seconds: 70)))
          .call<Object?>({'month': month});
      final data = result.data;
      if (data is! Map) throw const AdminFailure('Unexpected response. Try again.');
      return AdminDashboard.fromJson(Map<String, dynamic>.from(data), fallbackMonth: month);
    } on FirebaseFunctionsException catch (e) {
      throw AdminFailure(switch (e.code) {
        'permission-denied' => 'This account is not an admin.',
        'unavailable' => 'Could not reach billing data. Check your connection and try again.',
        'invalid-argument' => 'That month is not available.',
        _ => 'Could not load billing data. Try again.',
      });
    }
  }
}
