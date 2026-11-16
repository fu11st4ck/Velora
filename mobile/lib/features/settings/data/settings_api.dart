import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api_client.dart';
import '../../../core/api/failure.dart';
import '../../../core/auth/session.dart';
import 'organization.dart';

final settingsApiProvider = Provider<SettingsApi>(
  (ref) => SettingsApi(ref.watch(dioProvider)),
);

/// Remote data source for the business profile, tax rates, team and the user's own devices
/// (docs/api-specification.md §3.2). Throws [Failure].
class SettingsApi {
  SettingsApi(this._dio);
  final Dio _dio;

  Future<Organization> organization() => _guard(() async {
    final res = await _dio.get<Map<String, dynamic>>('/organization');
    return Organization.fromJson(res.data!['data'] as Map<String, dynamic>);
  });

  /// Sends only [changes]; a null value clears an optional text field.
  Future<Organization> updateOrganization(Map<String, Object?> changes) =>
      _guard(() async {
        final res = await _dio.patch<Map<String, dynamic>>(
          '/organization',
          data: changes,
        );
        return Organization.fromJson(res.data!['data'] as Map<String, dynamic>);
      });

  Future<List<ManagedTaxRate>> taxRates() => _guard(() async {
    final res = await _dio.get<Map<String, dynamic>>(
      '/tax-rates',
      queryParameters: {'includeInactive': true},
    );
    return (res.data!['data'] as List<dynamic>)
        .map((r) => ManagedTaxRate.fromJson(r as Map<String, dynamic>))
        .toList();
  });

  Future<ManagedTaxRate> createTaxRate({
    required String name,
    required int rateBp,
    required bool isDefault,
  }) => _guard(() async {
    final res = await _dio.post<Map<String, dynamic>>(
      '/tax-rates',
      data: {'name': name, 'rateBp': rateBp, 'isDefault': isDefault},
    );
    return ManagedTaxRate.fromJson(res.data!['data'] as Map<String, dynamic>);
  });

  Future<ManagedTaxRate> updateTaxRate(
    String id, {
    String? name,
    bool? isDefault,
    bool? isActive,
  }) => _guard(() async {
    final res = await _dio.patch<Map<String, dynamic>>(
      '/tax-rates/$id',
      data: {'name': ?name, 'isDefault': ?isDefault, 'isActive': ?isActive},
    );
    return ManagedTaxRate.fromJson(res.data!['data'] as Map<String, dynamic>);
  });

  Future<List<TeamMember>> members() => _guard(() async {
    final res = await _dio.get<Map<String, dynamic>>('/organization/members');
    return (res.data!['data'] as List<dynamic>)
        .map((m) => TeamMember.fromJson(m as Map<String, dynamic>))
        .toList();
  });

  Future<TeamMember> invite({
    required String fullName,
    required String email,
    required Role role,
  }) => _guard(() async {
    final res = await _dio.post<Map<String, dynamic>>(
      '/organization/members',
      data: {
        'fullName': fullName,
        'email': email,
        'role': role.name.toUpperCase(),
      },
    );
    return TeamMember.fromJson(res.data!['data'] as Map<String, dynamic>);
  });

  Future<TeamMember> updateMember(
    String memberId, {
    Role? role,
    bool? isActive,
  }) => _guard(() async {
    final res = await _dio.patch<Map<String, dynamic>>(
      '/organization/members/$memberId',
      data: {'role': ?role?.name.toUpperCase(), 'isActive': ?isActive},
    );
    return TeamMember.fromJson(res.data!['data'] as Map<String, dynamic>);
  });

  Future<List<DeviceSession>> sessions() => _guard(() async {
    final res = await _dio.get<Map<String, dynamic>>('/auth/sessions');
    return (res.data!['data'] as List<dynamic>)
        .map((s) => DeviceSession.fromJson(s as Map<String, dynamic>))
        .toList();
  });

  Future<void> revokeSession(String id) =>
      _guard(() => _dio.delete<void>('/auth/sessions/$id'));

  Future<T> _guard<T>(Future<T> Function() call) async {
    try {
      return await call();
    } on DioException catch (e) {
      throw Failure.from(e);
    }
  }
}

final organizationProvider = FutureProvider.autoDispose<Organization>(
  (ref) => ref.watch(settingsApiProvider).organization(),
);

final taxRatesAdminProvider = FutureProvider.autoDispose<List<ManagedTaxRate>>(
  (ref) => ref.watch(settingsApiProvider).taxRates(),
);

final teamProvider = FutureProvider.autoDispose<List<TeamMember>>(
  (ref) => ref.watch(settingsApiProvider).members(),
);

final deviceSessionsProvider = FutureProvider.autoDispose<List<DeviceSession>>(
  (ref) => ref.watch(settingsApiProvider).sessions(),
);
