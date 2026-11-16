import 'package:dio/dio.dart';

/// Everything that can go wrong talking to the API, as a closed set the UI can switch on
/// (docs/api-error-handling.md §5).
sealed class Failure implements Exception {
  const Failure();

  /// Maps any thrown object to a [Failure]. The server's `error.code` drives the mapping — never its message.
  factory Failure.from(Object error) {
    if (error is Failure) return error;
    if (error is! DioException) return const UnexpectedFailure();
    if (error.error is Failure) return error.error! as Failure;

    switch (error.type) {
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.sendTimeout:
      case DioExceptionType.receiveTimeout:
      case DioExceptionType.transformTimeout:
        return const TimeoutFailure();
      case DioExceptionType.connectionError:
        return const NetworkFailure();
      case DioExceptionType.badResponse:
        break;
      case DioExceptionType.cancel:
      case DioExceptionType.badCertificate:
      case DioExceptionType.unknown:
        return error.response == null
            ? const NetworkFailure()
            : const UnexpectedFailure();
    }

    final status = error.response?.statusCode ?? 0;
    final body = error.response?.data;
    final envelope =
        body is Map<String, dynamic> && body['error'] is Map<String, dynamic>
        ? body['error'] as Map<String, dynamic>
        : const <String, dynamic>{};
    final code = envelope['code'] as String? ?? '';
    final message = envelope['message'] as String?;
    final requestId = envelope['requestId'] as String?;
    final details = (envelope['details'] as List<dynamic>? ?? const [])
        .whereType<Map<String, dynamic>>()
        .toList(growable: false);

    if (status == 401) return UnauthorizedFailure(code);
    if (status == 403) return ForbiddenFailure(code);
    if (status == 404) return const NotFoundFailure();
    if (status == 429) {
      final header = int.tryParse(
        error.response?.headers.value('retry-after') ?? '',
      );
      return RateLimitedFailure(Duration(seconds: header ?? 60));
    }
    if (status == 400) {
      return ValidationFailure({
        for (final d in details)
          if (d['field'] is String)
            d['field'] as String: (d['rule'] as String?) ?? 'invalid',
      });
    }
    if (status == 409 || status == 422) {
      return BusinessFailure(
        code: code,
        serverMessage: message,
        details: details,
      );
    }
    if (status >= 500) return ServerFailure(requestId);
    return const UnexpectedFailure();
  }
}

class NetworkFailure extends Failure {
  const NetworkFailure();
}

class TimeoutFailure extends Failure {
  const TimeoutFailure();
}

/// 401. [code] is TOKEN_EXPIRED, TOKEN_INVALID, SESSION_REVOKED or INVALID_CREDENTIALS.
class UnauthorizedFailure extends Failure {
  const UnauthorizedFailure(this.code);
  final String code;
}

class ForbiddenFailure extends Failure {
  const ForbiddenFailure(this.code);
  final String code;
}

class NotFoundFailure extends Failure {
  const NotFoundFailure();
}

class RateLimitedFailure extends Failure {
  const RateLimitedFailure(this.retryAfter);
  final Duration retryAfter;
}

/// 400: field name → rule that failed.
class ValidationFailure extends Failure {
  const ValidationFailure(this.fields);
  final Map<String, String> fields;
}

/// 409 / 422: a business rule or state conflict, identified by [code].
class BusinessFailure extends Failure {
  const BusinessFailure({
    required this.code,
    this.serverMessage,
    this.details = const [],
  });
  final String code;
  final String? serverMessage;
  final List<Map<String, dynamic>> details;
}

class ServerFailure extends Failure {
  const ServerFailure(this.requestId);
  final String? requestId;
}

class UnexpectedFailure extends Failure {
  const UnexpectedFailure();
}
