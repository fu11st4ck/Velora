import 'failure.dart';

/// User-facing text for a failure. Keyed by error code so wording never depends on the server's message.
String describeFailure(Failure failure) => switch (failure) {
  NetworkFailure() => 'No connection. Check your internet and try again.',
  TimeoutFailure() => 'The server took too long to respond. Try again.',
  UnauthorizedFailure(code: 'INVALID_CREDENTIALS') =>
    'Email or password is incorrect.',
  UnauthorizedFailure() => 'Your session has ended. Please sign in again.',
  ForbiddenFailure(code: 'ACCOUNT_DISABLED') =>
    'This account is disabled. Ask the business owner for access.',
  ForbiddenFailure() => "You don't have access to this.",
  NotFoundFailure() => 'This item no longer exists.',
  RateLimitedFailure(:final retryAfter) =>
    'Too many attempts. Try again in ${_wait(retryAfter)}.',
  ValidationFailure() =>
    'Some details are not valid. Check the form and try again.',
  BusinessFailure(:final code, :final details, :final serverMessage) =>
    _business[code] ??
        _weakPassword(code, details) ??
        serverMessage ??
        'This action could not be completed.',
  ServerFailure(:final requestId) =>
    requestId == null
        ? 'Something went wrong on our side. Try again.'
        : 'Something went wrong on our side. Try again. (Ref $requestId)',
  UnexpectedFailure() => 'Something went wrong. Try again.',
};

const _business = <String, String>{
  'RESET_TOKEN_INVALID':
      'This reset link is invalid or has expired. Request a new one.',
  'CURRENT_PASSWORD_INCORRECT': 'The current password is incorrect.',
};

const _passwordRules = <String, String>{
  'min_length_10': 'Use at least 10 characters.',
  'max_length_200': 'Use at most 200 characters.',
  'too_common':
      'That password is too common. Choose something less predictable.',
  'too_repetitive': 'Use a wider mix of characters.',
  'contains_email': 'Do not include your email name in the password.',
};

String? _weakPassword(String code, List<Map<String, dynamic>> details) {
  if (code != 'WEAK_PASSWORD') return null;
  final rule = details.isEmpty ? null : details.first['rule'] as String?;
  return _passwordRules[rule] ?? 'Choose a stronger password.';
}

String _wait(Duration d) {
  if (d.inSeconds < 60) return '${d.inSeconds} seconds';
  final minutes = (d.inSeconds / 60).ceil();
  return minutes == 1 ? '1 minute' : '$minutes minutes';
}
