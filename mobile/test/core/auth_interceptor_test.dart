import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:velora/core/api/auth_interceptor.dart';
import 'package:velora/core/api/failure.dart';
import 'package:velora/core/auth/token_store.dart';

import '../support/fakes.dart';

void main() {
  late InMemoryTokenStore store;
  late FakeAdapter adapter;
  late Dio dio;
  late int sessionEnded;

  /// Server model: `validAccess` is the only access token accepted; refresh tokens are single-use.
  late String validAccess;
  late String validRefresh;
  late int generation;

  Future<ResponseBody> server(
    RequestOptions request,
    Map<String, dynamic>? body,
  ) async {
    if (request.path == '/auth/refresh') {
      await Future<void>.delayed(const Duration(milliseconds: 20));
      if (body?['refreshToken'] != validRefresh) {
        return apiError(401, 'SESSION_REVOKED');
      }
      generation++;
      validAccess = 'access-$generation';
      validRefresh = 'refresh-$generation';
      return ok({'accessToken': validAccess, 'refreshToken': validRefresh});
    }
    final auth = request.headers['Authorization'];
    if (auth == null) return apiError(401, 'TOKEN_INVALID');
    if (auth != 'Bearer $validAccess') return apiError(401, 'TOKEN_EXPIRED');
    return ok({'path': request.path});
  }

  setUp(() {
    generation = 1;
    validAccess = 'access-1';
    validRefresh = 'refresh-1';
    sessionEnded = 0;
    store = InMemoryTokenStore(
      const StoredTokens(accessToken: 'access-1', refreshToken: 'refresh-1'),
    );
    adapter = FakeAdapter(server);
    final options = BaseOptions(baseUrl: 'http://api.test');
    Dio plain() => Dio(options)..httpClientAdapter = adapter;
    dio = plain()
      ..interceptors.add(
        AuthInterceptor(
          tokenStore: store,
          refreshDio: plain(),
          retryDio: plain(),
          onSessionEnded: () => sessionEnded++,
        ),
      );
  });

  test('sends the access token', () async {
    await dio.get<dynamic>('/products');
    expect(adapter.requests.single.headers['Authorization'], 'Bearer access-1');
  });

  test('does not attach credentials to public requests', () async {
    adapter.handler = (r, _) => ok({});
    await dio.post<dynamic>(
      '/auth/login',
      data: {'email': 'a@b.c'},
      options: Options(extra: {skipAuth: true}),
    );
    expect(
      adapter.requests.single.headers.containsKey('Authorization'),
      isFalse,
    );
  });

  test('refreshes an expired token once and replays the request', () async {
    validAccess = 'rotated-elsewhere'; // the stored access token is now expired
    final res = await dio.get<Map<String, dynamic>>('/products');
    expect((res.data!['data'] as Map<String, dynamic>)['path'], '/products');
    expect(adapter.count('/auth/refresh'), 1);
    expect(store.tokens!.accessToken, 'access-2');
    expect(store.tokens!.refreshToken, 'refresh-2');
    expect(sessionEnded, 0);
  });

  test('five requests failing together share a single refresh', () async {
    validAccess = 'rotated-elsewhere';
    final results = await Future.wait([
      for (var i = 0; i < 5; i++) dio.get<Map<String, dynamic>>('/r$i'),
    ]);
    expect(results.map((r) => r.statusCode), everyElement(200));
    // A second refresh would present an already-used token and end the session on the server.
    expect(adapter.count('/auth/refresh'), 1);
    expect(sessionEnded, 0);
  });

  test('ends the session when the refresh token is rejected', () async {
    validAccess = 'rotated-elsewhere';
    validRefresh = 'revoked';
    await expectLater(
      dio.get<dynamic>('/products'),
      throwsA(
        isA<DioException>().having(
          (e) => Failure.from(e),
          'failure',
          isA<UnauthorizedFailure>(),
        ),
      ),
    );
    expect(store.tokens, isNull);
    expect(sessionEnded, 1);
  });

  test('ends the session when the server says it was revoked', () async {
    adapter.handler = (r, _) => apiError(401, 'SESSION_REVOKED');
    await expectLater(
      dio.get<dynamic>('/products'),
      throwsA(isA<DioException>()),
    );
    expect(store.tokens, isNull);
    expect(sessionEnded, 1);
    expect(adapter.count('/auth/refresh'), 0);
  });

  test('keeps the user signed in when the refresh fails only because the device is offline', () async {
    adapter.handler = (r, b) =>
        r.path == '/auth/refresh' ? offline(r) : apiError(401, 'TOKEN_EXPIRED');
    await expectLater(
      dio.get<dynamic>('/products'),
      throwsA(isA<DioException>()),
    );
    expect(store.tokens!.refreshToken, 'refresh-1');
    expect(sessionEnded, 0);
  });

  test('does not loop when the replayed request is rejected again', () async {
    adapter.handler = (r, b) => r.path == '/auth/refresh'
        ? ok({'accessToken': 'access-2', 'refreshToken': 'refresh-2'})
        : apiError(401, 'TOKEN_EXPIRED');
    await expectLater(
      dio.get<dynamic>('/products'),
      throwsA(isA<DioException>()),
    );
    expect(adapter.count('/auth/refresh'), 1);
    expect(adapter.count('/products'), 2);
  });

  test(
    'a wrong password on sign-in is not treated as an ended session',
    () async {
      adapter.handler = (r, _) => apiError(401, 'INVALID_CREDENTIALS');
      await expectLater(
        dio.post<dynamic>(
          '/auth/login',
          data: {'email': 'a@b.c'},
          options: Options(extra: {skipAuth: true}),
        ),
        throwsA(isA<DioException>()),
      );
      expect(store.tokens, isNotNull);
      expect(sessionEnded, 0);
    },
  );
}
