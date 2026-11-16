import 'dart:async';

import 'package:dio/dio.dart';

import '../auth/token_store.dart';
import 'failure.dart';

const _retried = 'velora.retried';

/// Marks a request that must not carry or refresh credentials (sign-in, refresh, password reset).
const skipAuth = 'velora.skipAuth';

/// Attaches the access token, and when it has expired refreshes it once and replays the request.
///
/// Refresh tokens are single-use: presenting one twice ends the whole session on the server.
/// All requests that fail at the same moment therefore share ONE refresh call.
class AuthInterceptor extends QueuedInterceptor {
  AuthInterceptor({
    required this.tokenStore,
    required this.refreshDio,
    required this.retryDio,
    required this.onSessionEnded,
  });

  final TokenStore tokenStore;

  /// A client without this interceptor, used only for the refresh call.
  final Dio refreshDio;

  /// A client without this interceptor, used to replay the original request.
  final Dio retryDio;

  /// Called after tokens were cleared because the session can no longer be renewed.
  final void Function() onSessionEnded;

  Future<StoredTokens?>? _refreshing;

  @override
  Future<void> onRequest(
    RequestOptions options,
    RequestInterceptorHandler handler,
  ) async {
    if (options.extra[skipAuth] != true) {
      final tokens = await tokenStore.read();
      if (tokens != null) {
        options.headers['Authorization'] = 'Bearer ${tokens.accessToken}';
      }
    }
    handler.next(options);
  }

  @override
  Future<void> onError(
    DioException err,
    ErrorInterceptorHandler handler,
  ) async {
    final request = err.requestOptions;
    final failure = Failure.from(err);
    final expired =
        failure is UnauthorizedFailure && failure.code == 'TOKEN_EXPIRED';
    if (!expired ||
        request.extra[skipAuth] == true ||
        request.extra[_retried] == true) {
      if (failure is UnauthorizedFailure &&
          failure.code != 'INVALID_CREDENTIALS' &&
          request.extra[skipAuth] != true) {
        await _endSession();
      }
      return handler.next(err);
    }

    final sentWith = (request.headers['Authorization'] as String?)
        ?.replaceFirst('Bearer ', '');
    StoredTokens? tokens = await tokenStore.read();
    // Another request may already have refreshed while this one was in flight.
    if (tokens == null || tokens.accessToken == sentWith) {
      tokens = await (_refreshing ??= _refresh(tokens)
          .whenComplete(() => _refreshing = null));
    }
    if (tokens == null) return handler.next(err);

    try {
      final replay = await retryDio.fetch<dynamic>(
        request.copyWith(
          headers: {
            ...request.headers,
            'Authorization': 'Bearer ${tokens.accessToken}',
          },
          extra: {...request.extra, _retried: true},
        ),
      );
      handler.resolve(replay);
    } on DioException catch (e) {
      handler.next(e);
    }
  }

  /// Returns the new tokens, or null when the session ended or the network is unavailable.
  Future<StoredTokens?> _refresh(StoredTokens? current) async {
    if (current == null) {
      await _endSession();
      return null;
    }
    try {
      final res = await refreshDio.post<Map<String, dynamic>>(
        '/auth/refresh',
        data: {'refreshToken': current.refreshToken},
      );
      final data = res.data!['data'] as Map<String, dynamic>;
      final next = StoredTokens(
        accessToken: data['accessToken'] as String,
        refreshToken: data['refreshToken'] as String,
      );
      await tokenStore.write(next);
      return next;
    } on DioException catch (e) {
      // Only a definite rejection ends the session. Being offline must never sign the user out.
      if (Failure.from(e) is UnauthorizedFailure) await _endSession();
      return null;
    }
  }

  Future<void> _endSession() async {
    if (await tokenStore.read() == null) return;
    await tokenStore.clear();
    onSessionEnded();
  }
}
