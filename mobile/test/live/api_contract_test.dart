@Tags(['live'])
library;

import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:velora/core/api/auth_interceptor.dart';
import 'package:velora/core/api/failure.dart';
import 'package:velora/core/auth/session.dart';
import 'package:velora/core/auth/token_store.dart';
import 'package:velora/features/auth/data/auth_api.dart';

/// Runs the app's real API client against a running backend seeded with the demo data.
/// Skipped unless VELORA_LIVE_API is set, e.g.
///   VELORA_LIVE_API=http://localhost:3000/api/v1 VELORA_LIVE_PASSWORD=… flutter test test/live
void main() {
  final baseUrl = Platform.environment['VELORA_LIVE_API'];
  final password = Platform.environment['VELORA_LIVE_PASSWORD'] ?? '';
  final skip = baseUrl == null ? 'VELORA_LIVE_API not set' : null;

  late InMemoryTokenStore store;
  late AuthApi api;
  var sessionEnded = 0;

  setUp(() {
    sessionEnded = 0;
    store = InMemoryTokenStore();
    final options = BaseOptions(
      baseUrl: baseUrl ?? 'http://unused',
      contentType: Headers.jsonContentType,
    );
    final dio = Dio(options)
      ..interceptors.add(
        AuthInterceptor(
          tokenStore: store,
          refreshDio: Dio(options),
          retryDio: Dio(options),
          onSessionEnded: () => sessionEnded++,
        ),
      );
    api = AuthApi(dio);
  });

  test('sign in as sales, load profile, sign out', () async {
    final tokens = await api.login(
      email: 'ahmed@velora.example',
      password: password,
      deviceName: 'contract-test',
    );
    await store.write(tokens);
    final me = await api.me();
    expect(me.role, Role.sales);
    expect(me.organizationName, 'Velora Fine Jewellery LLC');
    expect(me.settings.currencyCode, 'AED');
    expect(
      me.settings.maxMarkupBp,
      isNull,
      reason: 'pricing policy is not sent to the sales role',
    );
    expect(me.settings.defaultTaxRate?.rateBp, 500);
    expect(me.can('product.read_cost'), isFalse);

    await api.logout(tokens.refreshToken);
    await expectLater(
      Dio(BaseOptions(baseUrl: baseUrl!)).post<dynamic>(
        '/auth/refresh',
        data: {'refreshToken': tokens.refreshToken},
      ),
      throwsA(
        isA<DioException>().having(
          (e) => Failure.from(e),
          'failure',
          isA<UnauthorizedFailure>().having(
            (f) => f.code,
            'code',
            'SESSION_REVOKED',
          ),
        ),
      ),
    );
  }, skip: skip);

  test('manager profile includes the markup ceiling', () async {
    await store.write(
      await api.login(email: 'manager@velora.example', password: password),
    );
    final me = await api.me();
    expect(me.role, Role.manager);
    expect(me.settings.maxMarkupBp, 6000);
    expect(me.can('product.manage'), isTrue);
  }, skip: skip);

  test('a wrong password maps to INVALID_CREDENTIALS', () async {
    await expectLater(
      api.login(email: 'ahmed@velora.example', password: 'definitely-wrong'),
      throwsA(
        isA<UnauthorizedFailure>().having(
          (f) => f.code,
          'code',
          'INVALID_CREDENTIALS',
        ),
      ),
    );
  }, skip: skip);

  test(
    'an unusable access token ends the session instead of looping',
    () async {
      final tokens = await api.login(
        email: 'manager@velora.example',
        password: password,
      );
      // An unusable access token with a valid refresh token: the server answers TOKEN_INVALID,
      // which must end the session rather than loop.
      await store.write(
        StoredTokens(
          accessToken: 'not.a.token',
          refreshToken: tokens.refreshToken,
        ),
      );
      await expectLater(api.me(), throwsA(isA<UnauthorizedFailure>()));
      expect(store.tokens, isNull);
      expect(sessionEnded, 1);
    },
    skip: skip,
  );
}
