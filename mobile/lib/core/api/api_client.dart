import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/config/app_config.dart';
import '../auth/token_store.dart';
import 'auth_interceptor.dart';

final appConfigProvider = Provider<AppConfig>(
  (ref) => throw UnimplementedError('Overridden in main'),
);

final tokenStoreProvider = Provider<TokenStore>((ref) => SecureTokenStore());

/// Invoked when the server has ended the session. Wired to the session controller in `app.dart`.
final sessionEndedCallbackProvider = Provider<void Function()>((ref) => () {});

// No default content type: Dio sets JSON only on requests that actually carry a body.
BaseOptions _options(AppConfig config) => BaseOptions(
  baseUrl: config.apiBaseUrl,
  connectTimeout: const Duration(seconds: 10),
  sendTimeout: const Duration(seconds: 20),
  receiveTimeout: const Duration(seconds: 20),
  headers: {'Accept': 'application/json'},
);

/// Transport override. Null in the app (Dio's platform default); tests supply a fake.
final httpClientAdapterProvider = Provider<HttpClientAdapter?>((ref) => null);

/// The single HTTP client for the API. Features use it through their own data-source classes;
/// widgets never touch it.
final dioProvider = Provider<Dio>((ref) {
  final config = ref.watch(appConfigProvider);
  final adapter = ref.watch(httpClientAdapterProvider);
  Dio client() {
    final dio = Dio(_options(config));
    if (adapter != null) dio.httpClientAdapter = adapter;
    return dio;
  }

  final dio = client();
  dio.interceptors.add(
    AuthInterceptor(
      tokenStore: ref.watch(tokenStoreProvider),
      refreshDio: client(),
      retryDio: client(),
      onSessionEnded: () => ref.read(sessionEndedCallbackProvider)(),
    ),
  );
  ref.onDispose(dio.close);
  return dio;
});
