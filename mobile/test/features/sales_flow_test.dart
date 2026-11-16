import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:velora/core/auth/token_store.dart';
import 'package:velora/core/platform/link_opener.dart';
import 'package:velora/core/storage/key_value_store.dart';
import 'package:velora/features/documents/presentation/document_controllers.dart';

import '../support/fake_shop_server.dart';
import '../support/harness.dart';

/// The sale, from picking a product to a paid invoice, and everything that can happen to the
/// invoice afterwards — driven through the real app against an in-memory server.
void main() {
  const stored = StoredTokens(
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
  );
  late FakeShopServer server;
  late AppHarness app;
  late InMemoryKeyValueStore device;
  final shared = <({Uint8List pdf, String filename, String text})>[];
  final opened = <Uri>[];

  Future<void> launch(
    WidgetTester tester, {
    String role = 'SALES',
    String tab = 'Sell',
  }) async {
    setScreenSize(tester, const Size(390, 844));
    server.role = role;
    app = AppHarness(
      server: shopHandler(server),
      tokens: stored,
      overrides: [
        keyValueStoreProvider.overrideWithValue(device),
        documentSharerProvider.overrideWithValue(({
          required pdf,
          required filename,
          required text,
        }) async {
          shared.add((pdf: pdf, filename: filename, text: text));
          return true;
        }),
        linkOpenerProvider.overrideWithValue((uri) async {
          opened.add(uri);
          return true;
        }),
      ],
    );
    await tester.pumpWidget(app.build());
    await tester.pumpAndSettle();
    await tester.tap(
      find.descendant(of: find.byType(NavigationBar), matching: find.text(tab)),
    );
    await tester.pumpAndSettle();
  }

  Finder field(String key) => find.descendant(
    of: find.byKey(Key(key)),
    matching: find.byType(TextFormField),
  );
  Future<void> type(WidgetTester tester, String key, String text) async {
    await tester.ensureVisible(find.byKey(Key(key)));
    await tester.enterText(field(key), text);
    await tester.pumpAndSettle();
  }

  Future<void> tapKey(WidgetTester tester, String key) async {
    final target = find.byKey(Key(key));
    if (target.evaluate().isEmpty) {
      // Lazy lists build only what is near the viewport: look below, then above.
      final list = find.byType(Scrollable).last;
      try {
        await tester.scrollUntilVisible(target, 200, scrollable: list);
      } on StateError {
        await tester.scrollUntilVisible(target, -200, scrollable: list);
      }
    }
    await tester.ensureVisible(target);
    await tester.pumpAndSettle();
    await tester.tap(target);
    await tester.pumpAndSettle();
  }

  Future<void> tapText(WidgetTester tester, String text) async {
    await tester.tap(find.text(text).last);
    await tester.pumpAndSettle();
  }

  /// Adds a product at its list price (or [price]) and [quantity] through the price sheet.
  Future<void> addToCart(
    WidgetTester tester,
    String sku, {
    int quantity = 1,
    String? price,
  }) async {
    await tapKey(tester, 'sell-$sku');
    if (price != null) await type(tester, 'price-field', price);
    for (var i = 1; i < quantity; i++) {
      await tapKey(tester, 'qty-plus');
    }
    await tapKey(tester, 'price-submit');
  }

  Future<void> chooseCustomer(WidgetTester tester, String name) async {
    await tapKey(tester, 'cart-customer');
    await tapText(tester, name);
  }

  /// From the Sell tab to a created invoice for one bracelet, paying [amount] (null = full).
  Future<void> sellBracelet(
    WidgetTester tester, {
    String? amount,
    bool none = false,
  }) async {
    await addToCart(tester, 'VLR-BR-001');
    await tapKey(tester, 'review-cart');
    await chooseCustomer(tester, 'Maya Farah');
    await tapKey(tester, 'take-payment');
    if (none) await tapKey(tester, 'amount-none');
    if (amount != null) await type(tester, 'payment-amount', amount);
    await tapKey(tester, 'create-invoice');
    await tapKey(tester, 'confirm-invoice');
  }

  Map<String, dynamic> lastBody(String path) =>
      app.adapter.requests
              .lastWhere((r) => r.method == 'POST' && r.path == path)
              .data
          as Map<String, dynamic>;

  /// Carts kept on the device (the store also remembers the profile).
  Iterable<String> savedCarts() =>
      device.values.keys.where((k) => k.startsWith('velora.cart'));

  setUp(() {
    server = FakeShopServer();
    device = InMemoryKeyValueStore();
    shared.clear();
    opened.clear();
  });

  group('choosing products', () {
    testWidgets(
      'lists what is in stock at list price, without cost for sales staff',
      (tester) async {
        server.inventory.seed(
          sku: 'VLR-SO-099',
          name: 'Sold Out Pendant',
          quantity: 0,
        );
        await launch(tester);
        expect(find.text('Alhambra Gold Bracelet'), findsOneWidget);
        expect(find.text('VLR-BR-001 · 24 available'), findsOneWidget);
        expect(find.text('AED 3,640.00'), findsOneWidget);
        expect(find.text('Sold Out Pendant'), findsNothing);
        expect(app.adapter.requests.last.queryParameters['sellable'], true);

        await tapKey(tester, 'sell-VLR-BR-001');
        expect(find.text('Lowest AED 3,220.00'), findsOneWidget);
        expect(find.text('Highest AED 4,480.00'), findsOneWidget);
        for (final hidden in [
          'Cost',
          'Profit per item',
          'Sell below the lowest price',
        ]) {
          expect(find.text(hidden), findsNothing, reason: hidden);
        }
        expect(
          find.textContaining('%'),
          findsNothing,
          reason: 'no percentages for sales staff',
        );
      },
    );

    testWidgets('keeps the price between the lowest and highest allowed', (
      tester,
    ) async {
      await launch(tester);
      await tapKey(tester, 'sell-VLR-BR-001');
      await type(tester, 'price-field', '3000');
      await tapKey(tester, 'price-submit');
      expect(
        find.text('Lowest allowed price is AED 3,220.00.'),
        findsOneWidget,
      );
      await type(tester, 'price-field', '5000');
      await tapKey(tester, 'price-submit');
      expect(
        find.text('Highest allowed price is AED 4,480.00.'),
        findsOneWidget,
      );
      await tapKey(tester, 'use-list-price');
      expect(
        tester.widget<TextFormField>(field('price-field')).controller!.text,
        '3640.00',
      );
      await type(tester, 'price-field', '3500.50');
      expect(
        find.text('AED 3,500.50'),
        findsOneWidget,
      ); // line total follows the typed price
      await tapKey(tester, 'price-submit');
      expect(find.text('AED 3,500.50'), findsOneWidget); // cart summary
    });

    testWidgets(
      'cannot add more units than are in stock, counting what is already in the cart',
      (tester) async {
        await launch(tester);
        await addToCart(tester, 'VLR-DB-008', quantity: 3);
        expect(
          find.text('VLR-DB-008 · 1 available · 3 in cart'),
          findsOneWidget,
        );
        await tapKey(tester, 'sell-VLR-DB-008');
        expect(find.text('VLR-DB-008 · 1 available'), findsOneWidget);
        expect(
          tester
              .widget<IconButton>(find.byKey(const Key('qty-plus')))
              .onPressed,
          isNull,
        );
        await tapKey(tester, 'price-submit');
        await tapKey(tester, 'sell-VLR-DB-008');
        expect(find.textContaining('none left to add'), findsOneWidget);
        expect(
          tester
              .widget<FilledButton>(
                find.descendant(
                  of: find.byKey(const Key('price-submit')),
                  matching: find.byType(FilledButton),
                ),
              )
              .onPressed,
          isNull,
        );
      },
    );

    testWidgets('shows the cart size on the Sell tab from anywhere', (
      tester,
    ) async {
      await launch(tester);
      await addToCart(tester, 'VLR-BR-001', quantity: 2);
      await tester.tap(
        find.descendant(
          of: find.byType(NavigationBar),
          matching: find.text('Home'),
        ),
      );
      await tester.pumpAndSettle();
      expect(
        find.descendant(
          of: find.byType(NavigationBar),
          matching: find.text('2'),
        ),
        findsOneWidget,
      );
    });
  });

  group('cart', () {
    testWidgets('shows server totals and requires a customer before going on', (
      tester,
    ) async {
      await launch(tester);
      await addToCart(tester, 'VLR-BR-001');
      await tapKey(tester, 'review-cart');
      expect(find.text('AED 182.00'), findsOneWidget); // VAT 5%
      expect(
        tester.widget<Text>(find.byKey(const Key('cart-total'))).data,
        'AED 3,822.00',
      );

      await tapKey(tester, 'take-payment');
      expect(find.text('Choose a customer first.'), findsOneWidget);
      expect(find.text('Required for a quotation or invoice.'), findsOneWidget);
      expect(find.byKey(const Key('create-invoice')), findsNothing);

      await chooseCustomer(tester, 'Maya Farah');
      expect(find.text('Maison Luxe · +971558204412'), findsOneWidget);
    });

    testWidgets(
      'applies a discount and a tax rate, and rejects a discount above the subtotal',
      (tester) async {
        await launch(tester);
        await addToCart(tester, 'VLR-RC-021', price: '2989');
        await tapKey(tester, 'review-cart');
        await type(tester, 'cart-discount', '150');
        // The reference's own example: 2,989.00 − 150.00, VAT 5% = 141.95, total 2,980.95.
        expect(find.text('− AED 150.00'), findsOneWidget);
        expect(find.text('AED 141.95'), findsOneWidget);
        expect(
          tester.widget<Text>(find.byKey(const Key('cart-total'))).data,
          'AED 2,980.95',
        );

        await tapKey(tester, 'tax-0');
        expect(
          tester.widget<Text>(find.byKey(const Key('cart-total'))).data,
          'AED 2,839.00',
        );
        expect(lastBody('/pricing/preview')['taxRateId'], 't0');

        await type(tester, 'cart-discount', '5000');
        expect(
          find.text('The discount cannot be more than the subtotal.'),
          findsOneWidget,
        );
        await chooseCustomer(tester, 'Maya Farah');
        await tapKey(tester, 'take-payment');
        expect(find.text('Fix the highlighted items first.'), findsOneWidget);
        expect(find.byKey(const Key('create-invoice')), findsNothing);
      },
    );

    testWidgets('edits and removes lines, with undo', (tester) async {
      await launch(tester);
      await addToCart(tester, 'VLR-BR-001');
      await addToCart(tester, 'VLR-RC-021');
      await tapKey(tester, 'review-cart');
      await tapKey(tester, 'cart-line-0');
      expect(find.text('Update'), findsOneWidget);
      await tapKey(tester, 'qty-plus');
      await type(tester, 'price-field', '3700');
      await tapKey(tester, 'price-submit');
      expect(find.text('2 × AED 3,700.00'), findsOneWidget);
      expect(find.text('AED 7,400.00'), findsOneWidget);

      await tapKey(tester, 'remove-line-1');
      expect(find.text('Rose Gold Cuff removed'), findsOneWidget);
      expect(find.text('Rose Gold Cuff'), findsNothing);
      await tapText(tester, 'Undo');
      expect(find.text('Rose Gold Cuff'), findsOneWidget);
    });

    testWidgets('survives closing and reopening the app', (tester) async {
      await launch(tester);
      await addToCart(tester, 'VLR-BR-001', quantity: 2);
      await tapKey(tester, 'review-cart');
      await chooseCustomer(tester, 'Maya Farah');
      await type(tester, 'cart-discount', '100');

      await launch(tester); // a fresh app on the same device storage
      expect(find.text('2 items'), findsOneWidget);
      await tapKey(tester, 'review-cart');
      expect(find.text('Maya Farah'), findsOneWidget);
      expect(find.text('2 × AED 3,640.00'), findsOneWidget);
      expect(
        tester.widget<TextFormField>(field('cart-discount')).controller!.text,
        '100.00',
      );
    });

    testWidgets('can be cleared after confirming', (tester) async {
      await launch(tester);
      await addToCart(tester, 'VLR-BR-001');
      await tapKey(tester, 'review-cart');
      await tapKey(tester, 'clear-cart');
      await tapText(tester, 'Cancel');
      expect(find.text('Alhambra Gold Bracelet'), findsOneWidget);
      await tapKey(tester, 'clear-cart');
      await tapKey(tester, 'confirm-clear');
      expect(find.byKey(const Key('review-cart')), findsNothing);
      expect(savedCarts(), isEmpty);
    });
  });

  group('payment and invoice', () {
    testWidgets(
      'full payment creates a paid invoice, reduces stock and empties the cart',
      (tester) async {
        await launch(tester);
        await addToCart(tester, 'VLR-BR-001');
        await tapKey(tester, 'review-cart');
        await chooseCustomer(tester, 'Maya Farah');
        await tapKey(tester, 'take-payment');
        expect(
          tester.widget<Text>(find.byKey(const Key('payment-total'))).data,
          'AED 3,822.00',
        );
        expect(
          tester
              .widget<TextFormField>(field('payment-amount'))
              .controller!
              .text,
          '3822.00',
        );
        expect(find.text('The invoice will be marked Paid.'), findsOneWidget);

        await tapKey(tester, 'create-invoice');
        expect(
          find.textContaining('Stock is reduced for 1 item.'),
          findsOneWidget,
        );
        expect(
          server.invoices,
          isEmpty,
          reason: 'nothing is created before confirming',
        );
        await tapKey(tester, 'confirm-invoice');

        expect(find.text('INV-2026-00001'), findsOneWidget);
        expect(
          tester.widget<Text>(find.byKey(const Key('invoice-total'))).data,
          'AED 3,822.00',
        );
        expect(
          find.descendant(
            of: find.byKey(const Key('invoice-status')),
            matching: find.text('Paid'),
          ),
          findsOneWidget,
        );
        expect(find.byKey(const Key('record-payment')), findsNothing);
        expect(
          find.text('Profit'),
          findsNothing,
          reason: 'sales staff never see profit',
        );

        expect(lastBody('/invoices'), {
          'customerId': server.customers.byName('Maya Farah')['id'],
          'lines': [
            {
              'productId': server.product('VLR-BR-001')['id'],
              'quantity': 1,
              'unitPriceMinor': 364000,
            },
          ],
          'discountMinor': 0,
          'notes': null,
          'payment': {
            'amountMinor': 382200,
            'method': 'CASH',
            'reference': null,
          },
        });
        expect(server.product('VLR-BR-001')['quantity'], 23);
        expect(savedCarts(), isEmpty, reason: 'the saved cart is gone');
        await tester.tap(
          find.descendant(
            of: find.byType(NavigationBar),
            matching: find.text('Sell'),
          ),
        );
        await tester.pumpAndSettle();
        expect(find.byKey(const Key('review-cart')), findsNothing);
        expect(find.text('VLR-BR-001 · 23 available'), findsOneWidget);
      },
    );

    testWidgets('partial payment by bank transfer shows what stays due', (
      tester,
    ) async {
      await launch(tester);
      await addToCart(tester, 'VLR-BR-001');
      await tapKey(tester, 'review-cart');
      await chooseCustomer(tester, 'Maya Farah');
      await tapKey(tester, 'take-payment');
      await type(tester, 'payment-amount', '1000');
      expect(
        find.textContaining('Partially paid — AED 2,822.00 due 16 Dec 2026'),
        findsOneWidget,
      );
      await tapText(tester, 'Bank transfer');
      await type(tester, 'payment-reference', 'FT26319XK2');
      await type(tester, 'payment-credit-days', '14');
      expect(find.textContaining('due 30 Nov 2026'), findsOneWidget);
      await tapKey(tester, 'create-invoice');
      await tapKey(tester, 'confirm-invoice');

      final sent = lastBody('/invoices');
      expect(sent['payment'], {
        'amountMinor': 100000,
        'method': 'BANK_TRANSFER',
        'reference': 'FT26319XK2',
      });
      expect(sent['creditDays'], 14);
      expect(
        find.descendant(
          of: find.byKey(const Key('invoice-status')),
          matching: find.text('Partially paid'),
        ),
        findsOneWidget,
      );
      expect(find.textContaining('Balance AED 2,822.00'), findsOneWidget);
      expect(find.byKey(const Key('record-payment')), findsOneWidget);
    });

    testWidgets('credit sale records no payment', (tester) async {
      await launch(tester);
      await sellBracelet(tester, none: true);
      final sent = lastBody('/invoices');
      expect(sent.containsKey('payment'), isFalse);
      expect(sent['creditDays'], 30);
      expect(
        find.descendant(
          of: find.byKey(const Key('invoice-status')),
          matching: find.text('Unpaid'),
        ),
        findsOneWidget,
      );
      expect(find.text('No payments recorded.'), findsOneWidget);
    });

    testWidgets('refuses an amount above the total', (tester) async {
      await launch(tester);
      await addToCart(tester, 'VLR-BR-001');
      await tapKey(tester, 'review-cart');
      await chooseCustomer(tester, 'Maya Farah');
      await tapKey(tester, 'take-payment');
      await type(tester, 'payment-amount', '4000');
      await tapKey(tester, 'create-invoice');
      expect(
        find.text('Cannot be more than the total of AED 3,822.00.'),
        findsOneWidget,
      );
      expect(find.byKey(const Key('confirm-invoice')), findsNothing);
    });

    testWidgets(
      'when stock was taken meanwhile, nothing is saved and the cart shows what to fix',
      (tester) async {
        await launch(tester);
        await addToCart(tester, 'VLR-DB-008', quantity: 3);
        await tapKey(tester, 'review-cart');
        await chooseCustomer(tester, 'Maya Farah');
        await tapKey(tester, 'take-payment');
        server.product('VLR-DB-008')['quantity'] =
            1; // another device sold three
        await tapKey(tester, 'create-invoice');
        await tapKey(tester, 'confirm-invoice');

        expect(
          find.textContaining(
            'Only 1 in stock. Review the cart — nothing was saved.',
          ),
          findsOneWidget,
        );
        expect(
          find.byKey(const Key('take-payment')),
          findsOneWidget,
          reason: 'back on the cart',
        );
        expect(find.text('Only 1 in stock.'), findsOneWidget);
        expect(server.invoices, isEmpty);
        expect(
          find.text('3 × AED 7,936.00'),
          findsOneWidget,
          reason: 'the cart is kept as entered',
        );
      },
    );

    testWidgets(
      'a retry after a lost connection reuses the key and creates one invoice',
      (tester) async {
        await launch(tester);
        await addToCart(tester, 'VLR-BR-001');
        await tapKey(tester, 'review-cart');
        await chooseCustomer(tester, 'Maya Farah');
        await tapKey(tester, 'take-payment');
        server.failNextPost = true;
        await tapKey(tester, 'create-invoice');
        await tapKey(tester, 'confirm-invoice');
        expect(
          find.textContaining('No connection. An invoice takes stock'),
          findsOneWidget,
        );
        await tapKey(tester, 'create-invoice');
        await tapKey(tester, 'confirm-invoice');
        final keys = app.adapter.requests
            .where((r) => r.method == 'POST' && r.path == '/invoices')
            .map((r) => r.headers['Idempotency-Key'])
            .toList();
        expect(keys, hasLength(2));
        expect(keys[0], keys[1]);
        expect(server.invoices, hasLength(1));
        expect(find.text('INV-2026-00001'), findsOneWidget);
      },
    );
  });

  group('manager pricing', () {
    testWidgets(
      'sees cost and profit, and can sell below the lowest price with a reason',
      (tester) async {
        await launch(tester, role: 'MANAGER');
        await tapKey(tester, 'sell-VLR-BR-001');
        expect(find.text('AED 2,800.00'), findsOneWidget); // cost
        expect(
          find.text('AED 840.00 · 30%'),
          findsOneWidget,
        ); // profit at list price

        await type(tester, 'price-field', '3000');
        expect(find.text('AED 200.00 · 7.14%'), findsOneWidget);
        await tapKey(tester, 'price-submit');
        expect(
          find.text('Lowest allowed price is AED 3,220.00.'),
          findsOneWidget,
        );

        await tapKey(tester, 'below-switch');
        await tapKey(tester, 'price-submit');
        expect(
          find.text('Say why this is sold below the lowest price.'),
          findsOneWidget,
        );
        await type(tester, 'below-reason', 'Display piece, small scratch');
        await tapKey(tester, 'price-submit');

        await tapKey(tester, 'review-cart');
        expect(find.text('Markup 7.14%'), findsOneWidget);
        await chooseCustomer(tester, 'Maya Farah');
        await tapKey(tester, 'take-payment');
        await tapKey(tester, 'create-invoice');
        await tapKey(tester, 'confirm-invoice');
        expect(
          (lastBody('/invoices')['lines'] as List).single,
          containsPair('belowMinimumReason', 'Display piece, small scratch'),
        );
        // The manager's invoice shows profit.
        await tester.scrollUntilVisible(
          find.text('Profit'),
          300,
          scrollable: find.byType(Scrollable).last,
        );
        expect(find.text('Managers only'), findsOneWidget);
        expect(find.text('AED 200.00 · 6.66%'), findsOneWidget);
      },
    );
  });

  group('quotations', () {
    testWidgets(
      'saves a quotation without touching stock, then converts it to an invoice',
      (tester) async {
        await launch(tester);
        await addToCart(tester, 'VLR-RC-021', price: '2989');
        await tapKey(tester, 'review-cart');
        await chooseCustomer(tester, 'Noura Al Mansoori');
        await type(tester, 'cart-discount', '150');
        await tapKey(tester, 'save-quotation');

        expect(find.text('QT-2026-00001'), findsOneWidget);
        expect(
          tester.widget<Text>(find.byKey(const Key('quotation-total'))).data,
          'AED 2,980.95',
        );
        expect(
          find.descendant(
            of: find.byKey(const Key('quotation-status')),
            matching: find.text('Open'),
          ),
          findsOneWidget,
        );
        expect(find.textContaining('holds prices, not stock'), findsOneWidget);
        expect(server.product('VLR-RC-021')['quantity'], 17);
        expect(savedCarts(), isEmpty, reason: 'the cart was cleared');

        await tapKey(tester, 'convert-quotation');
        expect(find.textContaining('Converting QT-2026-00001'), findsOneWidget);
        expect(find.text('Noura Al Mansoori'), findsOneWidget);
        expect(
          tester.widget<Text>(find.byKey(const Key('cart-total'))).data,
          'AED 2,980.95',
        );
        await tapKey(tester, 'take-payment');
        await tapKey(tester, 'create-invoice');
        await tapKey(tester, 'confirm-invoice');

        expect(lastBody('/invoices')['quotationId'], 'q1');
        expect(find.text('INV-2026-00001'), findsOneWidget);
        await tester.scrollUntilVisible(
          find.text('From quotation'),
          300,
          scrollable: find.byType(Scrollable).last,
        );
        expect(find.text('QT-2026-00001'), findsOneWidget);
        expect(server.quotations.single['status'], 'CONVERTED');
        expect(server.product('VLR-RC-021')['quantity'], 16);
      },
    );

    testWidgets(
      'asks before replacing a cart in progress, and can be cancelled',
      (tester) async {
        await launch(tester);
        await addToCart(tester, 'VLR-RC-021');
        await tapKey(tester, 'review-cart');
        await chooseCustomer(tester, 'Maya Farah');
        await tapKey(tester, 'save-quotation');
        // Start another sale, then go back to the quotation.
        await tester.tap(
          find.descendant(
            of: find.byType(NavigationBar),
            matching: find.text('Sell'),
          ),
        );
        await tester.pumpAndSettle();
        await addToCart(tester, 'VLR-BR-001');
        await tester.tap(
          find.descendant(
            of: find.byType(NavigationBar),
            matching: find.text('Documents'),
          ),
        );
        await tester.pumpAndSettle();
        await tapKey(tester, 'convert-quotation');
        expect(find.text('Replace the current cart?'), findsOneWidget);
        await tapText(tester, 'Keep cart');
        expect(find.byKey(const Key('convert-quotation')), findsOneWidget);

        await tapKey(tester, 'quotation-menu');
        await tapText(tester, 'Cancel quotation');
        await tapKey(tester, 'confirm-cancel-quotation');
        expect(find.text('Quotation cancelled.'), findsOneWidget);
        expect(
          find.descendant(
            of: find.byKey(const Key('quotation-status')),
            matching: find.text('Cancelled'),
          ),
          findsOneWidget,
        );
        expect(find.byKey(const Key('convert-quotation')), findsNothing);
      },
    );
  });

  group('documents', () {
    /// Three documents: a credit invoice, a paid invoice and an open quotation.
    Future<void> seedDocuments(
      WidgetTester tester, {
      String role = 'SALES',
    }) async {
      await launch(tester, role: role);
      await sellBracelet(tester, none: true);
      await tester.tap(
        find.descendant(
          of: find.byType(NavigationBar),
          matching: find.text('Sell'),
        ),
      );
      await tester.pumpAndSettle();
      await sellBracelet(tester);
      await tester.tap(
        find.descendant(
          of: find.byType(NavigationBar),
          matching: find.text('Sell'),
        ),
      );
      await tester.pumpAndSettle();
      await addToCart(tester, 'VLR-RC-021');
      await tapKey(tester, 'review-cart');
      await chooseCustomer(tester, 'Arjun Mehta');
      await tapKey(tester, 'save-quotation');
      await tester.pageBack();
      await tester.pumpAndSettle();
    }

    testWidgets(
      'lists invoices and quotations with status, customer and what is owed',
      (tester) async {
        await seedDocuments(tester);
        expect(find.text('Documents'), findsWidgets);
        expect(find.text('QT-2026-00001'), findsOneWidget);
        expect(find.text('Quotation'), findsOneWidget);
        expect(find.text('Valid until 30 Nov 2026'), findsOneWidget);
        expect(find.text('ABC Trading'), findsOneWidget);
        expect(find.text('INV-2026-00001'), findsOneWidget);
        expect(find.text('Unpaid'), findsWidgets);
        expect(
          find.text('Balance AED 3,822.00 · due 16 Dec 2026'),
          findsOneWidget,
        );
        expect(find.text('Paid'), findsWidgets);
        expect(find.text('Maison Luxe'), findsNWidgets(2));
      },
    );

    testWidgets('filters by status and searches', (tester) async {
      await seedDocuments(tester);
      await tapKey(tester, 'doc-filter-unpaid');
      expect(
        app.adapter.requests.last.queryParameters,
        containsPair('status', 'unpaid,partial'),
      );
      expect(find.text('INV-2026-00001'), findsOneWidget);
      expect(find.text('INV-2026-00002'), findsNothing);
      expect(find.text('QT-2026-00001'), findsNothing);

      await tapKey(tester, 'doc-filter-quotations');
      expect(
        app.adapter.requests.last.queryParameters,
        containsPair('type', 'quotation'),
      );
      expect(find.text('QT-2026-00001'), findsOneWidget);
      expect(find.text('INV-2026-00001'), findsNothing);

      await tapKey(tester, 'doc-filter-all');
      await tester.enterText(
        find.byKey(const Key('document-search')),
        'abc trading',
      );
      await tester.pumpAndSettle(const Duration(milliseconds: 400));
      expect(find.text('QT-2026-00001'), findsOneWidget);
      expect(find.text('INV-2026-00001'), findsNothing);
      await tester.enterText(
        find.byKey(const Key('document-search')),
        'nothing here',
      );
      await tester.pumpAndSettle(const Duration(milliseconds: 400));
      expect(find.text('No documents match'), findsOneWidget);
    });

    testWidgets('records a later payment, capped at the balance', (
      tester,
    ) async {
      await seedDocuments(tester);
      await tapKey(tester, 'doc-INV-2026-00001');
      await tapKey(tester, 'record-payment');
      expect(
        tester.widget<TextFormField>(field('pay-amount')).controller!.text,
        '3822.00',
      );
      expect(find.text('The invoice will be marked Paid.'), findsOneWidget);

      await type(tester, 'pay-amount', '5000');
      await tapKey(tester, 'pay-submit');
      expect(
        find.text('Cannot be more than the balance of AED 3,822.00.'),
        findsOneWidget,
      );

      await type(tester, 'pay-amount', '1000');
      expect(find.text('AED 2,822.00 will remain due.'), findsOneWidget);
      await tapKey(tester, 'pay-submit');
      expect(lastBody('/invoices/i1/payments'), {
        'amountMinor': 100000,
        'method': 'CASH',
        'reference': null,
      });
      expect(find.text('Payment recorded.'), findsOneWidget);
      expect(
        find.descendant(
          of: find.byKey(const Key('invoice-status')),
          matching: find.text('Partially paid'),
        ),
        findsOneWidget,
      );
      expect(find.textContaining('Balance AED 2,822.00'), findsOneWidget);

      await tapKey(tester, 'record-payment');
      await tapKey(tester, 'pay-submit');
      expect(find.text('Payment recorded. Invoice is paid.'), findsOneWidget);
      expect(find.byKey(const Key('record-payment')), findsNothing);
      expect(server.invoices.first['paidMinor'], 382200);
    });

    testWidgets(
      'shares the PDF and opens WhatsApp with the customer\'s number',
      (tester) async {
        await seedDocuments(tester);
        await tapKey(tester, 'doc-INV-2026-00002');
        await tapKey(tester, 'share-document');
        expect(server.pdfRequests, 1);
        expect(shared.single.filename, 'INV-2026-00002.pdf');
        expect(String.fromCharCodes(shared.single.pdf.take(5)), '%PDF-');
        expect(
          shared.single.text,
          'Hello Maya Farah, your invoice INV-2026-00002 is ready. Total: AED 3,822.00. Thank you.',
        );

        await tapKey(tester, 'invoice-menu');
        await tapText(tester, 'Message on WhatsApp');
        expect(opened.single.host, 'wa.me');
        expect(opened.single.path, '/971558204412');
        expect(
          opened.single.queryParameters['text'],
          contains('INV-2026-00002'),
        );
      },
    );

    testWidgets('sales staff cannot cancel or return', (tester) async {
      await seedDocuments(tester);
      await tapKey(tester, 'doc-INV-2026-00002');
      await tapKey(tester, 'invoice-menu');
      expect(find.text('Message on WhatsApp'), findsOneWidget);
      expect(find.text('Return items'), findsNothing);
      expect(find.text('Cancel invoice'), findsNothing);
    });

    testWidgets(
      'a manager cancels a paid invoice: refund chosen, stock restored',
      (tester) async {
        await seedDocuments(tester, role: 'MANAGER');
        expect(server.product('VLR-BR-001')['quantity'], 22);
        await tapKey(tester, 'doc-INV-2026-00002');
        await tapKey(tester, 'invoice-menu');
        await tapText(tester, 'Cancel invoice');
        expect(
          find.textContaining('Stock is restored for 1 item.'),
          findsOneWidget,
        );
        expect(
          find.textContaining('AED 3,822.00 received is recorded as refunded.'),
          findsOneWidget,
        );

        await tapKey(tester, 'confirm-cancel-invoice');
        expect(find.text('Say why the invoice is cancelled.'), findsOneWidget);
        await type(tester, 'cancel-reason', 'Customer changed mind');
        await tapText(tester, 'Bank transfer');
        await tapKey(tester, 'confirm-cancel-invoice');

        expect(lastBody('/invoices/i2/cancel'), {
          'reason': 'Customer changed mind',
          'refundMethod': 'BANK_TRANSFER',
        });
        expect(
          find.text('Invoice cancelled. Stock was restored.'),
          findsOneWidget,
        );
        expect(
          find.descendant(
            of: find.byKey(const Key('invoice-status')),
            matching: find.text('Cancelled'),
          ),
          findsOneWidget,
        );
        expect(find.text('Cancelled: Customer changed mind'), findsOneWidget);
        expect(find.byKey(const Key('record-payment')), findsNothing);
        expect(server.product('VLR-BR-001')['quantity'], 23);
      },
    );

    testWidgets(
      'a manager returns items: the credit comes off the balance first, then a refund is asked for',
      (tester) async {
        await launch(tester, role: 'MANAGER');
        await addToCart(tester, 'VLR-BR-001', quantity: 2);
        await tapKey(tester, 'review-cart');
        await chooseCustomer(tester, 'Maya Farah');
        await tapKey(tester, 'take-payment'); // total 7,644.00
        await type(tester, 'payment-amount', '7000'); // balance 644.00
        await tapKey(tester, 'create-invoice');
        await tapKey(tester, 'confirm-invoice');

        await tapKey(tester, 'invoice-menu');
        await tapText(tester, 'Return items');
        expect(
          find.text('2 of 2 can be returned · AED 3,640.00 each'),
          findsOneWidget,
        );
        await tapKey(tester, 'submit-return');
        expect(
          find.text('Choose at least one item to return.'),
          findsOneWidget,
        );
        expect(find.text('Say why the items are returned.'), findsOneWidget);

        await tester.tap(
          find.descendant(
            of: find.byKey(const Key('return-line-1')),
            matching: find.byKey(const Key('qty-plus')),
          ),
        );
        await tester.pumpAndSettle();
        await tapKey(tester, 'restock-1'); // damaged: not back to stock
        await type(tester, 'return-reason', 'Clasp broken');
        await tapKey(tester, 'submit-return');
        // Credit 3,822.00 against a balance of 644.00 → 3,178.00 to refund.
        expect(
          find.text(
            'Refund AED 3,178.00 to the customer. Choose how it is paid back.',
          ),
          findsOneWidget,
        );
        expect(
          server.invoices.single['returns'],
          isEmpty,
          reason: 'nothing saved until the refund method is chosen',
        );

        await tapKey(tester, 'submit-return');
        final sent = lastBody('/invoices/i1/returns');
        expect(sent['lines'], [
          {'lineNo': 1, 'quantity': 1, 'restock': false},
        ]);
        expect(sent['refund'], {'method': 'CASH'});
        expect(
          find.textContaining(
            'CN-2026-00001 created. Refund AED 3,178.00 to the customer.',
          ),
          findsOneWidget,
        );
        expect(
          server.product('VLR-BR-001')['quantity'],
          22,
          reason: 'damaged item not restocked',
        );
        await tester.scrollUntilVisible(
          find.text('Returns'),
          300,
          scrollable: find.byType(Scrollable).last,
        );
        expect(
          find.textContaining('CN-2026-00001 · 1 item · Clasp broken'),
          findsOneWidget,
        );
        expect(find.text('1 returned'), findsOneWidget);
      },
    );
  });

  testWidgets('sale screens meet tap-target and labelling guidelines', (
    tester,
  ) async {
    final handle = tester.ensureSemantics();
    await launch(tester);
    await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
    await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
    await tapKey(tester, 'sell-VLR-BR-001');
    await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
    await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
    await tapKey(tester, 'price-submit');
    await tapKey(tester, 'review-cart');
    await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
    await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
    await chooseCustomer(tester, 'Maya Farah');
    await tapKey(tester, 'take-payment');
    await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
    await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
    handle.dispose();
  });
}
