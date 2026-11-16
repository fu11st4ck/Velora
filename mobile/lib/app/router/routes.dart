/// Route paths (docs/mobile-screen-specifications.md).
abstract final class Routes {
  static const startup = '/startup';
  static const login = '/login';
  static const forgotPassword = '/forgot-password';
  static const resetPassword = '/reset-password';
  static const home = '/home';
  static const inventory = '/inventory';
  static const sell = '/sell';
  static const documents = '/documents';
  static const more = '/more';

  /// Reachable without a session.
  static const public = {login, forgotPassword, resetPassword};
}
