import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Whether the server could be reached on the latest attempt. There is no separate network
/// probe: the app's own requests are the evidence, so "offline" means "the last request did not
/// get through", whatever the reason.
final offlineProvider = NotifierProvider<ConnectionStatus, bool>(
  ConnectionStatus.new,
);

class ConnectionStatus extends Notifier<bool> {
  @override
  bool build() => false;

  void report({required bool reached}) {
    if (state == reached) state = !reached;
  }
}

/// Feeds [offlineProvider] from every request the API client makes.
class ConnectionInterceptor extends Interceptor {
  ConnectionInterceptor(this._report);
  final void Function({required bool reached}) _report;

  @override
  void onResponse(
    Response<dynamic> response,
    ResponseInterceptorHandler handler,
  ) {
    _report(reached: true);
    handler.next(response);
  }

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) {
    // Any answer from the server — even an error — proves the connection works.
    _report(reached: err.response != null);
    handler.next(err);
  }
}
