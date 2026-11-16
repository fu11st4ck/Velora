import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:velora/app/theme/app_theme.dart';
import 'package:velora/core/api/api_client.dart';
import 'package:velora/app/config/app_config.dart';
import 'package:velora/core/auth/token_store.dart';
import 'package:velora/core/platform/link_opener.dart';
import 'package:velora/features/customers/data/customer.dart';
import 'package:velora/features/customers/presentation/customer_picker.dart';

import '../support/fake_customer_server.dart';
import '../support/fakes.dart';
import '../support/harness.dart';

void main() {
  const stored = StoredTokens(
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
  );
  late FakeCustomerServer server;
  late AppHarness app;
  final opened = <Uri>[];

  Future<void> open(WidgetTester tester, {String role = 'SALES'}) async {
    setScreenSize(tester, const Size(390, 844));
    server.role = role;
    opened.clear();
    app = AppHarness(
      server: customerHandler(server),
      tokens: stored,
      overrides: [
        linkOpenerProvider.overrideWithValue((uri) async {
          opened.add(uri);
          return true;
        }),
      ],
    );
    await tester.pumpWidget(app.build());
    await tester.pumpAndSettle();
    await tester.tap(find.text('More'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('open-customers')));
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

  Future<void> tapKey(WidgetTester tester, String key) async {
    await tester.ensureVisible(find.byKey(Key(key)));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(Key(key)));
    await tester.pumpAndSettle();
  }

  Future<void> search(WidgetTester tester, String text) async {
    await tester.enterText(find.byKey(const Key('customer-search')), text);
    await tester.pumpAndSettle(const Duration(milliseconds: 400));
  }

  List<Map<String, dynamic>?> bodies(String method, String path) => [
    for (final r in app.adapter.requests)
      if (r.method == method && r.path == path) r.data as Map<String, dynamic>?,
  ];

  setUp(() => server = FakeCustomerServer()..seedReference());

  group('customer directory', () {
    testWidgets('lists customers with company and mobile', (tester) async {
      await open(tester);
      expect(find.text('Arjun Mehta'), findsOneWidget);
      expect(find.text('ABC Trading · +971505550184'), findsOneWidget);
      expect(find.text('Noura Al Mansoori'), findsOneWidget);
      expect(find.text('+971562907218'), findsOneWidget);
    });

    testWidgets('searches by name and by phone digits', (tester) async {
      await open(tester);
      await search(tester, 'maison');
      expect(find.text('Maya Farah'), findsOneWidget);
      expect(find.text('Arjun Mehta'), findsNothing);
      await search(tester, '050 555');
      expect(find.text('Arjun Mehta'), findsOneWidget);
      expect(find.text('Maya Farah'), findsNothing);
    });

    testWidgets('offers to add the searched name when nothing matches', (
      tester,
    ) async {
      await open(tester);
      await search(tester, 'Layla Haddad');
      expect(find.text('No customer matches "Layla Haddad"'), findsOneWidget);
      await tester.tap(find.text('Add as new customer'));
      await tester.pumpAndSettle();
      expect(
        tester.widget<TextFormField>(field('field-name')).controller!.text,
        'Layla Haddad',
      );
    });

    testWidgets(
      'pre-fills the mobile field when the search was a phone number',
      (tester) async {
        await open(tester);
        await search(tester, '0509998877');
        await tester.tap(find.text('Add as new customer'));
        await tester.pumpAndSettle();
        expect(
          tester.widget<TextFormField>(field('field-mobile')).controller!.text,
          '0509998877',
        );
        expect(
          tester.widget<TextFormField>(field('field-name')).controller!.text,
          '',
        );
      },
    );

    testWidgets('invites adding the first customer', (tester) async {
      server.customers.clear();
      await open(tester);
      expect(find.text('No customers yet'), findsOneWidget);
      await tester.tap(find.text('Add customer'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('save-customer')), findsOneWidget);
    });

    testWidgets('loads further pages while scrolling', (tester) async {
      server.customers.clear();
      for (var i = 1; i <= 60; i++) {
        server.seed(name: 'Customer ${i.toString().padLeft(3, '0')}');
      }
      await open(tester);
      await tester.scrollUntilVisible(
        find.text('Customer 060'),
        600,
        scrollable: find.byType(Scrollable).last,
        maxScrolls: 80,
      );
      await tester.pumpAndSettle();
      final cursors = app.adapter.requests
          .where((r) => r.path == '/customers')
          .map((r) => r.queryParameters['cursor'])
          .toList();
      expect(cursors, [null, '25', '50']);
    });
  });

  group('new customer', () {
    testWidgets('requires a name or a company and checks the formats', (
      tester,
    ) async {
      await open(tester);
      await tapKey(tester, 'new-customer');
      await type(tester, 'field-mobile', 'abc');
      await type(tester, 'field-email', 'not-an-email');
      await tapKey(tester, 'save-customer');
      expect(find.text('Enter a name or a company.'), findsOneWidget);
      expect(find.text('Enter a valid phone number.'), findsOneWidget);
      expect(find.text('Enter a valid email address.'), findsOneWidget);
      expect(bodies('POST', '/customers'), isEmpty);
    });

    testWidgets('saves a company-only customer and returns to the list', (
      tester,
    ) async {
      await open(tester);
      await tapKey(tester, 'new-customer');
      await type(tester, 'field-company', 'Zenith Gems LLC');
      await type(tester, 'field-trn', '100123456700003');
      await tapKey(tester, 'save-customer');
      expect(bodies('POST', '/customers').single, {
        'name': null,
        'company': 'Zenith Gems LLC',
        'mobile': null,
        'email': null,
        'address': null,
        'taxRegistrationNumber': '100123456700003',
        'notes': null,
      });
      expect(find.text('Zenith Gems LLC added'), findsOneWidget);
      expect(find.text('Zenith Gems LLC'), findsOneWidget);
      expect(find.byKey(const Key('save-customer')), findsNothing);
    });

    testWidgets('shows the server\'s phone rejection on the mobile field', (
      tester,
    ) async {
      await open(tester);
      await tapKey(tester, 'new-customer');
      await type(tester, 'field-name', 'Layla Haddad');
      await type(
        tester,
        'field-mobile',
        '123456',
      ); // passes the light local check, not a real number
      await tapKey(tester, 'save-customer');
      expect(
        find.textContaining(
          'Enter a valid phone number. Include the country code',
        ),
        findsOneWidget,
      );
      expect(server.customers, hasLength(3));
    });

    testWidgets(
      'warns when the number is already saved and can open the existing customer instead',
      (tester) async {
        await open(tester);
        await tapKey(tester, 'new-customer');
        await type(tester, 'field-name', 'Maya F.');
        await type(tester, 'field-mobile', '055 820 4412');
        await tapKey(tester, 'save-customer');
        expect(find.text('This number is already saved'), findsOneWidget);
        expect(find.textContaining('Maya Farah'), findsOneWidget);
        await tester.tap(find.byKey(const Key('use-existing')));
        await tester.pumpAndSettle();
        expect(bodies('POST', '/customers'), isEmpty);
        expect(server.customers, hasLength(3));
      },
    );

    testWidgets('can still create a second customer with a shared number', (
      tester,
    ) async {
      await open(tester);
      await tapKey(tester, 'new-customer');
      await type(tester, 'field-name', 'Omar Farah');
      await type(tester, 'field-mobile', '055 820 4412');
      await tapKey(tester, 'save-customer');
      await tester.tap(find.text('Create new anyway'));
      await tester.pumpAndSettle();
      expect(server.customers, hasLength(4));
      expect(find.text('Omar Farah added'), findsOneWidget);
    });

    testWidgets(
      'a retry after a lost connection reuses the key and creates one customer',
      (tester) async {
        var failOnce = true;
        setScreenSize(tester, const Size(390, 844));
        app = AppHarness(
          server: (r, b) {
            if (r.path == '/auth/me') return ok(meJson(role: 'SALES'));
            if (r.method == 'POST' && failOnce) {
              failOnce = false;
              offline(r);
            }
            return server.handle(r, b)!;
          },
          tokens: stored,
        );
        await tester.pumpWidget(app.build());
        await tester.pumpAndSettle();
        await tester.tap(find.text('More'));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('open-customers')));
        await tester.pumpAndSettle();
        await tapKey(tester, 'new-customer');
        await type(tester, 'field-name', 'Layla Haddad');
        await tapKey(tester, 'save-customer');
        expect(
          find.text('No connection. Check your internet and try again.'),
          findsOneWidget,
        );
        await tapKey(tester, 'save-customer');
        final keys = app.adapter.requests
            .where((r) => r.method == 'POST')
            .map((r) => r.headers['Idempotency-Key'])
            .toList();
        expect(keys, hasLength(2));
        expect(keys[0], keys[1]);
        expect(
          server.customers.where((c) => c['name'] == 'Layla Haddad'),
          hasLength(1),
        );
      },
    );
  });

  group('customer detail', () {
    testWidgets('shows details and account totals, with overdue highlighted', (
      tester,
    ) async {
      final maya = server.byName('Maya Farah');
      server.summaries[maya['id'] as String] = {
        'invoicedMinor': 1663400,
        'outstandingMinor': 1131200,
        'overdueMinor': 350000,
        'invoiceCount': 3,
        'lastInvoiceAt': '2026-11-10T08:00:00.000Z',
      };
      await open(tester, role: 'MANAGER');
      await tapKey(tester, 'customer-${maya['id']}');
      expect(find.text('Account'), findsOneWidget);
      expect(find.text('AED 11,312.00'), findsOneWidget);
      expect(find.text('AED 3,500.00 overdue'), findsOneWidget);
      expect(find.text('AED 16,634.00'), findsOneWidget);
      expect(find.text('3 · last 10 Nov 2026'), findsOneWidget);
      expect(find.text('maya@maisonluxe.example'), findsOneWidget);
    });

    testWidgets('tells sales staff the totals cover only their own sales', (
      tester,
    ) async {
      await open(tester);
      await tapKey(tester, 'customer-${server.byName('Maya Farah')['id']}');
      expect(find.text('Your sales to this customer'), findsOneWidget);
      expect(find.text('Account'), findsNothing);
      expect(find.text('AED 0.00'), findsNWidgets(2));
      expect(find.textContaining('overdue'), findsNothing);
    });

    testWidgets('opens the dialler, WhatsApp and email with the right links', (
      tester,
    ) async {
      await open(tester);
      await tapKey(tester, 'customer-${server.byName('Maya Farah')['id']}');
      await tapKey(tester, 'call-customer');
      await tapKey(tester, 'whatsapp-customer');
      await tapKey(tester, 'email-customer');
      expect(opened.map((u) => u.toString()), [
        'tel:+971558204412',
        'https://wa.me/971558204412',
        'mailto:maya@maisonluxe.example',
      ]);
    });

    testWidgets('hides contact actions that have nothing to open', (
      tester,
    ) async {
      server.seed(company: 'No Contact LLC');
      await open(tester);
      await tapKey(tester, 'customer-${server.byName('No Contact LLC')['id']}');
      expect(find.byKey(const Key('call-customer')), findsNothing);
      expect(find.byKey(const Key('email-customer')), findsNothing);
    });

    testWidgets('edits a customer, clearing a field that was emptied', (
      tester,
    ) async {
      await open(tester);
      final id = server.byName('Maya Farah')['id'] as String;
      await tapKey(tester, 'customer-$id');
      await tapKey(tester, 'customer-menu');
      await tester.tap(find.text('Edit customer'));
      await tester.pumpAndSettle();
      expect(
        tester.widget<TextFormField>(field('field-name')).controller!.text,
        'Maya Farah',
      );
      await type(tester, 'field-email', '');
      await type(tester, 'field-address', 'Abu Dhabi');
      await tapKey(tester, 'save-customer');
      final sent = bodies('PATCH', '/customers/$id').single!;
      expect(sent['email'], isNull);
      expect(sent['address'], 'Abu Dhabi');
      expect(find.text('Maya Farah updated'), findsOneWidget);
      expect(find.text('Abu Dhabi'), findsOneWidget);
      expect(find.byKey(const Key('email-customer')), findsNothing);
    });

    testWidgets('sales staff can edit but not archive', (tester) async {
      await open(tester);
      await tapKey(tester, 'customer-${server.byName('Arjun Mehta')['id']}');
      await tapKey(tester, 'customer-menu');
      expect(find.text('Edit customer'), findsOneWidget);
      expect(find.text('Archive customer'), findsNothing);
    });

    testWidgets('a manager archives a customer, who then leaves the list', (
      tester,
    ) async {
      await open(tester, role: 'MANAGER');
      await tapKey(tester, 'customer-${server.byName('Arjun Mehta')['id']}');
      await tapKey(tester, 'customer-menu');
      await tester.tap(find.text('Archive customer'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(server.byName('Arjun Mehta')['archivedAt'], isNull);

      await tapKey(tester, 'customer-menu');
      await tester.tap(find.text('Archive customer'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('confirm-archive')));
      await tester.pumpAndSettle();
      expect(server.byName('Arjun Mehta')['archivedAt'], isNotNull);
      expect(find.text('Arjun Mehta archived'), findsOneWidget);
      expect(find.text('ABC Trading · +971505550184'), findsNothing);
    });
  });

  group('customer picker', () {
    /// A minimal page with a button that opens the picker and shows what it returned.
    Future<void> openPicker(WidgetTester tester) async {
      setScreenSize(tester, const Size(390, 844));
      final adapter = FakeAdapter(customerHandler(server));
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            appConfigProvider.overrideWithValue(
              const AppConfig(
                flavor: Flavor.prod,
                apiBaseUrl: 'http://api.test',
              ),
            ),
            tokenStoreProvider.overrideWithValue(InMemoryTokenStore(stored)),
            httpClientAdapterProvider.overrideWithValue(adapter),
          ],
          child: MaterialApp(
            theme: AppTheme.light(),
            home: const _PickerHost(),
          ),
        ),
      );
      await tester.tap(find.text('Pick'));
      await tester.pumpAndSettle();
    }

    testWidgets('returns the customer that was tapped', (tester) async {
      await openPicker(tester);
      expect(find.text('Choose customer'), findsOneWidget);
      await search(tester, 'noura');
      await tester.tap(find.text('Noura Al Mansoori'));
      await tester.pumpAndSettle();
      expect(find.text('picked: Noura Al Mansoori'), findsOneWidget);
    });

    testWidgets('creates a customer on the spot and returns it', (
      tester,
    ) async {
      await openPicker(tester);
      await search(tester, 'Layla Haddad');
      await tester.tap(find.text('Add as new customer'));
      await tester.pumpAndSettle();
      await type(tester, 'field-mobile', '050 999 8877');
      await tapKey(tester, 'save-customer');
      expect(find.text('picked: Layla Haddad'), findsOneWidget);
      expect(server.byName('Layla Haddad')['mobile'], '+971509998877');
    });

    testWidgets(
      'returns the existing customer when the typed number is already saved',
      (tester) async {
        await openPicker(tester);
        await tapKey(tester, 'picker-new-customer');
        await type(tester, 'field-name', 'Someone');
        await type(tester, 'field-mobile', '055 820 4412');
        await tapKey(tester, 'save-customer');
        await tester.tap(find.byKey(const Key('use-existing')));
        await tester.pumpAndSettle();
        expect(find.text('picked: Maya Farah'), findsOneWidget);
        expect(server.customers, hasLength(3));
      },
    );

    testWidgets('returns nothing when closed', (tester) async {
      await openPicker(tester);
      await tester.tap(find.byTooltip('Close'));
      await tester.pumpAndSettle();
      expect(find.text('picked: nobody'), findsOneWidget);
    });
  });

  testWidgets('customer screens meet tap-target and labelling guidelines', (
    tester,
  ) async {
    final handle = tester.ensureSemantics();
    await open(tester);
    await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
    await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
    await tapKey(tester, 'customer-${server.byName('Maya Farah')['id']}');
    await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
    await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
    handle.dispose();
  });
}

class _PickerHost extends StatefulWidget {
  const _PickerHost();

  @override
  State<_PickerHost> createState() => _PickerHostState();
}

class _PickerHostState extends State<_PickerHost> {
  String _result = '';

  @override
  Widget build(BuildContext context) => Scaffold(
    body: Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(_result),
          FilledButton(
            onPressed: () async {
              final Customer? picked = await showCustomerPicker(context);
              setState(
                () => _result = 'picked: ${picked?.displayName ?? 'nobody'}',
              );
            },
            child: const Text('Pick'),
          ),
        ],
      ),
    ),
  );
}
