import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:velora/app/app.dart';
import 'package:velora/core/auth/token_store.dart';

import '../support/fakes.dart';
import '../support/harness.dart';

/// Reference renderings of the Sprint 1 screens with the real bundled fonts.
/// Regenerate with `flutter test --update-goldens test/golden` and review the images
/// against docs/mobile-screen-specifications.md before committing them.
Future<void> loadFonts() async {
  Future<ByteData> file(String path) async =>
      ByteData.view((await File(path).readAsBytes()).buffer);
  await (FontLoader('Inter')..addFont(file('assets/fonts/Inter.ttf'))).load();
  await (FontLoader(
    'PlayfairDisplay',
  )..addFont(file('assets/fonts/PlayfairDisplay.ttf'))).load();
  final flutterRoot = Platform.environment['FLUTTER_ROOT'];
  final icons = File(
    '$flutterRoot/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf',
  );
  if (flutterRoot != null && icons.existsSync()) {
    await (FontLoader('MaterialIcons')..addFont(file(icons.path))).load();
  }
}

void main() {
  setUpAll(loadFonts);

  const stored = StoredTokens(
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
  );
  Handler server(String role) =>
      (r, _) => r.path == '/auth/me'
      ? ok(meJson(role: role))
      : apiError(404, 'NOT_FOUND');

  for (final dark in [false, true]) {
    final mode = dark ? 'dark' : 'light';

    testWidgets('login ($mode)', (tester) async {
      setScreenSize(tester, const Size(390, 844));
      tester.platformDispatcher.platformBrightnessTestValue = dark
          ? Brightness.dark
          : Brightness.light;
      addTearDown(tester.platformDispatcher.clearPlatformBrightnessTestValue);
      await tester.pumpWidget(AppHarness(server: server('MANAGER')).build());
      await tester.pumpAndSettle();
      await expectLater(
        find.byType(VeloraAppRoot),
        matchesGoldenFile('goldens/login_$mode.png'),
      );
    });

    testWidgets('home, manager ($mode)', (tester) async {
      setScreenSize(tester, const Size(390, 844));
      tester.platformDispatcher.platformBrightnessTestValue = dark
          ? Brightness.dark
          : Brightness.light;
      addTearDown(tester.platformDispatcher.clearPlatformBrightnessTestValue);
      await tester.pumpWidget(
        AppHarness(server: server('MANAGER'), tokens: stored).build(),
      );
      await tester.pumpAndSettle();
      await expectLater(
        find.byType(VeloraAppRoot),
        matchesGoldenFile('goldens/home_manager_$mode.png'),
      );
    });
  }

  testWidgets('more', (tester) async {
    setScreenSize(tester, const Size(390, 844));
    await tester.pumpWidget(
      AppHarness(server: server('SALES'), tokens: stored).build(),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('More'));
    await tester.pumpAndSettle();
    await expectLater(
      find.byType(VeloraAppRoot),
      matchesGoldenFile('goldens/more_sales_light.png'),
    );
  });

  testWidgets('home on a tablet', (tester) async {
    setScreenSize(tester, const Size(1194, 834));
    await tester.pumpWidget(
      AppHarness(server: server('MANAGER'), tokens: stored).build(),
    );
    await tester.pumpAndSettle();
    await expectLater(
      find.byType(VeloraAppRoot),
      matchesGoldenFile('goldens/home_tablet_light.png'),
    );
  });
}

typedef VeloraAppRoot = VeloraApp;
