import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:velora/app/app.dart';
import 'package:velora/core/auth/token_store.dart';
import 'package:velora/core/storage/key_value_store.dart';

import '../support/fake_customer_server.dart';
import '../support/fake_inventory_server.dart';
import '../support/fake_shop_server.dart';
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

  group('customers', () {
    Future<FakeCustomerServer> openCustomers(
      WidgetTester tester, {
      String role = 'MANAGER',
    }) async {
      setScreenSize(tester, const Size(390, 844));
      final server = FakeCustomerServer(role: role)..seedReference();
      server.seed(company: 'Zenith Gems LLC');
      final maya = server.byName('Maya Farah');
      maya['address'] = 'Jumeirah Lake Towers, Dubai';
      maya['taxRegistrationNumber'] = '100123456700003';
      server.summaries[maya['id'] as String] = {
        'invoicedMinor': 1663400,
        'outstandingMinor': 1131200,
        'overdueMinor': 350000,
        'invoiceCount': 3,
        'lastInvoiceAt': '2026-11-10T08:00:00.000Z',
      };
      await tester.pumpWidget(
        AppHarness(server: customerHandler(server), tokens: stored).build(),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('More'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('open-customers')));
      await tester.pumpAndSettle();
      return server;
    }

    testWidgets('directory', (tester) async {
      await openCustomers(tester);
      await expectLater(
        find.byType(VeloraAppRoot),
        matchesGoldenFile('goldens/customers_light.png'),
      );
    });

    testWidgets('detail with an overdue balance', (tester) async {
      await openCustomers(tester);
      await tester.tap(find.text('Maya Farah'));
      await tester.pumpAndSettle();
      await expectLater(
        find.byType(VeloraAppRoot),
        matchesGoldenFile('goldens/customer_detail_light.png'),
      );
    });

    testWidgets('new customer form', (tester) async {
      await openCustomers(tester);
      await tester.tap(find.byKey(const Key('new-customer')));
      await tester.pumpAndSettle();
      await expectLater(
        find.byType(VeloraAppRoot),
        matchesGoldenFile('goldens/customer_form_light.png'),
      );
    });
  });

  group('sales', () {
    Future<FakeShopServer> openSell(
      WidgetTester tester, {
      String role = 'MANAGER',
    }) async {
      setScreenSize(tester, const Size(390, 844));
      final server = FakeShopServer()..role = role;
      await tester.pumpWidget(
        AppHarness(
          server: shopHandler(server),
          tokens: stored,
          overrides: [
            keyValueStoreProvider.overrideWithValue(InMemoryKeyValueStore()),
          ],
        ).build(),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Sell'));
      await tester.pumpAndSettle();
      return server;
    }

    Future<void> tapKey(WidgetTester tester, String key) async {
      await tester.ensureVisible(find.byKey(Key(key)));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(Key(key)));
      await tester.pumpAndSettle();
    }

    Future<void> add(WidgetTester tester, String sku) async {
      await tapKey(tester, 'sell-$sku');
      await tapKey(tester, 'price-submit');
    }

    Future<void> toPayment(WidgetTester tester) async {
      await add(tester, 'VLR-BR-001');
      await add(tester, 'VLR-BG-014');
      await tapKey(tester, 'review-cart');
      await tapKey(tester, 'cart-customer');
      await tester.tap(find.text('Maya Farah').last);
      await tester.pumpAndSettle();
      await tapKey(tester, 'take-payment');
    }

    Future<void> shot(String name) => expectLater(
      find.byType(VeloraAppRoot),
      matchesGoldenFile('goldens/$name.png'),
    );

    testWidgets('sell with a cart in progress', (tester) async {
      await openSell(tester, role: 'SALES');
      await add(tester, 'VLR-BR-001');
      await shot('sell_sales_light');
    });

    testWidgets('price sheet, manager', (tester) async {
      await openSell(tester);
      await tapKey(tester, 'sell-VLR-BR-001');
      await shot('price_sheet_manager_light');
    });

    testWidgets('cart', (tester) async {
      await openSell(tester);
      await add(tester, 'VLR-BR-001');
      await add(tester, 'VLR-BG-014');
      await tapKey(tester, 'review-cart');
      await tapKey(tester, 'cart-customer');
      await tester.tap(find.text('Maya Farah').last);
      await tester.pumpAndSettle();
      await shot('cart_manager_light');
    });

    testWidgets('payment, partial by bank transfer', (tester) async {
      await openSell(tester, role: 'SALES');
      await toPayment(tester);
      await tester.enterText(
        find.descendant(
          of: find.byKey(const Key('payment-amount')),
          matching: find.byType(TextFormField),
        ),
        '3000',
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Bank transfer'));
      await tester.pumpAndSettle();
      await shot('payment_partial_light');
    });

    testWidgets('invoice and documents', (tester) async {
      await openSell(tester);
      await toPayment(tester);
      await tapKey(tester, 'amount-half');
      await tapKey(tester, 'create-invoice');
      await tapKey(tester, 'confirm-invoice');
      await shot('invoice_partial_manager_light');
      await tester.pageBack();
      await tester.pumpAndSettle();
      await shot('documents_light');
    });
  });
}

typedef VeloraAppRoot = VeloraApp;
