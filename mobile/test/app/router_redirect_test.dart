import 'package:flutter_test/flutter_test.dart';
import 'package:velora/app/router/app_router.dart';
import 'package:velora/app/router/routes.dart';
import 'package:velora/core/api/failure.dart';
import 'package:velora/core/auth/session.dart';

import '../support/fakes.dart';

void main() {
  final signedIn = SignedIn(me());

  test('signed-out users can reach only the public screens', () {
    expect(redirectFor(const SignedOut(), Routes.login), isNull);
    expect(redirectFor(const SignedOut(), Routes.forgotPassword), isNull);
    expect(redirectFor(const SignedOut(), '/reset-password?token=abc'), isNull);
    for (final path in [
      Routes.home,
      Routes.inventory,
      Routes.sell,
      Routes.documents,
      Routes.more,
      Routes.startup,
      '/inventory/123',
    ]) {
      expect(redirectFor(const SignedOut(), path), Routes.login, reason: path);
    }
  });

  test('signed-in users are moved off the signed-out screens and otherwise left alone', () {
    for (final path in [
      Routes.login,
      Routes.forgotPassword,
      Routes.startup,
      '/',
    ]) {
      expect(redirectFor(signedIn, path), Routes.home, reason: path);
    }
    for (final path in [
      Routes.home,
      Routes.inventory,
      Routes.sell,
      Routes.documents,
      Routes.more,
    ]) {
      expect(redirectFor(signedIn, path), isNull, reason: path);
    }
  });

  test('everything waits on the start-up screen while the session is being restored', () {
    expect(redirectFor(const SessionLoading(), Routes.home), Routes.startup);
    expect(redirectFor(const SessionLoading(), Routes.login), Routes.startup);
    expect(redirectFor(const SessionLoading(), Routes.startup), isNull);
    expect(
      redirectFor(const SessionUnavailable(NetworkFailure()), Routes.documents),
      Routes.startup,
    );
  });

  test(
    'a password-reset link opens even before the session check finishes',
    () {
      expect(
        redirectFor(const SessionLoading(), '/reset-password?token=abc'),
        isNull,
      );
    },
  );
}
