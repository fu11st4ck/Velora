import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';
import 'package:velora/core/auth/token_store.dart';

import '../support/fakes.dart';
import '../support/harness.dart';

/// End-to-end widget tests of the real app wiring: router, session controller, API client and
/// token refresh, with only the network transport replaced.
void main() {
  Finder input(String key) => find.descendant(
    of: find.byKey(Key(key)),
    matching: find.byType(TextFormField),
  );

  Handler server({
    String role = 'MANAGER',
    String password = 'correct-horse-battery',
  }) => (request, body) {
    switch (request.path) {
      case '/auth/login':
        return body?['password'] == password
            ? ok({'accessToken': 'access-1', 'refreshToken': 'refresh-1'})
            : apiError(401, 'INVALID_CREDENTIALS');
      case '/auth/me':
        return request.headers['Authorization'] == 'Bearer access-1'
            ? ok(meJson(role: role))
            : apiError(401, 'TOKEN_INVALID');
      case '/auth/logout':
        return noContent();
      default:
        return apiError(404, 'NOT_FOUND');
    }
  };

  testWidgets('sign in, move between tabs, sign out', (tester) async {
    setScreenSize(tester, const Size(390, 844));
    final app = AppHarness(server: server());
    await tester.pumpWidget(app.build());
    await tester.pumpAndSettle();
    expect(find.text('Sign in to Velora'), findsOneWidget);

    await tester.enterText(input('login-email'), ' maya@velora.example ');
    await tester.enterText(input('login-password'), 'wrong-password');
    await tester.tap(find.byKey(const Key('login-submit')));
    await tester.pumpAndSettle();
    expect(find.text('Email or password is incorrect.'), findsOneWidget);
    expect(app.store.tokens, isNull);

    await tester.enterText(input('login-password'), 'correct-horse-battery');
    await tester.tap(find.byKey(const Key('login-submit')));
    await tester.pumpAndSettle();

    // Home, with the signed-in context from the server.
    expect(find.textContaining(', Maya'), findsOneWidget);
    expect(find.text('VELORA FINE JEWELLERY LLC'), findsOneWidget);
    expect(find.byKey(const Key('kpi-today')), findsOneWidget);
    expect(find.byKey(const Key('inventory-value')), findsOneWidget);
    expect(app.store.tokens!.refreshToken, 'refresh-1');
    expect(
      app.adapter.requests.firstWhere((r) => r.path == '/auth/login').data,
      containsPair('email', 'maya@velora.example'),
    );

    // All five destinations exist and respond.
    expect(find.byType(NavigationBar), findsOneWidget);
    await tester.tap(
      find.descendant(
        of: find.byType(NavigationBar),
        matching: find.text('Inventory'),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('inventory-search')), findsOneWidget);
    for (final (tab, key) in [
      ('Sell', 'sell-search'),
      ('Documents', 'document-search'),
    ]) {
      await tester.tap(
        find.descendant(
          of: find.byType(NavigationBar),
          matching: find.text(tab),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byKey(Key(key)), findsOneWidget, reason: tab);
    }

    await tester.tap(
      find.descendant(
        of: find.byType(NavigationBar),
        matching: find.text('More'),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Maya Manager'), findsOneWidget);
    expect(find.text('maya@velora.example'), findsOneWidget);

    await tester.tap(find.byKey(const Key('sign-out')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(app.store.tokens, isNotNull, reason: 'cancelling keeps the session');

    await tester.tap(find.byKey(const Key('sign-out')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('confirm-sign-out')));
    await tester.pumpAndSettle();
    expect(find.text('Sign in to Velora'), findsOneWidget);
    expect(app.store.tokens, isNull);
    expect(
      app.adapter.requests.lastWhere((r) => r.path == '/auth/logout').data,
      {'refreshToken': 'refresh-1'},
    );
  });

  testWidgets('a stored session opens straight to Home', (tester) async {
    final app = AppHarness(
      server: server(),
      tokens: const StoredTokens(
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
      ),
    );
    await tester.pumpWidget(app.build());
    await tester.pumpAndSettle();
    expect(find.textContaining(', Maya'), findsOneWidget);
    expect(app.adapter.count('/auth/login'), 0);
  });

  testWidgets('the sales role is not shown profit or stock value', (
    tester,
  ) async {
    final app = AppHarness(
      server: server(role: 'SALES'),
      dashboard: dashboardJson(role: 'SALES'),
      tokens: const StoredTokens(
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
      ),
    );
    await tester.pumpWidget(app.build());
    await tester.pumpAndSettle();
    expect(find.text('Shown to managers'), findsOneWidget);
    expect(find.byKey(const Key('inventory-value')), findsNothing);
  });

  testWidgets(
    'a revoked stored session returns to sign-in with an explanation',
    (tester) async {
      final app = AppHarness(
        server: (r, _) => apiError(401, 'SESSION_REVOKED'),
        tokens: const StoredTokens(accessToken: 'old', refreshToken: 'old'),
      );
      await tester.pumpWidget(app.build());
      await tester.pumpAndSettle();
      expect(find.text('Sign in to Velora'), findsOneWidget);
      expect(
        find.text('Your session has ended. Please sign in again.'),
        findsOneWidget,
      );
      expect(app.store.tokens, isNull);
    },
  );

  testWidgets('launching offline keeps the session and offers a retry', (
    tester,
  ) async {
    var online = false;
    final app = AppHarness(
      server: (r, b) => online ? server()(r, b) : offline(r),
      tokens: const StoredTokens(
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
      ),
    );
    await tester.pumpWidget(app.build());
    await tester.pumpAndSettle();
    expect(find.text('Could not reach Velora'), findsOneWidget);
    expect(
      app.store.tokens,
      isNotNull,
      reason: 'being offline must not sign the user out',
    );

    online = true;
    await tester.tap(find.text('Try again'));
    await tester.pumpAndSettle();
    expect(find.textContaining(', Maya'), findsOneWidget);
  });

  testWidgets('an expired access token is refreshed transparently at launch', (
    tester,
  ) async {
    const access = 'access-2';
    final app = AppHarness(
      server: (r, b) {
        if (r.path == '/auth/refresh') {
          return b?['refreshToken'] == 'refresh-1'
              ? ok({'accessToken': access, 'refreshToken': 'refresh-2'})
              : apiError(401, 'SESSION_REVOKED');
        }
        return r.headers['Authorization'] == 'Bearer $access'
            ? ok(meJson())
            : apiError(401, 'TOKEN_EXPIRED');
      },
      tokens: const StoredTokens(
        accessToken: 'expired',
        refreshToken: 'refresh-1',
      ),
    );
    await tester.pumpWidget(app.build());
    await tester.pumpAndSettle();
    expect(find.textContaining(', Maya'), findsOneWidget);
    expect(app.store.tokens!.refreshToken, 'refresh-2');
    expect(app.adapter.count('/auth/refresh'), 1);
  });

  testWidgets('tablets get a navigation rail instead of the bottom bar', (
    tester,
  ) async {
    setScreenSize(tester, const Size(1194, 834));
    final app = AppHarness(
      server: server(),
      tokens: const StoredTokens(
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
      ),
    );
    await tester.pumpWidget(app.build());
    await tester.pumpAndSettle();
    expect(find.byType(NavigationRail), findsOneWidget);
    expect(find.byType(NavigationBar), findsNothing);
  });

  testWidgets(
    'password reset: request a link, then set a new password from the link',
    (tester) async {
      final seen = <String, Map<String, dynamic>?>{};
      final app = AppHarness(
        server: (r, b) {
          seen[r.path] = b;
          if (r.path == '/auth/forgot-password') {
            return json(202, {
              'data': {'accepted': true},
            });
          }
          if (r.path == '/auth/reset-password') {
            return b?['newPassword'] == 'password123'
                ? apiError(
                    422,
                    'WEAK_PASSWORD',
                    details: [
                      {'field': 'newPassword', 'rule': 'too_common'},
                    ],
                  )
                : noContent();
          }
          return apiError(404, 'NOT_FOUND');
        },
      );
      await tester.pumpWidget(app.build());
      await tester.pumpAndSettle();
      await tester.tap(find.text('Forgot password?'));
      await tester.pumpAndSettle();
      await tester.enterText(input('forgot-email'), 'maya@velora.example');
      await tester.tap(find.byKey(const Key('forgot-submit')));
      await tester.pumpAndSettle();
      expect(find.text('Check your email'), findsOneWidget);
      expect(seen['/auth/forgot-password'], {'email': 'maya@velora.example'});

      // Opening the emailed link.
      final context = tester.element(find.text('Check your email'));
      GoRouterHelper(context).go('/reset-password?token=tok_123');
      await tester.pumpAndSettle();
      expect(find.text('Choose a new password'), findsOneWidget);

      await tester.enterText(input('reset-password'), 'short');
      await tester.enterText(input('reset-confirm'), 'different');
      await tester.tap(find.byKey(const Key('reset-submit')));
      await tester.pump();
      expect(find.text('Use at least 10 characters.'), findsOneWidget);
      expect(find.text('The passwords do not match.'), findsOneWidget);
      expect(seen.containsKey('/auth/reset-password'), isFalse);

      await tester.enterText(input('reset-password'), 'password123');
      await tester.enterText(input('reset-confirm'), 'password123');
      await tester.tap(find.byKey(const Key('reset-submit')));
      await tester.pumpAndSettle();
      expect(find.textContaining('too common'), findsOneWidget);

      await tester.enterText(input('reset-password'), 'a-brand-new-passphrase');
      await tester.enterText(input('reset-confirm'), 'a-brand-new-passphrase');
      await tester.tap(find.byKey(const Key('reset-submit')));
      await tester.pumpAndSettle();
      expect(find.text('Password changed'), findsOneWidget);
      expect(seen['/auth/reset-password'], {
        'token': 'tok_123',
        'newPassword': 'a-brand-new-passphrase',
      });
    },
  );
}
