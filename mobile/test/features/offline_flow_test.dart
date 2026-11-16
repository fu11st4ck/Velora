import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:sqlite3/sqlite3.dart';
import 'package:velora/app/app.dart' show noAutomaticRetry;
import 'package:velora/core/auth/session.dart';
import 'package:velora/core/auth/session_controller.dart';
import 'package:velora/core/auth/token_store.dart';
import 'package:velora/core/offline/local_db.dart';
import 'package:velora/core/offline/sync_engine.dart';
import 'package:velora/core/storage/key_value_store.dart';

import '../support/fake_shop_server.dart';
import '../support/fakes.dart';
import '../support/harness.dart';

/// A shop server that can drop off the network and that serves the sync feed.
class World {
  World({String role = 'SALES'}) : shop = FakeShopServer() {
    shop.role = role;
  }

  final FakeShopServer shop;
  bool offlineNow = false;
  bool refuseQuotations = false;
  int syncCalls = 0;

  ResponseBody handle(RequestOptions r, Map<String, dynamic>? body) {
    if (offlineNow) offline(r);
    if (r.path == '/sync/changes') {
      syncCalls++;
      return json(200, {
        'data': {
          'products': {
            'upserted': shop.inventory.products
                .map(shop.inventory.view)
                .toList(),
            'archivedIds': <String>[],
          },
          'customers': {
            'upserted': shop.customers.customers,
            'archivedIds': <String>[],
          },
        },
        'meta': {
          'next': 'token-$syncCalls',
          'hasMore': false,
          'serverTime': '2026-11-16T05:30:00.000Z',
        },
      });
    }
    if (r.path == '/dashboard/summary') {
      return ok(dashboardJson(role: shop.role));
    }
    if (r.path == '/auth/change-password') {
      return body!['currentPassword'] == 'correct-horse-battery'
          ? noContent()
          : apiError(422, 'CURRENT_PASSWORD_INCORRECT');
    }
    if (r.path == '/auth/logout') return noContent();
    if (refuseQuotations && r.path == '/quotations' && r.method == 'POST') {
      return apiError(
        422,
        'PRICE_BELOW_MINIMUM',
        details: [
          {'lineNo': 1, 'floorPriceMinor': 400000},
        ],
      );
    }
    return shop.handle(r, body) ?? apiError(404, 'NOT_FOUND');
  }
}

/// Working without a connection: reading saved data, queuing what can wait, and sending it later.
/// The fixed clock is 16 Nov 2026, 09:30.
void main() {
  const stored = StoredTokens(
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
  );
  late World world;
  late AppHarness app;
  late InMemoryKeyValueStore device;
  late LocalDb db;

  Future<void> launch(
    WidgetTester tester, {
    String role = 'SALES',
    bool freshWorld = true,
  }) async {
    setScreenSize(tester, const Size(390, 844));
    if (freshWorld) world = World(role: role);
    app = AppHarness(
      server: world.handle,
      ownDashboard: true,
      tokens: stored,
      overrides: [
        keyValueStoreProvider.overrideWithValue(device),
        localDbProvider.overrideWithValue(db),
      ],
    );
    await tester.pumpWidget(app.build());
    await tester.pumpAndSettle();
  }

  Future<void> tab(WidgetTester tester, String name) async {
    await tester.tap(
      find.descendant(
        of: find.byType(NavigationBar),
        matching: find.text(name),
      ),
    );
    await tester.pumpAndSettle();
  }

  Future<void> tapKey(WidgetTester tester, String key) async {
    final target = find.byKey(Key(key));
    if (target.evaluate().isEmpty) {
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

  Future<void> tapText(WidgetTester tester, String text) async {
    await tester.tap(find.text(text).last);
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

  Future<void> openSync(WidgetTester tester) async {
    // Let earlier confirmation messages time out, as they would for a person.
    await tester.pump(const Duration(seconds: 5));
    await tester.pumpAndSettle();
    await tab(tester, 'More');
    await tapKey(tester, 'open-sync');
  }

  /// One bracelet in the cart, on the cart screen.
  Future<void> cartWithBracelet(WidgetTester tester) async {
    await tab(tester, 'Sell');
    await tapKey(tester, 'sell-VLR-BR-001');
    await tapKey(tester, 'price-submit');
    await tapKey(tester, 'review-cart');
  }

  Future<void> chooseCustomer(WidgetTester tester, String name) async {
    await tapKey(tester, 'cart-customer');
    await tapText(tester, name);
  }

  List<RequestOptions> posts(String path) => app.adapter.requests
      .where((r) => r.method == 'POST' && r.path == path)
      .toList();
  Iterable<String> cardTexts(WidgetTester tester, int i) => tester
      .widgetList<Text>(
        find.descendant(
          of: find.byKey(Key('queue-$i')),
          matching: find.byType(Text),
        ),
      )
      .map((t) => t.data!);

  setUp(() {
    device = InMemoryKeyValueStore();
    db = LocalDb(sqlite3.openInMemory());
  });
  tearDown(() => db.close());

  group('reading without a connection', () {
    testWidgets(
      'products and customers saved at sign-in stay available, searchable and filterable',
      (tester) async {
        await launch(tester);
        expect(world.syncCalls, 1, reason: 'signing in fills the copy');
        expect(find.byKey(const Key('offline-banner')), findsNothing);

        world.offlineNow = true;
        await tab(tester, 'Inventory');
        expect(
          tester.widget<Text>(find.byKey(const Key('offline-banner'))).data,
          'No connection. Showing data saved 16 Nov, 09:30.',
        );
        for (final name in [
          'Alhambra Gold Bracelet',
          'Classic Gold Bangle',
          'Diamond Tennis Bracelet',
        ]) {
          expect(find.text(name), findsOneWidget, reason: name);
        }

        await tester.enterText(
          find.byKey(const Key('inventory-search')),
          'cuff',
        );
        await tester.pumpAndSettle(const Duration(milliseconds: 400));
        expect(find.text('Rose Gold Cuff'), findsOneWidget);
        expect(find.text('Alhambra Gold Bracelet'), findsNothing);
        await tester.enterText(find.byKey(const Key('inventory-search')), '');
        await tester.pumpAndSettle(const Duration(milliseconds: 400));
        await tapKey(tester, 'filter-low');
        expect(find.text('Diamond Tennis Bracelet'), findsOneWidget);
        expect(find.text('Alhambra Gold Bracelet'), findsNothing);

        await tapKey(tester, 'product-VLR-DB-008');
        expect(find.text('Diamond Tennis Bracelet'), findsWidgets);
        expect(
          find.textContaining('Cost'),
          findsNothing,
          reason: "a salesperson's copy holds no cost",
        );

        await tab(tester, 'More');
        await tapKey(tester, 'open-customers');
        expect(find.text('Maya Farah'), findsOneWidget);
        await tester.enterText(find.byType(TextField).first, '0558204412');
        await tester.pumpAndSettle(const Duration(milliseconds: 400));
        expect(find.text('Maya Farah'), findsOneWidget);
        expect(find.text('Arjun Mehta'), findsNothing);
      },
    );

    testWidgets(
      'the app starts without a connection and returns online by itself',
      (tester) async {
        await launch(tester);
        world.offlineNow = true;
        await launch(
          tester,
          freshWorld: false,
        ); // closed and reopened with no network
        expect(
          find.textContaining('Good morning, '),
          findsOneWidget,
          reason: 'signed in from the remembered profile',
        );
        expect(
          find.text('No connection. Check your internet and try again.'),
          findsOneWidget,
        ); // dashboard needs the server
        await tab(tester, 'Sell');
        expect(find.text('Alhambra Gold Bracelet'), findsOneWidget);

        world.offlineNow = false;
        await tab(tester, 'Home');
        await tapText(tester, 'Try again');
        expect(find.byKey(const Key('kpi-today')), findsOneWidget);
        expect(find.byKey(const Key('offline-banner')), findsNothing);
      },
    );

    testWidgets(
      'without a saved copy an offline start says so instead of showing an empty shop',
      (tester) async {
        world = World()..offlineNow = true;
        await launch(tester, freshWorld: false);
        expect(find.textContaining('Good morning, '), findsNothing);
        expect(find.byType(NavigationBar), findsNothing);
        expect(find.textContaining('No connection'), findsWidgets);
      },
    );

    testWidgets('signing out removes the saved copies from the device', (
      tester,
    ) async {
      await launch(tester, role: 'MANAGER');
      expect(db.products(), hasLength(4));
      expect(db.products().first, contains('costMinor'));
      await tab(tester, 'More');
      await tapKey(tester, 'sign-out');
      await tapKey(tester, 'confirm-sign-out');
      expect(db.products(), isEmpty);
      expect(db.customers(), isEmpty);
      expect(device.values.keys, isNot(contains('velora.profile')));
    });

    test('copies made for one person or role are erased before another uses the device', () {
      db.claim('u1:manager');
      db.applyProducts([
        {
          'id': 'p1',
          'name': 'Ring',
          'sku': 'R-1',
          'barcode': null,
          'quantity': 3,
          'stockStatus': 'LOW',
          'costMinor': 100,
        },
      ], const []);
      db.write('synced_at', '2026-11-16T05:30:00.000Z');
      expect(db.claim('u1:manager'), isFalse);
      expect(db.products(), hasLength(1));
      expect(db.claim('u1:sales'), isTrue, reason: 'same person, lesser role');
      expect(db.products(), isEmpty);
      expect(db.lastSyncedAt, isNull);
    });
  });

  group('quotations without a connection', () {
    testWidgets(
      'are priced on the device, queued, and sent once the connection returns',
      (tester) async {
        await launch(tester);
        world.offlineNow = true;
        await cartWithBracelet(tester);
        expect(find.byKey(const Key('offline-estimate')), findsOneWidget);
        expect(
          tester.widget<Text>(find.byKey(const Key('cart-total'))).data,
          'AED 3,822.00',
        ); // 3,640.00 + VAT 5%
        await type(tester, 'cart-discount', '150');
        expect(
          tester.widget<Text>(find.byKey(const Key('cart-total'))).data,
          'AED 3,664.50',
        ); // (3,640 − 150) × 1.05
        await chooseCustomer(tester, 'Maya Farah');
        await tapKey(tester, 'save-quotation');

        expect(
          find.text(
            'Quotation saved on this device. It gets its number when it is sent.',
          ),
          findsOneWidget,
        );
        expect(
          find.byKey(const Key('review-cart')),
          findsNothing,
          reason: 'the cart was emptied',
        );
        expect(
          find.descendant(
            of: find.byType(NavigationBar),
            matching: find.text('1'),
          ),
          findsOneWidget,
          reason: 'badge on More',
        );
        expect(world.shop.quotations, isEmpty);

        await openSync(tester);
        expect(cardTexts(tester, 0), [
          'Quotation for Maya Farah · AED 3,664.50',
          'Made 16 Nov, 09:30',
          'Waiting to send',
          'Discard',
        ]);
        expect(
          find.textContaining('Waiting items are sent automatically'),
          findsOneWidget,
        );

        world.offlineNow = false;
        await tapKey(tester, 'sync-now');
        expect(find.text('Nothing waiting'), findsOneWidget);
        expect(
          world.shop.quotations.single,
          containsPair('totalMinor', 366450),
        );
        final keys = posts('/quotations')
            .map((r) => r.headers['Idempotency-Key'])
            .toSet();
        expect(
          keys,
          hasLength(1),
          reason: 'every attempt carries the same key',
        );
        expect(
          find.descendant(
            of: find.byType(NavigationBar),
            matching: find.text('1'),
          ),
          findsNothing,
        );
      },
    );

    testWidgets(
      'the same limits apply offline: price bounds and stock from the saved copy',
      (tester) async {
        await launch(tester);
        world.offlineNow = true;
        await tab(tester, 'Sell');
        await tapKey(tester, 'sell-VLR-DB-008'); // 4 in stock
        for (var i = 0; i < 3; i++) {
          await tapKey(tester, 'qty-plus');
        }
        await tapKey(tester, 'price-submit');
        await tapKey(tester, 'review-cart');
        // Meanwhile the copy learns that only two are left (as a later sync would tell it).
        final tennis = Map<String, dynamic>.of(
          db.products(q: 'VLR-DB-008').single,
        )..['quantity'] = 2;
        db.applyProducts([tennis], const []);
        await type(tester, 'cart-discount', '1');
        expect(find.text('Only 2 in stock.'), findsOneWidget);
        await chooseCustomer(tester, 'Maya Farah');
        await tapKey(tester, 'save-quotation');
        expect(find.text('Fix the highlighted items first.'), findsOneWidget);
        expect(db.outbox('u1'), isEmpty);
      },
    );

    testWidgets(
      'a customer created offline is sent first, then the quotation that names them',
      (tester) async {
        await launch(tester);
        world.offlineNow = true;
        await cartWithBracelet(tester);
        await tapKey(tester, 'cart-customer');
        await tapKey(tester, 'picker-new-customer');
        await type(tester, 'field-name', 'Layla Haddad');
        await type(tester, 'field-mobile', '0501234567');
        await tapKey(tester, 'save-customer');
        // The confirmation message sits over the action bar for a few seconds.
        await tester.pump(const Duration(seconds: 5));
        await tester.pumpAndSettle();
        expect(
          find.text('Layla Haddad'),
          findsOneWidget,
          reason: 'chosen for the cart',
        );
        await tapKey(tester, 'save-quotation');

        await openSync(tester);
        expect(cardTexts(tester, 0).first, 'New customer: Layla Haddad');
        expect(
          cardTexts(tester, 1),
          containsAll([
            'Quotation for Layla Haddad · AED 3,822.00',
            'Waiting for the item above',
          ]),
        );

        world.offlineNow = false;
        await tapKey(tester, 'sync-now');
        expect(find.text('Nothing waiting'), findsOneWidget);
        final layla = world.shop.customers.byName('Layla Haddad');
        expect(
          layla['id'],
          matches(RegExp(r'^[0-9a-f-]{36}$')),
          reason: 'the id chosen on the device is kept',
        );
        expect(
          (world.shop.quotations.single['customer'] as Map)['id'],
          layla['id'],
        );
        final order = app.adapter.requests
            .where((r) => r.method == 'POST')
            .map((r) => r.path)
            .toList();
        expect(
          order.lastIndexOf('/customers'),
          lessThan(order.lastIndexOf('/quotations')),
        );
        expect(db.isPendingCustomer(layla['id'] as String), isFalse);
      },
    );

    testWidgets(
      'a refusal is never dropped: it waits with the reason until retried or discarded',
      (tester) async {
        await launch(tester);
        world.offlineNow = true;
        await cartWithBracelet(tester);
        await chooseCustomer(tester, 'Maya Farah');
        await tapKey(tester, 'save-quotation');
        world
          ..offlineNow = false
          ..refuseQuotations = true;
        await openSync(tester);
        await tapKey(tester, 'sync-now');

        expect(
          cardTexts(tester, 0),
          containsAll([
            'Needs attention',
            'A price is below the lowest allowed price.',
          ]),
        );
        await tester.pageBack();
        await tester.pumpAndSettle();
        expect(find.text('1 item needs attention'), findsOneWidget);
        await tapKey(tester, 'open-sync');

        // Sending again automatically would only be refused again: it waits for a person.
        final attempts = posts('/quotations').length;
        await tapKey(tester, 'sync-now');
        expect(
          posts('/quotations'),
          hasLength(attempts),
          reason: 'no blind repeats',
        );

        world.refuseQuotations = false;
        await tapKey(tester, 'queue-retry-0');
        expect(find.text('Nothing waiting'), findsOneWidget);
        expect(world.shop.quotations, hasLength(1));
        final keys = posts('/quotations')
            .map((r) => r.headers['Idempotency-Key'])
            .toList();
        expect(
          keys.last,
          isNot(keys.first),
          reason: 'a retry after a refusal is a new request',
        );
      },
    );

    testWidgets('discarding asks first and takes dependent items with it', (
      tester,
    ) async {
      await launch(tester);
      world.offlineNow = true;
      await cartWithBracelet(tester);
      await tapKey(tester, 'cart-customer');
      await tapKey(tester, 'picker-new-customer');
      await type(tester, 'field-name', 'Layla Haddad');
      await tapKey(tester, 'save-customer');
      await tester.pump(const Duration(seconds: 5));
      await tester.pumpAndSettle();
      await tapKey(tester, 'save-quotation');
      await openSync(tester);

      await tapKey(tester, 'queue-discard-0');
      expect(
        find.textContaining('One item that depends on it is discarded too.'),
        findsOneWidget,
      );
      await tapText(tester, 'Keep');
      expect(db.outbox('u1'), hasLength(2));
      await tapKey(tester, 'queue-discard-0');
      await tapKey(tester, 'confirm-discard');
      expect(find.text('Nothing waiting'), findsOneWidget);
      expect(
        db.customers(q: 'Layla'),
        isEmpty,
        reason: 'the customer that only existed here is gone too',
      );
    });
  });

  group('what needs the server', () {
    testWidgets('an invoice is not created offline; the cart is kept', (
      tester,
    ) async {
      await launch(tester);
      world.offlineNow = true;
      await cartWithBracelet(tester);
      await chooseCustomer(tester, 'Maya Farah');
      await tapKey(tester, 'take-payment');
      await tapKey(tester, 'create-invoice');
      await tapKey(tester, 'confirm-invoice');
      expect(
        find.textContaining('An invoice takes stock, so it needs the server'),
        findsOneWidget,
      );
      expect(
        db.outbox('u1'),
        isEmpty,
        reason: 'nothing that moves stock is ever queued',
      );
      await tester.pageBack();
      await tester.pumpAndSettle();
      expect(find.text('Alhambra Gold Bracelet'), findsOneWidget);
    });

    testWidgets('a payment taken while offline is queued and applied once', (
      tester,
    ) async {
      await launch(tester);
      await cartWithBracelet(tester);
      await chooseCustomer(tester, 'Maya Farah');
      await tapKey(tester, 'take-payment');
      await tapKey(tester, 'amount-none');
      await tapKey(tester, 'create-invoice');
      await tapKey(tester, 'confirm-invoice');
      expect(find.text('INV-2026-00001'), findsOneWidget);

      world.offlineNow = true;
      await tapKey(tester, 'record-payment');
      await type(tester, 'pay-amount', '1000');
      await tapKey(tester, 'pay-submit');
      expect(
        find.textContaining('The payment is saved on this device'),
        findsOneWidget,
      );
      expect(world.shop.invoices.single['paidMinor'], 0);

      world.offlineNow = false;
      await openSync(tester);
      expect(
        cardTexts(tester, 0).first,
        'Payment of AED 1,000.00 on INV-2026-00001',
      );
      await tapKey(tester, 'sync-now');
      await tapKey(tester, 'sync-now');
      expect(world.shop.invoices.single['paidMinor'], 100000);
      expect(find.text('Nothing waiting'), findsOneWidget);
    });

    testWidgets(
      'signing out with unsent work says what happens to it, and keeps it',
      (tester) async {
        await launch(tester);
        world.offlineNow = true;
        await cartWithBracelet(tester);
        await chooseCustomer(tester, 'Maya Farah');
        await tapKey(tester, 'save-quotation');
        await tab(tester, 'More');
        await tapKey(tester, 'sign-out');
        expect(
          find.textContaining('1 change has not been sent to the server yet.'),
          findsOneWidget,
        );
        await tapKey(tester, 'confirm-sign-out');
        expect(db.outbox('u1'), hasLength(1));
        expect(db.products(), isEmpty);
      },
    );
  });

  group('queue rules', () {
    ProviderContainer container(DateTime now, Handler server) {
      final harness = AppHarness(
        server: server,
        tokens: stored,
        overrides: [localDbProvider.overrideWithValue(db)],
      )..now = now;
      final c = ProviderContainer(
        retry: noAutomaticRetry,
        overrides: harness.providerOverrides,
      );
      addTearDown(c.dispose);
      return c;
    }

    test(
      'an item that waited more than seven days is held for a person to decide',
      () async {
        final sent = <String>[];
        final c = container(DateTime(2026, 11, 16, 9, 30), (r, b) {
          if (r.path == '/auth/me') return ok(meJson(role: 'SALES'));
          if (r.method == 'POST') sent.add(r.path);
          return apiError(404, 'NOT_FOUND');
        });
        await c.read(sessionControllerProvider.notifier).restore();
        expect(c.read(currentUserProvider), isA<Me>());
        OutboxItem item(String id, DateTime made) => OutboxItem(
          id: id,
          userId: 'u1',
          type: 'payment.record',
          path: '/invoices/$id/payments',
          body: const {'amountMinor': 100, 'method': 'CASH'},
          idempotencyKey: 'key-$id',
          summary: 'Payment $id',
          createdAt: made,
          state: OutboxState.waiting,
        );
        db.enqueue(item('old', DateTime(2026, 11, 8, 9)));
        db.enqueue(item('recent', DateTime(2026, 11, 15, 9)));
        db.enqueue(
          OutboxItem(
            id: 'someone-else',
            userId: 'u2',
            type: 'payment.record',
            path: '/invoices/x/payments',
            body: const {},
            idempotencyKey: 'k',
            summary: 'Not mine',
            createdAt: DateTime(2026, 11, 15),
            state: OutboxState.waiting,
          ),
        );

        await c.read(syncProvider.notifier).syncNow();
        final mine = db.outbox('u1');
        expect(mine.map((i) => (i.id, i.state, i.errorCode)), [
          ('old', OutboxState.needsAttention, 'EXPIRED'),
          ('recent', OutboxState.needsAttention, 'NOT_FOUND'),
        ]);
        expect(
          sent,
          ['/invoices/recent/payments'],
          reason: 'the expired item and the other person\'s item were not sent',
        );
        expect(db.outboxOfOthers('u1'), 1);
        expect(c.read(syncProvider).needsAttention, 2);
      },
    );

    test(
      'searching the saved copy treats %, _ and \\ as ordinary characters',
      () {
        db.applyProducts([
          for (final (i, name) in [
            '100% Gold Ring',
            'Gold_Ring',
            r'Back\slash',
            'Plain',
          ].indexed)
            {
              'id': 'p$i',
              'name': name,
              'sku': 'S-$i',
              'barcode': i == 3 ? '629100' : null,
              'quantity': i,
              'stockStatus': i == 0 ? 'OUT' : 'IN_STOCK',
            },
        ], const []);
        List<String> names(String q) =>
            db.products(q: q).map((p) => p['name'] as String).toList();
        expect(names('%'), ['100% Gold Ring']);
        expect(names('_'), ['Gold_Ring']);
        expect(names(r'\'), [r'Back\slash']);
        expect(names('gold'), ['100% Gold Ring', 'Gold_Ring']);
        expect(names('6291'), ['Plain']);
        expect(db.productCounts(), (all: 4, inStock: 3, low: 0, out: 1));
        expect(
          db.products(sellable: true).map((p) => p['name']),
          isNot(contains('100% Gold Ring')),
        );
        db.applyProducts(const [], ['p3']);
        expect(names('plain'), isEmpty);
      },
    );
  });

  group('change password', () {
    testWidgets(
      'checks the form, reports a wrong current password, then succeeds',
      (tester) async {
        await launch(tester);
        await tab(tester, 'More');
        await tapKey(tester, 'open-password');
        await tapKey(tester, 'change-password-submit');
        expect(find.text('Enter your current password.'), findsOneWidget);
        expect(find.text('Use at least 10 characters.'), findsOneWidget);

        await type(tester, 'current-password', 'wrong-password-1');
        await type(tester, 'new-password', 'ruby-anklet-4417');
        await type(tester, 'confirm-password', 'ruby-anklet-4418');
        await tapKey(tester, 'change-password-submit');
        expect(find.text('The two passwords do not match.'), findsOneWidget);
        expect(posts('/auth/change-password'), isEmpty);

        await type(tester, 'confirm-password', 'ruby-anklet-4417');
        await tapKey(tester, 'change-password-submit');
        expect(find.text('The current password is incorrect.'), findsOneWidget);

        await type(tester, 'current-password', 'correct-horse-battery');
        await tapKey(tester, 'change-password-submit');
        expect(posts('/auth/change-password').last.data, {
          'currentPassword': 'correct-horse-battery',
          'newPassword': 'ruby-anklet-4417',
        });
        expect(
          find.text('Password changed. Your other devices were signed out.'),
          findsOneWidget,
        );
        expect(
          find.byKey(const Key('open-password')),
          findsOneWidget,
          reason: 'back on More, still signed in',
        );
      },
    );

    testWidgets(
      'a new password equal to the current one is refused before sending',
      (tester) async {
        await launch(tester);
        await tab(tester, 'More');
        await tapKey(tester, 'open-password');
        await type(tester, 'current-password', 'correct-horse-battery');
        await type(tester, 'new-password', 'correct-horse-battery');
        await type(tester, 'confirm-password', 'correct-horse-battery');
        await tapKey(tester, 'change-password-submit');
        expect(
          find.text('Choose a password different from the current one.'),
          findsOneWidget,
        );
        expect(posts('/auth/change-password'), isEmpty);
      },
    );
  });
}
