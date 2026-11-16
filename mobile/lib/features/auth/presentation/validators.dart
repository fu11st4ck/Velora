/// Client-side checks that mirror the server's rules so most mistakes are caught before a request.
abstract final class Validators {
  static final _email = RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$');

  static String? email(String? value) {
    final v = value?.trim() ?? '';
    if (v.isEmpty) return 'Enter your email address.';
    if (!_email.hasMatch(v)) return 'Enter a valid email address.';
    return null;
  }

  static String? requiredPassword(String? value) =>
      (value == null || value.isEmpty) ? 'Enter your password.' : null;

  /// Matches the server's minimum; the server additionally rejects common passwords.
  static String? newPassword(String? value) {
    final v = value ?? '';
    if (v.length < 10) return 'Use at least 10 characters.';
    if (v.length > 200) return 'Use at most 200 characters.';
    return null;
  }
}
