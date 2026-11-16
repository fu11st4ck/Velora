import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api_client.dart';
import '../../../core/api/auth_interceptor.dart';
import '../../../core/api/failure.dart';
import '../../../core/auth/session.dart';
import '../../../core/auth/token_store.dart';

final authApiProvider = Provider<AuthApi>(
  (ref) => AuthApi(ref.watch(dioProvider)),
);

/// Remote data source for `/auth/*` (docs/api-specification.md §3.1). Throws [Failure].
class AuthApi {
  AuthApi(this._dio);
  final Dio _dio;

  static final _public = Options(extra: {skipAuth: true});

  Future<StoredTokens> login({
    required String email,
    required String password,
    String? deviceName,
  }) => _guard(() async {
    final res = await _dio.post<Map<String, dynamic>>(
      '/auth/login',
      data: {'email': email, 'password': password, 'deviceName': ?deviceName},
      options: _public,
    );
    final data = res.data!['data'] as Map<String, dynamic>;
    return StoredTokens(
      accessToken: data['accessToken'] as String,
      refreshToken: data['refreshToken'] as String,
    );
  });

  Future<Me> me() => _guard(() async {
    final res = await _dio.get<Map<String, dynamic>>('/auth/me');
    return Me.fromJson(res.data!['data'] as Map<String, dynamic>);
  });

  Future<void> logout(String refreshToken) => _guard(
    () => _dio.post<void>('/auth/logout', data: {'refreshToken': refreshToken}),
  );

  Future<void> forgotPassword(String email) => _guard(
    () => _dio.post<void>(
      '/auth/forgot-password',
      data: {'email': email},
      options: _public,
    ),
  );

  Future<void> resetPassword({
    required String token,
    required String newPassword,
  }) => _guard(
    () => _dio.post<void>(
      '/auth/reset-password',
      data: {'token': token, 'newPassword': newPassword},
      options: _public,
    ),
  );

  Future<T> _guard<T>(Future<T> Function() call) async {
    try {
      return await call();
    } on DioException catch (e) {
      throw Failure.from(e);
    }
  }
}
