import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:velora/app/app.dart';
import 'package:velora/core/auth/token_store.dart';

import '../support/fake_inventory_server.dart';
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

  group('inventory', () {
    Future<FakeInventoryServer> openInventory(
      WidgetTester tester, {
      String role = 'MANAGER',
      bool dark = false,
    }) async {
      setScreenSize(tester, const Size(390, 844));
      tester.platformDispatcher.platformBrightnessTestValue = dark
          ? Brightness.dark
          : Brightness.light;
      addTearDown(tester.platformDispatcher.clearPlatformBrightnessTestValue);
      final server = FakeInventoryServer(role: role)..seedReferenceCatalogue();
      server.seed(
        sku: 'VLR-PD-030',
        name: 'Pearl Drop Pendant',
        quantity: 0,
        costMinor: 98000,
      );
      await tester.pumpWidget(
        AppHarness(server: inventoryHandler(server), tokens: stored).build(),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Inventory'));
      await tester.pumpAndSettle();
      return server;
    }

    testWidgets('list, manager', (tester) async {
      await openInventory(tester);
      await expectLater(
        find.byType(VeloraAppRoot),
        matchesGoldenFile('goldens/inventory_manager_light.png'),
      );
    });

    testWidgets('list, sales, dark', (tester) async {
      await openInventory(tester, role: 'SALES', dark: true);
      await expectLater(
        find.byType(VeloraAppRoot),
        matchesGoldenFile('goldens/inventory_sales_dark.png'),
      );
    });

    testWidgets('product detail', (tester) async {
      await openInventory(tester);
      await tester.tap(find.text('Alhambra Gold Bracelet'));
      await tester.pumpAndSettle();
      await expectLater(
        find.byType(VeloraAppRoot),
        matchesGoldenFile('goldens/product_detail_manager_light.png'),
      );
    });

    testWidgets('receive stock with preview', (tester) async {
      await openInventory(tester);
      await tester.tap(find.text('Alhambra Gold Bracelet'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('receive-stock')));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.descendant(
          of: find.byKey(const Key('field-quantity')),
          matching: find.byType(TextFormField),
        ),
        '10',
      );
      await tester.enterText(
        find.descendant(
          of: find.byKey(const Key('field-cost')),
          matching: find.byType(TextFormField),
        ),
        '2900',
      );
      await tester.pumpAndSettle();
      await expectLater(
        find.byType(VeloraAppRoot),
        matchesGoldenFile('goldens/receive_stock_light.png'),
      );
    });

    testWidgets('new product with validation errors', (tester) async {
      await openInventory(tester);
      await tester.tap(find.byKey(const Key('new-product')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('save-product')));
      await tester.pumpAndSettle();
      await expectLater(
        find.byType(VeloraAppRoot),
        matchesGoldenFile('goldens/new_product_errors_light.png'),
      );
    });
  });
}

typedef VeloraAppRoot = VeloraApp;
