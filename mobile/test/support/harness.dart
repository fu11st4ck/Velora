import 'package:flutter_riverpod/flutter_riverpod.dart';
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
  AppHarness({required Handler server, StoredTokens? tokens})
    : adapter = FakeAdapter(server),
      store = InMemoryTokenStore(tokens);

  final FakeAdapter adapter;
  final InMemoryTokenStore store;

  Widget build() => ProviderScope(
    overrides: [
      ...appOverrides(
        const AppConfig(flavor: Flavor.prod, apiBaseUrl: 'http://api.test'),
      ),
      tokenStoreProvider.overrideWithValue(store),
      httpClientAdapterProvider.overrideWithValue(adapter),
      clockProvider.overrideWithValue(() => DateTime(2026, 11, 16, 9, 30)),
    ],
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
