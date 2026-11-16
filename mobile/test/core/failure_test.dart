import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:velora/core/api/failure.dart';
import 'package:velora/core/api/failure_messages.dart';

DioException response(
  int status,
  Object? body, {
  Map<String, List<String>>? headers,
}) {
  final request = RequestOptions(path: '/x');
  return DioException.badResponse(
    statusCode: status,
    requestOptions: request,
    response: Response<Object?>(
      requestOptions: request,
      statusCode: status,
      data: body,
      headers: Headers.fromMap(headers ?? {}),
    ),
  );
}

Map<String, dynamic> envelope(
  String code, {
  List<Map<String, dynamic>>? details,
}) => {
  'error': {
    'code': code,
    'message': 'server text',
    'details': ?details,
    'requestId': 'req_9',
  },
};

void main() {
  final request = RequestOptions(path: '/x');

  test('maps transport problems', () {
    expect(
      Failure.from(
        DioException.connectionError(requestOptions: request, reason: 'x'),
      ),
      isA<NetworkFailure>(),
    );
    expect(
      Failure.from(
        DioException.connectionTimeout(
          requestOptions: request,
          timeout: Duration.zero,
        ),
      ),
      isA<TimeoutFailure>(),
    );
    expect(
      Failure.from(
        DioException.receiveTimeout(
          requestOptions: request,
          timeout: Duration.zero,
        ),
      ),
      isA<TimeoutFailure>(),
    );
    expect(Failure.from(StateError('bug')), isA<UnexpectedFailure>());
  });

  test('maps each status using the error code', () {
    expect(
      Failure.from(response(401, envelope('TOKEN_EXPIRED'))),
      isA<UnauthorizedFailure>().having((f) => f.code, 'code', 'TOKEN_EXPIRED'),
    );
    expect(
      Failure.from(response(403, envelope('ACCOUNT_DISABLED'))),
      isA<ForbiddenFailure>().having((f) => f.code, 'code', 'ACCOUNT_DISABLED'),
    );
    expect(
      Failure.from(response(404, envelope('NOT_FOUND'))),
      isA<NotFoundFailure>(),
    );
    expect(
      Failure.from(response(500, envelope('INTERNAL_ERROR'))),
      isA<ServerFailure>().having((f) => f.requestId, 'requestId', 'req_9'),
    );
  });

  test('maps validation details to fields', () {
    final failure = Failure.from(
      response(
        400,
        envelope(
          'VALIDATION_ERROR',
          details: [
            {'field': 'email', 'rule': 'isEmail'},
            {'field': 'x', 'rule': 'whitelistValidation'},
          ],
        ),
      ),
    );
    expect(
      failure,
      isA<ValidationFailure>().having((f) => f.fields, 'fields', {
        'email': 'isEmail',
        'x': 'whitelistValidation',
      }),
    );
  });

  test('keeps the code and numbers of a business failure', () {
    final failure = Failure.from(
      response(
        409,
        envelope(
          'INSUFFICIENT_STOCK',
          details: [
            {'lineNo': 2, 'requested': 5, 'available': 2},
          ],
        ),
      ),
    );
    expect(failure, isA<BusinessFailure>());
    failure as BusinessFailure;
    expect(failure.code, 'INSUFFICIENT_STOCK');
    expect(failure.details.single['available'], 2);
  });

  test('reads Retry-After for rate limits and defaults to a minute', () {
    final limited = Failure.from(
      response(
        429,
        envelope('TOO_MANY_ATTEMPTS'),
        headers: {
          'retry-after': ['840'],
        },
      ),
    );
    expect(
      limited,
      isA<RateLimitedFailure>().having(
        (f) => f.retryAfter,
        'retryAfter',
        const Duration(seconds: 840),
      ),
    );
    expect(
      (Failure.from(
        response(429, envelope('RATE_LIMITED')),
      ) as RateLimitedFailure).retryAfter,
      const Duration(seconds: 60),
    );
  });

  test('survives a response that is not the error envelope', () {
    expect(
      Failure.from(response(502, '<html>Bad gateway</html>')),
      isA<ServerFailure>(),
    );
    expect(Failure.from(response(401, null)), isA<UnauthorizedFailure>());
  });

  group('messages', () {
    test('are chosen by code, not by server text', () {
      expect(
        describeFailure(const UnauthorizedFailure('INVALID_CREDENTIALS')),
        'Email or password is incorrect.',
      );
      expect(
        describeFailure(const UnauthorizedFailure('SESSION_REVOKED')),
        contains('sign in again'),
      );
      expect(
        describeFailure(const ForbiddenFailure('ACCOUNT_DISABLED')),
        contains('disabled'),
      );
      expect(
        describeFailure(const NetworkFailure()),
        contains('No connection'),
      );
      expect(
        describeFailure(const RateLimitedFailure(Duration(seconds: 840))),
        'Too many attempts. Try again in 14 minutes.',
      );
      expect(
        describeFailure(const RateLimitedFailure(Duration(seconds: 30))),
        'Too many attempts. Try again in 30 seconds.',
      );
      expect(describeFailure(const ServerFailure('req_9')), contains('req_9'));
    });

    test('explain which password rule failed', () {
      const weak = BusinessFailure(
        code: 'WEAK_PASSWORD',
        details: [
          {'field': 'newPassword', 'rule': 'too_common'},
        ],
      );
      expect(describeFailure(weak), contains('too common'));
    });

    test(
      'fall back to the server message for a code the app does not know yet',
      () {
        expect(
          describeFailure(
            const BusinessFailure(
              code: 'SOME_NEW_RULE',
              serverMessage: 'Explained by server.',
            ),
          ),
          'Explained by server.',
        );
      },
    );
  });
}
