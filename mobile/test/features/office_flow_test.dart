import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:velora/core/auth/token_store.dart';
import 'package:velora/core/platform/file_sharer.dart';
import 'package:velora/core/storage/key_value_store.dart';
import 'package:velora/features/reports/presentation/report_controllers.dart';
import 'package:velora/features/settings/presentation/percent.dart';

import '../support/fake_office_server.dart';
import '../support/harness.dart';

/// Home, reports, business settings, tax rates, team, devices and appearance — the real app
/// against an in-memory server. The fixed clock is 16 Nov 2026, 09:30.
void main() {
  const stored = StoredTokens(
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
  );
  late FakeOfficeServer server;
  late AppHarness app;
  late InMemoryKeyValueStore device;
  final shared = <({Uint8List bytes, String filename, String mimeType})>[];
  var canShare = true;

  Future<void> launch(
    WidgetTester tester, {
    String role = 'OWNER',
    void Function(FakeOfficeServer)? arrange,
  }) async {
    setScreenSize(tester, const Size(390, 844));
    server = FakeOfficeServer(role: role);
    arrange?.call(server);
    app = AppHarness(
      server: officeHandler(server),
      ownDashboard: true,
      tokens: stored,
      overrides: [
        keyValueStoreProvider.overrideWithValue(device),
        fileSharerProvider.overrideWithValue(({
          required bytes,
          required filename,
          required mimeType,
        }) async {
          shared.add((bytes: bytes, filename: filename, mimeType: mimeType));
          return canShare;
        }),
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

  Future<void> openMore(WidgetTester tester, String rowKey) async {
    await tab(tester, 'More');
    await tapKey(tester, rowKey);
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

  String textOf(WidgetTester tester, String key) =>
      tester.widget<TextFormField>(field(key)).controller!.text;
  Iterable<String> tileTexts(WidgetTester tester, String key) => tester
      .widgetList<Text>(
        find.descendant(of: find.byKey(Key(key)), matching: find.byType(Text)),
      )
      .map((t) => t.data!);
  List<dynamic> sent(String method, String path) => app.adapter.requests
      .where((r) => r.method == method && r.path == path)
      .map((r) => r.data)
      .toList();
  Map<String, dynamic> lastQuery(String path) =>
      app.adapter.requests.lastWhere((r) => r.path == path).queryParameters;

  setUp(() {
    device = InMemoryKeyValueStore();
    shared.clear();
    canShare = true;
  });

  group('home', () {
    testWidgets('shows a manager the day at a glance', (tester) async {
      await launch(tester, role: 'MANAGER');
      expect(find.text('Good morning, Maya'), findsOneWidget);
      expect(tileTexts(tester, 'kpi-today'), [
        "TODAY'S SALES",
        'AED 10,694.25',
        '2 invoices',
        'Up 12.4% on yesterday',
      ]);
      expect(tileTexts(tester, 'kpi-outstanding'), [
        'OUTSTANDING',
        'AED 12,500.00',
        '3 invoices',
        'Overdue AED 3,500.00',
      ]);
      expect(tileTexts(tester, 'kpi-stock'), [
        'IN STOCK',
        '53 pcs',
        '4 products',
      ]);
      expect(tileTexts(tester, 'kpi-profit'), [
        "THIS MONTH'S PROFIT",
        'AED 18,450.00',
        'Margin 24.5%',
      ]);
      expect(
        find.text('AED 150,850.00'),
        findsOneWidget,
      ); // inventory value at cost

      await tester.scrollUntilVisible(
        find.text('QT-2026-00003'),
        200,
        scrollable: find.byType(Scrollable).first,
      );
      expect(find.text('1 product is out of stock'), findsOneWidget);
      expect(find.text('2 products are low in stock'), findsOneWidget);
      expect(find.text('1 invoice overdue · AED 3,500.00'), findsOneWidget);
      expect(find.text('INV-2026-00007'), findsOneWidget);
      expect(find.text('Balance AED 675.00 · due 16 Dec 2026'), findsOneWidget);
      expect(find.byKey(const Key('add-first-product')), findsNothing);
    });

    testWidgets(
      'shows a salesperson their own day, with profit and stock value withheld',
      (tester) async {
        await launch(tester, role: 'SALES');
        expect(tileTexts(tester, 'kpi-today'), [
          "TODAY'S SALES",
          'AED 7,350.00',
          '1 invoice',
          'Down 22.75% on yesterday',
        ]);
        expect(tileTexts(tester, 'kpi-profit'), [
          "THIS MONTH'S PROFIT",
          'Shown to managers',
        ]);
        expect(find.byKey(const Key('inventory-value')), findsNothing);
        expect(find.textContaining('Margin'), findsNothing);
      },
    );

    testWidgets('attention rows open the filtered lists', (tester) async {
      await launch(tester, role: 'MANAGER');
      await tapKey(tester, 'attention-low');
      expect(find.byKey(const Key('inventory-search')), findsOneWidget);
      expect(lastQuery('/products')['stockStatus'], 'low');

      await tab(tester, 'Home');
      await tapKey(tester, 'attention-overdue');
      expect(find.byKey(const Key('document-search')), findsOneWidget);
      expect(lastQuery('/documents'), containsPair('status', 'overdue'));
      expect(
        tester
            .widget<FilterChip>(find.byKey(const Key('doc-filter-overdue')))
            .selected,
        isTrue,
      );

      await tab(tester, 'Home');
      await tapKey(tester, 'view-all-documents');
      expect(find.byKey(const Key('document-search')), findsOneWidget);
    });

    testWidgets('opens a recent document', (tester) async {
      await launch(tester, role: 'MANAGER');
      await tapKey(tester, 'doc-QT-2026-00003');
      expect(app.adapter.requests.last.path, '/quotations/q3');
    });

    testWidgets('guides a new business to its first product', (tester) async {
      void empty(FakeOfficeServer s) => s.dashboard = {
        ...FakeOfficeServer.busyDashboard(s.role),
        'stock': {'units': 0, 'productCount': 0, 'lowCount': 0, 'outCount': 0},
        'outstanding': {
          'balanceMinor': 0,
          'invoiceCount': 0,
          'overdueMinor': 0,
          'overdueCount': 0,
        },
        'todaySales': {
          'invoicedMinor': 0,
          'invoiceCount': 0,
          'yesterdayInvoicedMinor': 0,
          'changeBp': null,
        },
        if (s.role != 'SALES')
          'monthProfit': {
            'netSalesMinor': 0,
            'grossProfitMinor': 0,
            'marginBp': null,
          },
        'attentionProducts': <Object>[],
        'recentDocuments': <Object>[],
      };
      await launch(tester, role: 'MANAGER', arrange: empty);
      expect(tileTexts(tester, 'kpi-today'), [
        "TODAY'S SALES",
        'AED 0.00',
        '0 invoices',
      ]);
      expect(find.text('No sales yet this month'), findsOneWidget);
      expect(find.text('Needs attention'), findsNothing);
      expect(
        find.textContaining('appear here once you make a sale'),
        findsOneWidget,
      );
      await tapKey(tester, 'add-first-product');
      expect(find.text('New product'), findsWidgets);

      await launch(tester, role: 'SALES', arrange: empty);
      expect(find.byKey(const Key('add-first-product')), findsNothing);
    });

    testWidgets(
      'explains a failed load and recovers on retry, and refreshes on pull',
      (tester) async {
        await launch(
          tester,
          role: 'MANAGER',
          arrange: (s) => s.dashboardOffline = true,
        );
        expect(
          find.text('No connection. Check your internet and try again.'),
          findsOneWidget,
        );
        expect(
          find.text('Good morning, Maya'),
          findsOneWidget,
          reason: 'the greeting needs no network',
        );
        await tapText(tester, 'Try again');
        expect(find.byKey(const Key('kpi-today')), findsOneWidget);

        (server.dashboard['stock'] as Map<String, dynamic>)['units'] = 60;
        await tester.fling(
          find.byKey(const Key('kpi-today')),
          const Offset(0, 400),
          1000,
        );
        await tester.pumpAndSettle();
        expect(find.text('60 pcs'), findsOneWidget);
      },
    );

    testWidgets('stays usable at 200% text and on a tablet', (tester) async {
      await launch(tester, role: 'MANAGER');
      tester.platformDispatcher.textScaleFactorTestValue = 2;
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      // One column: every tile is as wide as the screen allows.
      expect(
        tester.getSize(find.byKey(const Key('kpi-today'))).width,
        greaterThan(300),
      );

      tester.platformDispatcher.clearTextScaleFactorTestValue();
      setScreenSize(tester, const Size(1194, 834));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      final tops = [
        'kpi-today',
        'kpi-outstanding',
        'kpi-stock',
        'kpi-profit',
      ].map((k) => tester.getTopLeft(find.byKey(Key(k))).dy).toSet();
      expect(tops, hasLength(1), reason: 'four tiles in one row');
    });
  });

  group('reports', () {
    testWidgets('shows a manager the month so far', (tester) async {
      await launch(tester, role: 'MANAGER');
      await openMore(tester, 'open-reports');
      expect(
        tester.widget<Text>(find.byKey(const Key('report-period'))).data,
        '1 Nov 2026 – 16 Nov 2026',
      );
      expect(lastQuery('/reports/sales-summary'), {
        'from': '2026-11-01',
        'to': '2026-11-16',
      });
      expect(find.text('NET SALES'), findsOneWidget);
      expect(
        tester.widget<Text>(find.byKey(const Key('net-sales'))).data,
        'AED 6,685.00',
      );
      expect(find.textContaining('2 invoices · before tax'), findsOneWidget);
      for (final amount in [
        'AED 10,694.25',
        'AED 334.25',
        'AED 280.00',
        'AED 3,675.00',
        'AED 6,344.25',
      ]) {
        expect(find.text(amount), findsOneWidget, reason: amount);
      }

      await tester.scrollUntilVisible(
        find.text('Owed now'),
        200,
        scrollable: find.byType(Scrollable).last,
      );
      expect(find.text('AED 5,250.00'), findsOneWidget); // cost of goods sold
      expect(find.text('AED 1,435.00'), findsOneWidget); // gross profit
      expect(find.text('21.47%'), findsOneWidget);

      await tester.scrollUntilVisible(
        find.text('Sales by team member'),
        200,
        scrollable: find.byType(Scrollable).last,
      );
      expect(
        tester.widget<Text>(find.byKey(const Key('status-PAID'))).data,
        'Paid · 5 (62.5%)',
      );
      expect(
        tester.widget<Text>(find.byKey(const Key('status-PARTIAL'))).data,
        'Partially paid · 2 (25%)',
      );
      expect(
        tester.widget<Text>(find.byKey(const Key('status-UNPAID'))).data,
        'Unpaid · 1 (12.5%)',
      );
      expect(
        tester.widget<Text>(find.byKey(const Key('status-OVERDUE'))).data,
        '1 overdue · AED 675.00 still owed',
      );

      await tester.scrollUntilVisible(
        find.text('As of today.'),
        200,
        scrollable: find.byType(Scrollable).last,
      );
      expect(find.text('1 invoice · profit AED 700.00'), findsOneWidget);
      expect(find.text('Maya Manager'), findsOneWidget);
      expect(find.text('AED 128,400.00'), findsOneWidget);
      expect(find.text('43 pcs · 3 products'), findsOneWidget);
      expect(find.text('Alhambra Gold Bracelet · 23 pcs'), findsOneWidget);
    });

    testWidgets('asks for the chosen range', (tester) async {
      await launch(tester, role: 'MANAGER');
      await openMore(tester, 'open-reports');
      await tapKey(tester, 'range-today');
      expect(lastQuery('/reports/sales-summary'), {
        'from': '2026-11-16',
        'to': '2026-11-16',
      });
      expect(
        tester.widget<Text>(find.byKey(const Key('report-period'))).data,
        '16 Nov 2026',
      );
      await tapKey(tester, 'range-week');
      expect(lastQuery('/reports/payment-status'), {
        'from': '2026-11-10',
        'to': '2026-11-16',
      });
      await tapKey(tester, 'range-lastMonth');
      expect(lastQuery('/reports/sales-by-salesperson'), {
        'from': '2026-10-01',
        'to': '2026-10-31',
      });
      expect(
        tester.widget<Text>(find.byKey(const Key('report-period'))).data,
        '1 Oct 2026 – 31 Oct 2026',
      );
    });

    testWidgets(
      'gives a salesperson their own sales, without cost, team or stock',
      (tester) async {
        await launch(tester, role: 'SALES');
        await openMore(tester, 'open-reports');
        expect(find.text('YOUR NET SALES'), findsOneWidget);
        expect(
          tester.widget<Text>(find.byKey(const Key('net-sales'))).data,
          'AED 3,500.00',
        );
        expect(find.byKey(const Key('export-menu')), findsNothing);
        await tester.scrollUntilVisible(
          find.byKey(const Key('status-OVERDUE')),
          200,
          scrollable: find.byType(Scrollable).last,
        );
        for (final hidden in [
          'Profit',
          'Gross profit',
          'Cost of goods sold',
          'Sales by team member',
          'Stock',
        ]) {
          expect(find.text(hidden), findsNothing, reason: hidden);
        }
        final paths = app.adapter.requests.map((r) => r.path);
        expect(paths, isNot(contains('/reports/sales-by-salesperson')));
        expect(paths, isNot(contains('/reports/inventory-valuation')));
      },
    );

    testWidgets('says so when the period has no sales', (tester) async {
      await launch(
        tester,
        role: 'MANAGER',
        arrange: (s) => s.emptyPeriod = true,
      );
      await openMore(tester, 'open-reports');
      expect(
        tester.widget<Text>(find.byKey(const Key('net-sales'))).data,
        'AED 0.00',
      );
      await tester.scrollUntilVisible(
        find.text('No sales in this period.'),
        200,
        scrollable: find.byType(Scrollable).last,
      );
      expect(find.text('No invoices in this period.'), findsOneWidget);
      expect(find.text('—'), findsOneWidget); // no margin without sales
    });

    testWidgets('exports the period as CSV through the share sheet', (
      tester,
    ) async {
      await launch(tester, role: 'MANAGER');
      await openMore(tester, 'open-reports');
      await tapKey(tester, 'export-menu');
      await tapText(tester, 'Sales for this period (CSV)');
      expect(
        shared.single.filename,
        'velora-sales-2026-11-01-to-2026-11-16.csv',
      );
      expect(shared.single.mimeType, 'text/csv');
      expect(
        String.fromCharCodes(shared.single.bytes),
        startsWith('Invoice,Date'),
      );
      final request = app.adapter.requests.lastWhere(
        (r) => r.path == '/reports/sales-summary',
      );
      expect(request.headers['Accept'], 'text/csv');
      expect(request.queryParameters, {
        'from': '2026-11-01',
        'to': '2026-11-16',
      });

      await tapKey(tester, 'export-menu');
      await tapText(tester, 'Stock value (CSV)');
      expect(shared.last.filename, 'velora-inventory.csv');

      canShare = false;
      await tapKey(tester, 'export-menu');
      await tapText(tester, 'Stock value (CSV)');
      expect(
        find.text('Sharing is not available on this device.'),
        findsOneWidget,
      );
    });
  });

  group('business settings', () {
    testWidgets(
      'the owner changes settings; only what changed is sent and the app picks it up',
      (tester) async {
        await launch(tester);
        await openMore(tester, 'open-settings');
        expect(textOf(tester, 'setting-name'), 'Velora Fine Jewellery LLC');
        expect(textOf(tester, 'setting-maxMarkupBp'), '60');
        final profileLoads = app.adapter.count('/auth/me');

        await type(tester, 'setting-name', 'Velora Jewellers');
        await type(tester, 'setting-phone', '');
        await type(
          tester,
          'setting-invoiceFooter',
          'Thank you for your business.',
        );
        await type(tester, 'setting-maxMarkupBp', '55.5');
        await type(tester, 'setting-defaultCreditDays', '14');
        await tapKey(tester, 'save-settings');

        expect(sent('PATCH', '/organization'), [
          {
            'name': 'Velora Jewellers',
            'phone': null,
            'invoiceFooter': 'Thank you for your business.',
            'defaultCreditDays': 14,
            'maxMarkupBp': 5550,
          },
        ]);
        expect(find.text('Settings saved.'), findsOneWidget);
        expect(
          app.adapter.count('/auth/me'),
          profileLoads + 1,
          reason: 'the profile carries the new defaults',
        );

        // Saving again without edits sends nothing.
        await tapKey(tester, 'save-settings');
        expect(find.text('Nothing was changed.'), findsOneWidget);
        expect(sent('PATCH', '/organization'), hasLength(1));
      },
    );

    testWidgets('checks values before sending', (tester) async {
      await launch(tester);
      await openMore(tester, 'open-settings');
      await type(tester, 'setting-name', '  ');
      await type(tester, 'setting-email', 'not-an-email');
      await type(tester, 'setting-countryCode', 'UAE');
      await type(tester, 'setting-defaultMarkupBp', '12.345');
      await type(tester, 'setting-defaultCreditDays', '400');
      await type(tester, 'setting-quotationValidityDays', '0');
      await tapKey(tester, 'save-settings');
      for (final message in [
        'Required.',
        'Enter a valid email address.',
        'Use two letters, for example AE.',
        'Enter a percentage from 0 to 1000, with up to two decimals.',
        'Enter a whole number from 0 to 365.',
        'Enter a whole number from 1 to 365.',
      ]) {
        expect(find.text(message), findsOneWidget, reason: message);
      }
      expect(sent('PATCH', '/organization'), isEmpty);
    });

    testWidgets("shows the server's refusal and keeps what was typed", (
      tester,
    ) async {
      await launch(tester);
      await openMore(tester, 'open-settings');
      await type(tester, 'setting-maxMarkupBp', '40');
      await tapKey(tester, 'save-settings');
      expect(
        tester
            .widget<Text>(
              find.descendant(
                of: find.byKey(const Key('settings-error')),
                matching: find.byType(Text),
              ),
            )
            .data,
        '2 products have a default markup above this maximum. Lower those first.',
      );
      expect(textOf(tester, 'setting-maxMarkupBp'), '40');
      expect(server.organization['maxMarkupBp'], 6000);
    });

    testWidgets(
      'currency and time zone are fixed once documents exist, editable before',
      (tester) async {
        await launch(tester);
        await openMore(tester, 'open-settings');
        await tester.scrollUntilVisible(
          find.byKey(const Key('regional-locked')),
          200,
          scrollable: find.byType(Scrollable).last,
        );
        expect(
          tester.widget<TextFormField>(field('setting-currencyCode')).enabled,
          isFalse,
        );
        expect(
          tester.widget<TextFormField>(field('setting-timezone')).enabled,
          isFalse,
        );

        await launch(
          tester,
          arrange: (s) => s.organization['regionalSettingsLocked'] = false,
        );
        await openMore(tester, 'open-settings');
        await type(tester, 'setting-currencyCode', 'zzz');
        await tapKey(tester, 'save-settings');
        expect(sent('PATCH', '/organization').single, {'currencyCode': 'ZZZ'});
        expect(
          find.textContaining('not a known currency code'),
          findsOneWidget,
        );
        await type(tester, 'setting-currencyCode', 'usd');
        await tapKey(tester, 'save-settings');
        expect(server.organization['currencyCode'], 'USD');
        expect(find.text('Settings saved.'), findsOneWidget);
      },
    );

    testWidgets('a manager sees the settings but cannot change them', (
      tester,
    ) async {
      await launch(tester, role: 'MANAGER');
      await openMore(tester, 'open-settings');
      expect(
        find.text('Only the owner can change these settings.'),
        findsOneWidget,
      );
      expect(find.byKey(const Key('save-settings')), findsNothing);
      expect(
        tester.widget<TextFormField>(field('setting-name')).enabled,
        isFalse,
      );
      expect(textOf(tester, 'setting-name'), 'Velora Fine Jewellery LLC');
    });

    testWidgets('sales staff are not offered settings or team', (tester) async {
      await launch(tester, role: 'SALES');
      await tab(tester, 'More');
      expect(find.byKey(const Key('open-reports')), findsOneWidget);
      expect(find.byKey(const Key('open-devices')), findsOneWidget);
      expect(find.byKey(const Key('open-settings')), findsNothing);
      expect(find.byKey(const Key('open-team')), findsNothing);
    });
  });

  group('tax rates', () {
    Future<void> open(WidgetTester tester, {String role = 'OWNER'}) async {
      await launch(tester, role: role);
      await openMore(tester, 'open-settings');
      await tapKey(tester, 'open-tax-rates');
    }

    testWidgets('lists every rate with its state', (tester) async {
      await open(tester);
      expect(lastQuery('/tax-rates'), {'includeInactive': true});
      expect(tileTexts(tester, 'rate-VAT 5%'), ['VAT 5%', '5%', 'Default']);
      expect(tileTexts(tester, 'rate-Zero rated'), ['Zero rated', '0%']);
      expect(tileTexts(tester, 'rate-Old VAT 4%'), [
        'Old VAT 4%',
        '4%',
        'Not used',
      ]);
    });

    testWidgets('adds a rate, refusing a name already in use', (tester) async {
      await open(tester);
      await tapKey(tester, 'add-tax-rate');
      await tapKey(tester, 'rate-save');
      expect(find.text('Required.'), findsOneWidget);
      expect(find.text('Enter a percentage from 0 to 100.'), findsOneWidget);

      await type(tester, 'rate-name', 'vat 5%');
      await type(tester, 'rate-percent', '5');
      await tapKey(tester, 'rate-save');
      expect(
        find.text('Another tax rate already has this name.'),
        findsOneWidget,
      );

      await type(tester, 'rate-name', 'VAT 15%');
      await type(tester, 'rate-percent', '15');
      await tapKey(tester, 'rate-make-default');
      await tapKey(tester, 'rate-save');
      expect(sent('POST', '/tax-rates').last, {
        'name': 'VAT 15%',
        'rateBp': 1500,
        'isDefault': true,
      });
      expect(find.text('VAT 15% added.'), findsOneWidget);
      expect(tileTexts(tester, 'rate-VAT 15%'), contains('Default'));
      expect(tileTexts(tester, 'rate-VAT 5%'), isNot(contains('Default')));
    });

    testWidgets('renames, changes the default and stops using a rate', (
      tester,
    ) async {
      await open(tester);
      await tapKey(tester, 'rate-Zero rated');
      await tapKey(tester, 'rate-rename');
      await type(tester, 'rate-name', 'Exports');
      await tapKey(tester, 'rate-save');
      expect(sent('PATCH', '/tax-rates/t0').last, {'name': 'Exports'});
      expect(find.text('Renamed to Exports.'), findsOneWidget);

      await tapKey(tester, 'rate-Exports');
      await tapKey(tester, 'rate-default');
      expect(sent('PATCH', '/tax-rates/t0').last, {'isDefault': true});
      expect(tileTexts(tester, 'rate-Exports'), contains('Default'));

      // The former default can now be retired; the current default cannot.
      await tapKey(tester, 'rate-VAT 5%');
      await tapKey(tester, 'rate-toggle');
      expect(sent('PATCH', '/tax-rates/t1').last, {'isActive': false});
      expect(tileTexts(tester, 'rate-VAT 5%'), contains('Not used'));
      await tapKey(tester, 'rate-Exports');
      expect(find.byKey(const Key('rate-toggle')), findsNothing);
      expect(find.byKey(const Key('rate-default')), findsNothing);
    });

    testWidgets('is read-only for a manager', (tester) async {
      await open(tester, role: 'MANAGER');
      expect(find.byKey(const Key('add-tax-rate')), findsNothing);
      await tester.tap(find.byKey(const Key('rate-Zero rated')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('rate-rename')), findsNothing);
    });
  });

  group('team', () {
    testWidgets('lists the team with role and status', (tester) async {
      await launch(tester);
      await openMore(tester, 'open-team');
      expect(tileTexts(tester, 'member-maya@velora.example'), [
        'Maya Manager (you)',
        'maya@velora.example',
        'Owner',
      ]);
      expect(tileTexts(tester, 'member-omar@velora.example'), [
        'Omar Rahman',
        'omar@velora.example',
        'Manager',
      ]);
      expect(tileTexts(tester, 'member-lina@velora.example'), [
        'Lina Haddad',
        'lina@velora.example',
        'Invited',
      ]);
      // The owner cannot change their own access from here.
      await tester.tap(find.byKey(const Key('member-maya@velora.example')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('member-toggle')), findsNothing);
    });

    testWidgets('invites a team member by email', (tester) async {
      await launch(tester);
      await openMore(tester, 'open-team');
      await tapKey(tester, 'invite-member');
      await tapKey(tester, 'invite-send');
      expect(find.text('Enter their name.'), findsOneWidget);
      expect(find.text('Enter a valid email address.'), findsOneWidget);

      await type(tester, 'invite-name', 'Sara Nasser');
      await type(tester, 'invite-email', 'ahmed@velora.example');
      await tapKey(tester, 'invite-send');
      expect(
        find.text('This email address already has an account.'),
        findsOneWidget,
      );

      await type(tester, 'invite-email', 'sara@velora.example');
      await tapText(tester, 'Manager');
      await tapKey(tester, 'invite-send');
      expect(sent('POST', '/organization/members').last, {
        'fullName': 'Sara Nasser',
        'email': 'sara@velora.example',
        'role': 'MANAGER',
      });
      expect(
        find.text(
          'Invitation emailed to sara@velora.example. The link works for 7 days.',
        ),
        findsOneWidget,
      );
      await tester.scrollUntilVisible(
        find.byKey(const Key('member-sara@velora.example')),
        200,
        scrollable: find.byType(Scrollable).last,
      );
      expect(
        tileTexts(tester, 'member-sara@velora.example'),
        contains('Invited'),
      );
    });

    testWidgets('changes a role and removes access after confirming', (
      tester,
    ) async {
      await launch(tester);
      await openMore(tester, 'open-team');
      await tapKey(tester, 'member-ahmed@velora.example');
      await tapKey(tester, 'role-manager');
      expect(sent('PATCH', '/organization/members/m3').last, {
        'role': 'MANAGER',
      });
      expect(
        find.text('Ahmed Karim is now Manager. They need to sign in again.'),
        findsOneWidget,
      );
      expect(
        tileTexts(tester, 'member-ahmed@velora.example'),
        contains('Manager'),
      );

      await tapKey(tester, 'member-omar@velora.example');
      await tapKey(tester, 'member-toggle');
      expect(find.text('Remove access for Omar Rahman?'), findsOneWidget);
      await tapText(tester, 'Cancel');
      expect(sent('PATCH', '/organization/members/m2'), isEmpty);

      await tapKey(tester, 'member-omar@velora.example');
      await tapKey(tester, 'member-toggle');
      await tapKey(tester, 'confirm-remove-access');
      expect(sent('PATCH', '/organization/members/m2').last, {
        'isActive': false,
      });
      expect(
        tileTexts(tester, 'member-omar@velora.example'),
        contains('No access'),
      );

      // Access comes back without a confirmation, and roles are not offered while it is off.
      await tapKey(tester, 'member-omar@velora.example');
      expect(find.byKey(const Key('role-sales')), findsNothing);
      await tapKey(tester, 'member-toggle');
      expect(sent('PATCH', '/organization/members/m2').last, {
        'isActive': true,
      });
      expect(find.text('Omar Rahman can sign in again.'), findsOneWidget);
    });

    testWidgets('a manager sees the team but cannot change it', (tester) async {
      await launch(tester, role: 'MANAGER');
      await openMore(tester, 'open-team');
      expect(find.byKey(const Key('invite-member')), findsNothing);
      await tester.tap(find.byKey(const Key('member-ahmed@velora.example')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('member-toggle')), findsNothing);
    });
  });

  group('devices and appearance', () {
    testWidgets('lists signed-in devices and signs another one out', (
      tester,
    ) async {
      await launch(tester, role: 'SALES');
      await openMore(tester, 'open-devices');
      expect(
        tileTexts(tester, 'device-0'),
        containsAll(['Android device', 'This device']),
      );
      expect(tileTexts(tester, 'device-1').first, 'iPhone or iPad');
      expect(find.byKey(const Key('device-sign-out-0')), findsNothing);

      await tapKey(tester, 'device-sign-out-1');
      await tapKey(tester, 'confirm-device-sign-out');
      expect(
        app.adapter.requests.any(
          (r) => r.method == 'DELETE' && r.path == '/auth/sessions/s2',
        ),
        isTrue,
      );
      expect(find.text('Device signed out.'), findsOneWidget);
      expect(find.byKey(const Key('device-1')), findsNothing);
    });

    testWidgets('names the device when signing in', (tester) async {
      setScreenSize(tester, const Size(390, 844));
      server = FakeOfficeServer(role: 'SALES');
      app = AppHarness(
        server: (r, b) =>
            r.path == '/auth/login' ? officeLogin() : server.handle(r, b),
        ownDashboard: true,
      );
      await tester.pumpWidget(app.build());
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byType(TextFormField).at(0),
        'maya@velora.example',
      );
      await tester.enterText(
        find.byType(TextFormField).at(1),
        'correct-horse-battery',
      );
      await tester.tap(find.byKey(const Key('login-submit')));
      await tester.pumpAndSettle();
      final login =
          app.adapter.requests.firstWhere((r) => r.path == '/auth/login').data
              as Map<String, dynamic>;
      expect(login['deviceName'], isNotEmpty);
    });

    testWidgets('remembers the chosen appearance on the device', (
      tester,
    ) async {
      await launch(tester, role: 'SALES');
      MaterialApp root() =>
          tester.widget<MaterialApp>(find.byType(MaterialApp));
      expect(root().themeMode, ThemeMode.system);
      await tab(tester, 'More');
      expect(find.text('Same as device'), findsOneWidget);

      await tapKey(tester, 'open-appearance');
      await tapKey(tester, 'appearance-dark');
      expect(root().themeMode, ThemeMode.dark);
      expect(find.text('Dark'), findsOneWidget);
      expect(
        Theme.of(tester.element(find.byKey(const Key('open-appearance'))))
            .brightness,
        Brightness.dark,
      );

      await launch(
        tester,
        role: 'SALES',
      ); // the app restarts on the same device
      expect(root().themeMode, ThemeMode.dark);
    });
  });

  testWidgets('new screens meet tap-target and labelling guidelines', (
    tester,
  ) async {
    final handle = tester.ensureSemantics();
    Future<void> check() async {
      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      await expectLater(tester, meetsGuideline(textContrastGuideline));
    }

    await launch(tester);
    await check(); // home
    await openMore(tester, 'open-reports');
    await check();
    await tester.pageBack();
    await tester.pumpAndSettle();
    await check(); // more
    await tapKey(tester, 'open-settings');
    await check();
    await tapKey(tester, 'open-tax-rates');
    await check();
    await tester.pageBack();
    await tester.pumpAndSettle();
    await tester.pageBack();
    await tester.pumpAndSettle();
    await tapKey(tester, 'open-team');
    await check();
    await tester.pageBack();
    await tester.pumpAndSettle();
    await tapKey(tester, 'open-devices');
    await check();
    handle.dispose();
  });

  group('helpers', () {
    test(
      'report ranges follow the calendar, including month and year ends',
      () {
        ReportRange.values
            .where((r) => r != ReportRange.custom)
            .forEach((r) => r.periodOn(DateTime(2026, 11, 16)));
        expect(
          ReportRange.week.periodOn(DateTime(2026, 3, 3, 23, 59)).from,
          '2026-02-25',
        );
        expect(
          ReportRange.month.periodOn(DateTime(2026, 2, 28)).from,
          '2026-02-01',
        );
        final january = ReportRange.lastMonth.periodOn(DateTime(2027, 1, 15));
        expect((january.from, january.to), ('2026-12-01', '2026-12-31'));
        final march = ReportRange.lastMonth.periodOn(DateTime(2028, 3, 31));
        expect((march.from, march.to), ('2028-02-01', '2028-02-29'));
        expect(
          () => ReportRange.custom.periodOn(DateTime(2026)),
          throwsStateError,
        );
      },
    );

    test('percentages convert to basis points and back without rounding', () {
      expect(parsePercent('30'), 3000);
      expect(parsePercent('12.5'), 1250);
      expect(parsePercent('12,05'), 1205);
      expect(parsePercent('0'), 0);
      expect(parsePercent('0.07'), 7);
      for (final bad in ['', '-1', '1.234', 'abc', '1.', '12345']) {
        expect(parsePercent(bad), isNull, reason: bad);
      }
      for (final bp in [0, 7, 50, 1205, 1250, 3000, 100000]) {
        expect(parsePercent(percentText(bp)), bp);
      }
      expect(percentText(1250), '12.5');
    });
  });
}
