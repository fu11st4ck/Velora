import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';
import 'package:velora/core/auth/token_store.dart';

import '../support/fake_inventory_server.dart';
import '../support/fakes.dart';
import '../support/harness.dart';

/// Inventory screens driven through the real app (router, controllers, API client) against an
/// in-memory server that follows the backend's rules.
void main() {
  const stored = StoredTokens(
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
  );
  late FakeInventoryServer server;
  late AppHarness app;

  Future<void> open(
    WidgetTester tester, {
    String role = 'MANAGER',
    Size size = const Size(390, 844),
  }) async {
    setScreenSize(tester, size);
    server.role = role;
    app = AppHarness(server: inventoryHandler(server), tokens: stored);
    await tester.pumpWidget(app.build());
    await tester.pumpAndSettle();
    await tester.tap(find.text('Inventory'));
    await tester.pumpAndSettle();
  }

  Finder field(String key) => find.descendant(
    of: find.byKey(Key(key)),
    matching: find.byType(TextFormField),
  );
  Future<void> type(WidgetTester tester, String key, String text) async {
    await tester.ensureVisible(find.byKey(Key(key)));
    await tester.enterText(field(key), text);
    await tester.pump();
  }

  /// Brings a widget into view the way a user would (scrolling the page), then taps it.
  Future<void> tapKey(WidgetTester tester, String key) async {
    final target = find.byKey(Key(key));
    if (target.evaluate().isEmpty) {
      // Not built yet because it is further down a lazily built page.
      await tester.scrollUntilVisible(
        target,
        200,
        scrollable: find.byType(Scrollable).last,
      );
    }
    await tester.ensureVisible(target);
    await tester.pumpAndSettle();
    await tester.tap(target);
    await tester.pumpAndSettle();
  }

  Future<void> openProduct(WidgetTester tester, String sku) =>
      tapKey(tester, 'product-$sku');

  List<Map<String, dynamic>?> bodies(String method, String path) => [
    for (final r in app.adapter.requests)
      if (r.method == method && r.path == path) r.data as Map<String, dynamic>?,
  ];

  setUp(() {
    server = FakeInventoryServer()..seedReferenceCatalogue();
  });

  group('inventory list', () {
    testWidgets('shows products with stock status and counts per filter', (
      tester,
    ) async {
      await open(tester);
      expect(find.text('Alhambra Gold Bracelet'), findsOneWidget);
      expect(find.text('VLR-BR-001 · 12.8 g'), findsOneWidget);
      expect(find.text('Cost AED 2,800.00'), findsOneWidget);
      expect(find.text('All · 4'), findsOneWidget);
      expect(find.text('In stock · 2'), findsOneWidget);
      expect(find.text('Low · 2'), findsOneWidget);
      expect(find.text('Out · 0'), findsOneWidget);
      expect(find.text('Low stock'), findsNWidgets(2));
    });

    testWidgets('filters by stock status', (tester) async {
      await open(tester);
      await tapKey(tester, 'filter-low');
      expect(find.text('Classic Gold Bangle'), findsOneWidget);
      expect(find.text('Diamond Tennis Bracelet'), findsOneWidget);
      expect(find.text('Alhambra Gold Bracelet'), findsNothing);
      expect(app.adapter.requests.last.queryParameters['stockStatus'], 'low');
    });

    testWidgets('searches after a short pause, not on every keystroke', (
      tester,
    ) async {
      await open(tester);
      final before = app.adapter.count('/products');
      await tester.enterText(find.byKey(const Key('inventory-search')), 'r');
      await tester.pump(const Duration(milliseconds: 100));
      await tester.enterText(find.byKey(const Key('inventory-search')), 'ro');
      await tester.pump(const Duration(milliseconds: 100));
      await tester.enterText(find.byKey(const Key('inventory-search')), 'rose');
      await tester.pumpAndSettle(const Duration(milliseconds: 400));
      expect(app.adapter.count('/products'), before + 1);
      expect(app.adapter.requests.last.queryParameters['q'], 'rose');
      expect(find.text('Rose Gold Cuff'), findsOneWidget);
      expect(find.text('Classic Gold Bangle'), findsNothing);
      expect(find.text('All · 1'), findsOneWidget);
    });

    testWidgets('explains an empty result and clears the filters', (
      tester,
    ) async {
      await open(tester);
      await tester.enterText(find.byKey(const Key('inventory-search')), 'zzz');
      await tester.pumpAndSettle(const Duration(milliseconds: 400));
      expect(find.text('No products match'), findsOneWidget);
      await tester.tap(find.text('Clear filters'));
      await tester.pumpAndSettle(const Duration(milliseconds: 400));
      expect(find.text('Alhambra Gold Bracelet'), findsOneWidget);
    });

    testWidgets('sorts through the menu', (tester) async {
      await open(tester);
      await tester.tap(find.byTooltip('Sort'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Stock: low to high'));
      await tester.pumpAndSettle();
      expect(app.adapter.requests.last.queryParameters['sort'], 'quantity');
      final rows = tester
          .widgetList<InkWell>(
            find.byWidgetPredicate(
              (w) => w is InkWell && '${w.key}'.contains('product-'),
            ),
          )
          .toList();
      expect('${rows.first.key}', contains('VLR-DB-008'));
    });

    testWidgets('loads further pages while scrolling', (tester) async {
      server.products.clear();
      for (var i = 1; i <= 60; i++) {
        server.seed(
          sku: 'P-${i.toString().padLeft(3, '0')}',
          name: 'Ring ${i.toString().padLeft(3, '0')}',
        );
      }
      await open(tester);
      expect(find.text('All · 60'), findsOneWidget);
      expect(app.adapter.count('/products'), 1);
      await tester.scrollUntilVisible(
        find.text('Ring 060'),
        600,
        scrollable: find.byType(Scrollable).last,
        maxScrolls: 80,
      );
      await tester.pumpAndSettle();
      expect(find.text('Ring 060'), findsOneWidget);
      final cursors = app.adapter.requests
          .where((r) => r.path == '/products')
          .map((r) => r.queryParameters['cursor'])
          .toList();
      expect(cursors, [
        null,
        '25',
        '50',
      ], reason: 'each page requested exactly once');
    });

    testWidgets('shows an error with retry when the list cannot load', (
      tester,
    ) async {
      var online = false;
      setScreenSize(tester, const Size(390, 844));
      app = AppHarness(
        server: (r, b) => r.path == '/auth/me'
            ? ok(meJson())
            : (online ? server.handle(r, b)! : offline(r)),
        tokens: stored,
      );
      await tester.pumpWidget(app.build());
      await tester.pumpAndSettle();
      await tester.tap(find.text('Inventory'));
      await tester.pumpAndSettle();
      expect(find.text('Could not load'), findsOneWidget);
      expect(
        find.text('No connection. Check your internet and try again.'),
        findsOneWidget,
      );
      online = true;
      await tester.tap(find.text('Try again'));
      await tester.pumpAndSettle();
      expect(find.text('Alhambra Gold Bracelet'), findsOneWidget);
    });

    testWidgets('invites a manager to add the first product', (tester) async {
      server.products.clear();
      await open(tester);
      expect(find.text('No products yet'), findsOneWidget);
      await tester.tap(find.text('Add product'));
      await tester.pumpAndSettle();
      expect(find.text('New product'), findsWidgets);
    });
  });

  group('sales role', () {
    testWidgets(
      'sees selling prices, never cost, and no stock-management actions',
      (tester) async {
        await open(tester, role: 'SALES');
        expect(find.text('From AED 3,640.00'), findsOneWidget);
        expect(find.textContaining('Cost'), findsNothing);
        expect(find.byKey(const Key('new-product')), findsNothing);

        await openProduct(tester, 'VLR-BR-001');
        expect(find.text('List price'), findsOneWidget);
        expect(find.text('AED 3,640.00'), findsOneWidget);
        expect(find.text('Lowest price'), findsOneWidget);
        expect(find.text('AED 3,220.00'), findsOneWidget);
        for (final hidden in [
          'Cost',
          'Default markup',
          'Minimum markup',
          'Stock value at cost',
        ]) {
          expect(find.text(hidden), findsNothing, reason: hidden);
        }
        expect(find.textContaining('Unit cost'), findsNothing);
        expect(find.byKey(const Key('receive-stock')), findsNothing);
        expect(find.byKey(const Key('adjust-stock')), findsNothing);
        expect(find.byKey(const Key('product-menu')), findsNothing);
      },
    );

    testWidgets('is redirected away from manager-only screens opened by link', (
      tester,
    ) async {
      await open(tester, role: 'SALES');
      final context = tester.element(find.text('Inventory').first);
      GoRouterHelper(context).go('/inventory/new');
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('save-product')), findsNothing);
      expect(find.text('Alhambra Gold Bracelet'), findsOneWidget);
      GoRouterHelper(context)
          .go('/inventory/${server.bySku('VLR-BR-001')['id']}/adjust');
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('submit-adjustment')), findsNothing);
    });
  });

  group('product detail', () {
    testWidgets('shows stock, pricing policy and the ledger to a manager', (
      tester,
    ) async {
      await open(tester);
      await openProduct(tester, 'VLR-BR-001');
      expect(find.text('24 pcs'), findsOneWidget);
      expect(find.text('8 pcs (business default)'), findsOneWidget);
      expect(find.text('AED 2,800.00'), findsOneWidget);
      expect(find.text('30%'), findsOneWidget);
      expect(find.text('15%'), findsOneWidget);
      expect(find.text('AED 3,640.00'), findsOneWidget);
      expect(find.text('AED 67,200.00'), findsOneWidget); // 24 × 2,800.00
      await tester.scrollUntilVisible(
        find.text('Opening stock'),
        300,
        scrollable: find.byType(Scrollable).last,
      );
      expect(find.text('+24'), findsOneWidget);
      expect(find.text('Balance 24'), findsOneWidget);
    });

    testWidgets(
      'refuses to archive a product that still has stock and says how much',
      (tester) async {
        await open(tester);
        await openProduct(tester, 'VLR-BR-001');
        await tapKey(tester, 'product-menu');
        await tester.tap(find.text('Archive product'));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('confirm-archive')));
        await tester.pumpAndSettle();
        expect(find.textContaining('still has 24 in stock'), findsOneWidget);
        expect(server.bySku('VLR-BR-001')['archivedAt'], isNull);
      },
    );

    testWidgets(
      'archives a product with no stock and removes it from the list',
      (tester) async {
        server.seed(sku: 'OLD-1', name: 'Old Brooch', quantity: 0);
        await open(tester);
        await openProduct(tester, 'OLD-1');
        await tapKey(tester, 'product-menu');
        await tester.tap(find.text('Archive product'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Cancel'));
        await tester.pumpAndSettle();
        expect(
          server.bySku('OLD-1')['archivedAt'],
          isNull,
          reason: 'cancel changes nothing',
        );

        await tapKey(tester, 'product-menu');
        await tester.tap(find.text('Archive product'));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('confirm-archive')));
        await tester.pumpAndSettle();
        expect(server.bySku('OLD-1')['archivedAt'], isNotNull);
        expect(find.text('Inventory'), findsWidgets);
        expect(find.text('Old Brooch'), findsNothing);
      },
    );
  });

  group('receive stock', () {
    testWidgets(
      'previews the new stock and average cost, then saves and refreshes',
      (tester) async {
        await open(tester);
        await openProduct(tester, 'VLR-BR-001');
        await tapKey(tester, 'receive-stock');
        expect(
          tester.widget<TextFormField>(field('field-cost')).controller!.text,
          '2800.00',
        );

        await type(tester, 'field-quantity', '10');
        await type(tester, 'field-cost', '2900');
        await type(tester, 'field-supplier', 'Al Noor Gold');
        await tester.pumpAndSettle();
        expect(find.text('AED 29,000.00'), findsOneWidget);
        expect(find.text('24 → 34 pcs'), findsOneWidget);
        expect(find.text('AED 2,800.00 → AED 2,829.41'), findsOneWidget);

        await tapKey(tester, 'submit-receipt');
        expect(bodies('POST', '/inventory/receipts').single, {
          'productId': server.bySku('VLR-BR-001')['id'],
          'quantity': 10,
          'unitCostMinor': 290000,
          'supplierName': 'Al Noor Gold',
          'referenceNote': null,
        });
        // Back on the product, showing the server's figures.
        expect(find.text('Stock received. Now 34 on hand.'), findsOneWidget);
        expect(find.text('34 pcs'), findsOneWidget);
        expect(find.text('AED 2,829.41'), findsOneWidget);
      },
    );

    testWidgets('validates before sending', (tester) async {
      await open(tester);
      await openProduct(tester, 'VLR-BR-001');
      await tapKey(tester, 'receive-stock');
      await type(tester, 'field-cost', '12.345');
      await tapKey(tester, 'submit-receipt');
      expect(find.text('Enter a whole number.'), findsOneWidget);
      expect(
        find.text('Enter a valid amount with up to 2 decimals.'),
        findsOneWidget,
      );
      await type(tester, 'field-quantity', '0');
      await tapKey(tester, 'submit-receipt');
      expect(find.text('Enter at least 1.'), findsOneWidget);
      expect(bodies('POST', '/inventory/receipts'), isEmpty);
    });

    testWidgets(
      'a retry after a lost connection reuses the same key, so stock is added once',
      (tester) async {
        await open(tester);
        await openProduct(tester, 'VLR-BR-001');
        await tapKey(tester, 'receive-stock');
        await type(tester, 'field-quantity', '10');
        server.failNextWithNetworkError = true;
        await tapKey(tester, 'submit-receipt');
        expect(
          find.text('No connection. Check your internet and try again.'),
          findsOneWidget,
        );
        expect(
          tester
              .widget<TextFormField>(field('field-quantity'))
              .controller!
              .text,
          '10',
          reason: 'input is kept',
        );

        await tapKey(tester, 'submit-receipt');
        final keys = app.adapter.requests
            .where((r) => r.path == '/inventory/receipts')
            .map((r) => r.headers['Idempotency-Key'])
            .toList();
        expect(keys, hasLength(2));
        expect(keys[0], keys[1]);
        expect(
          keys[0],
          matches(
            RegExp(
              r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
            ),
          ),
        );
        expect(server.bySku('VLR-BR-001')['quantity'], 34);
      },
    );
  });

  group('adjust stock', () {
    testWidgets('needs a reason and a confirmation, then removes the stock', (
      tester,
    ) async {
      await open(tester);
      await openProduct(tester, 'VLR-BR-001');
      await tapKey(tester, 'adjust-stock');

      await type(tester, 'field-quantity', '2');
      await tapKey(tester, 'submit-adjustment');
      expect(find.text('Choose a reason.'), findsOneWidget);

      await tapKey(tester, 'reason-Damaged');
      expect(find.text('24 → 22 pcs'), findsOneWidget);
      await tapKey(tester, 'submit-adjustment');
      expect(find.text('Remove 2 from stock?'), findsOneWidget);
      expect(find.textContaining('Stock: 24 → 22 pcs'), findsOneWidget);
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(
        bodies('POST', '/inventory/adjustments'),
        isEmpty,
        reason: 'nothing is sent before confirming',
      );

      await tapKey(tester, 'submit-adjustment');
      await tester.tap(find.byKey(const Key('confirm-adjust')));
      await tester.pumpAndSettle();
      expect(bodies('POST', '/inventory/adjustments').single, {
        'productId': server.bySku('VLR-BR-001')['id'],
        'quantityDelta': -2,
        'reason': 'Damaged',
      });
      expect(find.text('Stock adjusted. Now 22 on hand.'), findsOneWidget);
      expect(find.text('22 pcs'), findsOneWidget);
    });

    testWidgets('cannot remove more than is on hand', (tester) async {
      await open(tester);
      await openProduct(tester, 'VLR-DB-008');
      await tapKey(tester, 'adjust-stock');
      await type(tester, 'field-quantity', '5');
      await tapKey(tester, 'reason-Lost');
      await tapKey(tester, 'submit-adjustment');
      expect(find.text('Only 4 on hand.'), findsOneWidget);
      expect(find.byKey(const Key('confirm-adjust')), findsNothing);
    });

    testWidgets('adds stock with a custom reason', (tester) async {
      await open(tester);
      await openProduct(tester, 'VLR-DB-008');
      await tapKey(tester, 'adjust-stock');
      await tester.tap(find.text('Add'));
      await tester.pumpAndSettle();
      await type(tester, 'field-quantity', '3');
      await tapKey(tester, 'reason-Other');
      await tapKey(tester, 'submit-adjustment');
      expect(
        find.text('Describe the reason (at least 3 characters).'),
        findsOneWidget,
      );
      await type(tester, 'field-other-reason', 'Found in the safe');
      await tapKey(tester, 'submit-adjustment');
      expect(find.text('Add 3 to stock?'), findsOneWidget);
      await tester.tap(find.byKey(const Key('confirm-adjust')));
      await tester.pumpAndSettle();
      expect(
        bodies('POST', '/inventory/adjustments').single,
        containsPair('quantityDelta', 3),
      );
      expect(
        bodies('POST', '/inventory/adjustments').single,
        containsPair('reason', 'Found in the safe'),
      );
      expect(find.text('7 pcs'), findsOneWidget);
    });

    testWidgets('shows the current stock when someone else got there first', (
      tester,
    ) async {
      await open(tester);
      await openProduct(tester, 'VLR-DB-008');
      await tapKey(tester, 'adjust-stock');
      await type(tester, 'field-quantity', '4');
      await tapKey(tester, 'reason-Lost');
      server.bySku('VLR-DB-008')['quantity'] =
          1; // another device sold three meanwhile
      await tapKey(tester, 'submit-adjustment');
      await tester.tap(find.byKey(const Key('confirm-adjust')));
      await tester.pumpAndSettle();
      expect(find.text('Only 1 in stock.'), findsOneWidget);
      expect(find.textContaining('1 on hand'), findsOneWidget);
      expect(server.bySku('VLR-DB-008')['quantity'], 1);
    });
  });

  group('stock history', () {
    testWidgets('lists the ledger newest first and filters by kind', (
      tester,
    ) async {
      final p = server.bySku('VLR-BR-001');
      server.handle(_post('/inventory/receipts'), {
        'productId': p['id'],
        'quantity': 10,
        'unitCostMinor': 290000,
        'supplierName': 'Al Noor Gold',
      });
      server.handle(_post('/inventory/adjustments'), {
        'productId': p['id'],
        'quantityDelta': -2,
        'reason': 'Damaged',
      });
      await open(tester);
      await openProduct(tester, 'VLR-BR-001');
      await tapKey(tester, 'view-history');
      expect(find.text('Stock history'), findsOneWidget);
      expect(find.text('Adjustment (removed)'), findsOneWidget);
      expect(find.text('Stock received'), findsOneWidget);
      expect(find.text('Opening stock'), findsOneWidget);
      expect(find.textContaining('From Al Noor Gold'), findsOneWidget);
      expect(find.textContaining('Unit cost AED 2,900.00'), findsOneWidget);
      expect(find.text('−2'), findsOneWidget);
      expect(find.text('Balance 32'), findsOneWidget);

      await tapKey(tester, 'history-adjustments');
      expect(find.text('Adjustment (removed)'), findsOneWidget);
      expect(find.text('Stock received'), findsNothing);
      expect(
        app.adapter.requests.last.queryParameters['type'],
        'ADJUSTMENT_IN,ADJUSTMENT_OUT',
      );

      await tapKey(tester, 'history-returns');
      expect(find.text('No returns yet'), findsOneWidget);
    });
  });

  group('new product', () {
    Future<void> openForm(WidgetTester tester) async {
      await open(tester);
      await tester.tap(find.byKey(const Key('new-product')));
      await tester.pumpAndSettle();
    }

    testWidgets(
      'validates locally and creates nothing until the form is valid',
      (tester) async {
        await openForm(tester);
        await type(tester, 'field-default-markup', '10');
        await type(tester, 'field-min-markup', '40');
        await tapKey(tester, 'save-product');
        expect(find.text('Enter the product name.'), findsOneWidget);
        expect(find.text('Enter an amount.'), findsOneWidget);
        expect(
          find.text('Must not exceed the default markup.'),
          findsOneWidget,
        );
        expect(find.text('Enter a whole number.'), findsOneWidget);
        await type(tester, 'field-default-markup', '75');
        await tapKey(tester, 'save-product');
        expect(find.text('Must not exceed 60%.'), findsOneWidget);
        expect(bodies('POST', '/products'), isEmpty);
      },
    );

    testWidgets(
      'previews prices and the purchase total, saves, and shows the product in the list',
      (tester) async {
        await openForm(tester);
        await type(tester, 'field-name', 'Pearl Drop Ring');
        await type(tester, 'field-weight', '3.5');
        await type(tester, 'field-cost', '1000.55');
        await type(tester, 'field-quantity', '2');
        await tester.pumpAndSettle();
        expect(find.text('AED 1,300.72'), findsOneWidget); // list price at 30%
        expect(
          find.text('AED 1,150.63'),
          findsOneWidget,
        ); // lowest price at 15%
        expect(
          find.text('AED 2,001.10'),
          findsOneWidget,
        ); // 2 × 1,000.55 (the reference showed "AED 2,001")

        await tapKey(tester, 'save-product');
        expect(bodies('POST', '/products').single, {
          'name': 'Pearl Drop Ring',
          'sku': null,
          'barcode': null,
          'description': null,
          'weight': {'value': '3.5', 'unit': 'G'},
          'costMinor': 100055,
          'defaultMarkupBp': 3000,
          'minMarkupBp': 1500,
          'openingQuantity': 2,
          'reorderLevel': null,
          'supplierName': null,
          'referenceNote': null,
        });
        expect(find.text('Pearl Drop Ring added to inventory'), findsOneWidget);
        expect(find.text('Pearl Drop Ring'), findsOneWidget);
        expect(find.text('All · 5'), findsOneWidget);
      },
    );

    testWidgets(
      'shows a taken SKU on the SKU field and sends the corrected form as a new request',
      (tester) async {
        await openForm(tester);
        await type(tester, 'field-name', 'Second Bracelet');
        await type(tester, 'field-sku', 'vlr-br-001');
        await type(tester, 'field-cost', '100');
        await type(tester, 'field-quantity', '1');
        await tapKey(tester, 'save-product');
        expect(
          find.text('Another product already uses this SKU.'),
          findsOneWidget,
        );
        expect(server.products, hasLength(4));

        await type(tester, 'field-sku', 'VLR-BR-002');
        await tapKey(tester, 'save-product');
        expect(server.products, hasLength(5));
        final keys = app.adapter.requests
            .where((r) => r.method == 'POST' && r.path == '/products')
            .map((r) => r.headers['Idempotency-Key'])
            .toList();
        expect(keys[0], isNot(keys[1]));
      },
    );

    testWidgets('asks before discarding entered data', (tester) async {
      await openForm(tester);
      await type(tester, 'field-name', 'Half typed');
      await tester.pageBack();
      await tester.pumpAndSettle();
      expect(find.text('Discard changes?'), findsOneWidget);
      await tester.tap(find.text('Keep editing'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('save-product')), findsOneWidget);
      await tester.pageBack();
      await tester.pumpAndSettle();
      await tester.tap(find.text('Discard'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('save-product')), findsNothing);
      expect(bodies('POST', '/products'), isEmpty);
    });
  });

  group('edit product', () {
    Future<void> openEdit(WidgetTester tester) async {
      await open(tester);
      await openProduct(tester, 'VLR-BR-001');
      await tapKey(tester, 'product-menu');
      await tester.tap(find.text('Edit product'));
      await tester.pumpAndSettle();
    }

    testWidgets(
      'pre-fills the form, keeps cost read-only and saves with the version',
      (tester) async {
        await openEdit(tester);
        expect(
          tester.widget<TextFormField>(field('field-name')).controller!.text,
          'Alhambra Gold Bracelet',
        );
        expect(
          tester
              .widget<TextFormField>(field('field-default-markup'))
              .controller!
              .text,
          '30',
        );
        expect(find.byKey(const Key('field-cost')), findsNothing);
        expect(find.byKey(const Key('field-quantity')), findsNothing);

        await type(tester, 'field-name', 'Alhambra Bracelet');
        await type(tester, 'field-min-markup', '20');
        await type(tester, 'field-reorder', '30');
        await tapKey(tester, 'save-product');
        final sent = bodies(
          'PATCH',
          '/products/${server.bySku('VLR-BR-001')['id']}',
        ).single!;
        expect(sent, containsPair('version', 1));
        expect(sent, containsPair('name', 'Alhambra Bracelet'));
        expect(sent, containsPair('minMarkupBp', 2000));
        expect(sent, containsPair('reorderLevel', 30));
        expect(sent.containsKey('costMinor'), isFalse);
        expect(find.text('Alhambra Bracelet updated'), findsOneWidget);
        expect(find.text('Alhambra Bracelet'), findsOneWidget);
        expect(
          find.text('Low stock'),
          findsOneWidget,
          reason: '24 on hand is now below the level of 30',
        );
      },
    );

    testWidgets('tells the user when someone else changed the product first', (
      tester,
    ) async {
      await openEdit(tester);
      server.bySku('VLR-BR-001')['version'] = 2;
      await type(tester, 'field-name', 'My edit');
      await tapKey(tester, 'save-product');
      expect(
        find.textContaining('Someone else changed this product'),
        findsOneWidget,
      );
      expect(server.bySku('VLR-BR-001')['name'], 'Alhambra Gold Bracelet');
    });
  });

  testWidgets('inventory screens meet tap-target and labelling guidelines', (
    tester,
  ) async {
    final handle = tester.ensureSemantics();
    await open(tester);
    await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
    await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
    await openProduct(tester, 'VLR-BR-001');
    await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
    await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
    await tapKey(tester, 'adjust-stock');
    await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
    await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
    handle.dispose();
  });

  testWidgets('list and forms hold at 200% text on a small phone', (
    tester,
  ) async {
    tester.platformDispatcher.textScaleFactorTestValue = 2;
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    await open(tester, size: const Size(360, 640));
    expect(tester.takeException(), isNull);
    // The first row is clear of the floating button at any text size.
    await tester.tap(find.text('Alhambra Gold Bracelet'));
    await tester.pumpAndSettle();
    expect(find.text('Product'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tapKey(tester, 'receive-stock');
    expect(find.byKey(const Key('submit-receipt')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}

RequestOptions _post(String path) => RequestOptions(
  path: path,
  method: 'POST',
  headers: {
    'Idempotency-Key':
        'seed-${path.hashCode}-${DateTime.now().microsecondsSinceEpoch}',
  },
);
