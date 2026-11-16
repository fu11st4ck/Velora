import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:velora/app/app.dart';
import 'package:velora/app/config/app_config.dart';
import 'package:velora/app/theme/app_theme.dart';
import 'package:velora/core/api/api_client.dart';
import 'package:velora/core/auth/token_store.dart';
import 'package:velora/core/time/clock.dart';

import 'fakes.dart';

/// The real app (router, session, HTTP interceptors) running against a fake transport.
class AppHarness {
  AppHarness({
    required Handler server,
    StoredTokens? tokens,
    this.overrides = const [],
    Map<String, dynamic>? dashboard,

    /// True when [server] answers `/dashboard/summary` itself.
    bool ownDashboard = false,
  }) : adapter = FakeAdapter(
         // Home loads the dashboard in every test; tests about other screens get a quiet one.
         (request, body) =>
             request.path == '/dashboard/summary' && !ownDashboard
             ? ok(dashboard ?? dashboardJson())
             : server(request, body),
       ),
       store = InMemoryTokenStore(tokens);

  final FakeAdapter adapter;
  final InMemoryTokenStore store;

  /// Extra provider overrides for a test (for example a fake link opener).
  final List<Object> overrides;

  /// What the app's clock says. Tests run on 16 Nov 2026, 09:30 unless they set another time.
  DateTime now = DateTime(2026, 11, 16, 9, 30);

  /// The overrides the app runs with — also usable with a bare [ProviderContainer].
  List<Override> get providerOverrides => [
    ...appOverrides(
      const AppConfig(flavor: Flavor.prod, apiBaseUrl: 'http://api.test'),
    ),
    tokenStoreProvider.overrideWithValue(store),
    httpClientAdapterProvider.overrideWithValue(adapter),
    clockProvider.overrideWithValue(() => now),
    ...overrides.cast(),
  ];

  Widget build() => ProviderScope(
    retry: noAutomaticRetry,
    overrides: providerOverrides,
    child: const VeloraApp(),
  );
}

/// Pumps a single screen inside the app theme, for focused widget tests.
Future<void> pumpScreen(
  WidgetTester tester,
  Widget screen, {
  List<Object> overrides = const [],
  bool dark = false,
}) => tester.pumpWidget(
  ProviderScope(
    retry: noAutomaticRetry,
    overrides: overrides.cast(),
    child: MaterialApp(
      theme: dark ? AppTheme.dark() : AppTheme.light(),
      home: screen,
    ),
  ),
);

void setScreenSize(WidgetTester tester, Size size) {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
}
