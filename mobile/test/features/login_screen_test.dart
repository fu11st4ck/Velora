import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:velora/core/api/failure.dart';
import 'package:velora/core/auth/session.dart';
import 'package:velora/core/auth/session_controller.dart';
import 'package:velora/features/auth/presentation/login_screen.dart';

import '../support/harness.dart';

/// Records sign-in calls and answers with a scripted result.
class FakeSession extends SessionController {
  FakeSession({this.initial = const SignedOut(), this.result});
  final SessionState initial;
  Failure? result;
  final calls = <(String, String)>[];

  @override
  SessionState build() => initial;

  @override
  Future<void> signIn({required String email, required String password}) async {
    calls.add((email, password));
    await Future<void>.delayed(const Duration(milliseconds: 50));
    if (result != null) throw result!;
  }
}

void main() {
  Future<FakeSession> pump(
    WidgetTester tester, {
    FakeSession? session,
    bool dark = false,
  }) async {
    final fake = session ?? FakeSession();
    await pumpScreen(
      tester,
      const LoginScreen(),
      dark: dark,
      overrides: [sessionControllerProvider.overrideWith(() => fake)],
    );
    return fake;
  }

  final email = find.byKey(const Key('login-email'));
  final password = find.byKey(const Key('login-password'));
  final submit = find.byKey(const Key('login-submit'));
  Finder input(Finder field) =>
      find.descendant(of: field, matching: find.byType(TextFormField));

  testWidgets('validates before sending anything', (tester) async {
    final session = await pump(tester);
    await tester.tap(submit);
    await tester.pump();
    expect(find.text('Enter your email address.'), findsOneWidget);
    expect(find.text('Enter your password.'), findsOneWidget);

    await tester.enterText(input(email), 'not-an-email');
    await tester.tap(submit);
    await tester.pump();
    expect(find.text('Enter a valid email address.'), findsOneWidget);
    expect(session.calls, isEmpty);
  });

  testWidgets('submits the entered credentials and shows progress', (
    tester,
  ) async {
    final session = await pump(tester);
    await tester.enterText(input(email), 'maya@velora.example');
    await tester.enterText(input(password), 'correct-horse-battery');
    await tester.tap(submit);
    await tester.pump();
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    expect(
      tester.widget<FilledButton>(find.byType(FilledButton)).onPressed,
      isNull,
      reason: 'cannot be submitted twice',
    );
    await tester.pumpAndSettle();
    expect(session.calls, [('maya@velora.example', 'correct-horse-battery')]);
    expect(find.byType(CircularProgressIndicator), findsNothing);
  });

  testWidgets('a second tap while signing in does not send a second request', (
    tester,
  ) async {
    final session = await pump(tester);
    await tester.enterText(input(email), 'maya@velora.example');
    await tester.enterText(input(password), 'pw');
    await tester.tap(submit);
    await tester.pump();
    await tester.tap(submit, warnIfMissed: false);
    await tester.pumpAndSettle();
    expect(session.calls, hasLength(1));
  });

  for (final (failure, text) in <(Failure, String)>[
    (
      const UnauthorizedFailure('INVALID_CREDENTIALS'),
      'Email or password is incorrect.',
    ),
    (
      const RateLimitedFailure(Duration(minutes: 15)),
      'Too many attempts. Try again in 15 minutes.',
    ),
    (
      const ForbiddenFailure('ACCOUNT_DISABLED'),
      'This account is disabled. Ask the business owner for access.',
    ),
    (
      const NetworkFailure(),
      'No connection. Check your internet and try again.',
    ),
  ]) {
    testWidgets('shows "$text" and lets the user try again', (tester) async {
      final session = await pump(tester, session: FakeSession(result: failure));
      await tester.enterText(input(email), 'maya@velora.example');
      await tester.enterText(input(password), 'wrong');
      await tester.tap(submit);
      await tester.pumpAndSettle();
      expect(find.text(text), findsOneWidget);
      expect(
        tester.widget<TextFormField>(input(password)).controller!.text,
        'wrong',
        reason: 'input is kept',
      );

      session.result = null;
      await tester.tap(submit);
      await tester.pumpAndSettle();
      expect(find.text(text), findsNothing);
    });
  }

  testWidgets('explains when the previous session ended', (tester) async {
    await pump(
      tester,
      session: FakeSession(initial: const SignedOut(expired: true)),
    );
    expect(
      find.text('Your session has ended. Please sign in again.'),
      findsOneWidget,
    );
  });

  testWidgets('password can be revealed', (tester) async {
    await pump(tester);
    expect(
      tester
          .widget<TextField>(
            find.descendant(of: password, matching: find.byType(TextField)),
          )
          .obscureText,
      isTrue,
    );
    await tester.tap(find.byTooltip('Show password'));
    await tester.pump();
    expect(
      tester
          .widget<TextField>(
            find.descendant(of: password, matching: find.byType(TextField)),
          )
          .obscureText,
      isFalse,
    );
    expect(find.byTooltip('Hide password'), findsOneWidget);
  });

  for (final dark in [false, true]) {
    testWidgets(
      'meets tap-target, label and contrast guidelines (${dark ? 'dark' : 'light'})',
      (tester) async {
        final handle = tester.ensureSemantics();
        await pump(tester, dark: dark);
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(iOSTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
        handle.dispose();
      },
    );
  }

  testWidgets('fits a small phone at 200% text size without overflow', (
    tester,
  ) async {
    setScreenSize(tester, const Size(360, 640));
    tester.platformDispatcher.textScaleFactorTestValue = 2;
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    await pump(tester, session: FakeSession(result: const NetworkFailure()));
    await tester.tap(submit, warnIfMissed: false);
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });
}
