import 'dart:convert';

import 'package:dio/dio.dart';

import 'fake_shop_server.dart';
import 'fakes.dart';

/// In-memory stand-in for the dashboard, reports, settings, team and device endpoints.
/// Everything else (products, documents…) is answered by a [FakeShopServer].
class FakeOfficeServer {
  FakeOfficeServer({this.role = 'OWNER'}) : shop = FakeShopServer() {
    shop.role = role;
    dashboard = busyDashboard(role);
  }

  final String role;
  final FakeShopServer shop;
  late Map<String, dynamic> dashboard;

  /// When set, the next dashboard request fails as if the connection dropped.
  bool dashboardOffline = false;
  bool emptyPeriod = false;

  /// When set, invitations are created but their email is reported as not sent.
  bool mailDown = false;
  int csvRequests = 0;

  bool get _manager => role != 'SALES';
  bool get _owner => role == 'OWNER';

  final Map<String, dynamic> organization = {
    'id': 'o1',
    'name': 'Velora Fine Jewellery LLC',
    'legalName': null,
    'taxRegistrationNumber': '100123456700003',
    'phone': '+97145550100',
    'email': null,
    'addressLine': 'Gold Souk, Deira',
    'city': 'Dubai',
    'countryCode': 'AE',
    'invoiceFooter': null,
    'currencyCode': 'AED',
    'currencyExponent': 2,
    'timezone': 'Asia/Dubai',
    'locale': 'en',
    'lowStockThreshold': 8,
    'defaultCreditDays': 30,
    'quotationValidityDays': 14,
    'allowOfflineSales': false,
    'maxMarkupBp': 6000,
    'defaultMarkupBp': 3000,
    'defaultMinMarkupBp': 1500,
    'regionalSettingsLocked': true,
  };

  final List<Map<String, dynamic>> members = [
    _member('m1', 'Maya Manager', 'maya@velora.example', 'OWNER'),
    _member('m2', 'Omar Rahman', 'omar@velora.example', 'MANAGER'),
    _member('m3', 'Ahmed Karim', 'ahmed@velora.example', 'SALES'),
    _member('m4', 'Lina Haddad', 'lina@velora.example', 'SALES', pending: true),
  ];

  final List<Map<String, dynamic>> taxRates = [
    _rate('t1', 'VAT 5%', 500, isDefault: true),
    _rate('t0', 'Zero rated', 0),
    _rate('t9', 'Old VAT 4%', 400, isActive: false),
  ];

  final List<Map<String, dynamic>> sessions = [
    {
      'id': 's1',
      'deviceName': 'Android device',
      'ipAddress': null,
      'signedInAt': '2026-11-10T05:00:00.000Z',
      'lastActiveAt': '2026-11-16T05:20:00.000Z',
      'isCurrent': true,
    },
    {
      'id': 's2',
      'deviceName': 'iPhone or iPad',
      'ipAddress': null,
      'signedInAt': '2026-11-01T06:00:00.000Z',
      'lastActiveAt': '2026-11-14T12:00:00.000Z',
      'isCurrent': false,
    },
  ];

  static Map<String, dynamic> _member(
    String id,
    String name,
    String email,
    String role, {
    bool pending = false,
  }) => {
    'memberId': id,
    'userId': 'u-$id',
    'fullName': name,
    'email': email,
    'role': role,
    'isActive': true,
    'isPending': pending,
    'lastLoginAt': pending ? null : '2026-11-15T08:00:00.000Z',
    'createdAt': '2026-08-01T08:00:00.000Z',
  };

  static Map<String, dynamic> _rate(
    String id,
    String name,
    int rateBp, {
    bool isDefault = false,
    bool isActive = true,
  }) => {
    'id': id,
    'name': name,
    'rateBp': rateBp,
    'isDefault': isDefault,
    'isActive': isActive,
  };

  /// A trading day with sales, money owed and stock running low.
  static Map<String, dynamic> busyDashboard(String role) => {
    'asOf': '2026-11-16T05:30:00.000Z',
    'currencyCode': 'AED',
    'todaySales': {
      'invoicedMinor': role == 'SALES' ? 735000 : 1069425,
      'invoiceCount': role == 'SALES' ? 1 : 2,
      'yesterdayInvoicedMinor': 951450,
      'changeBp': role == 'SALES' ? -2275 : 1240,
    },
    'stock': {'units': 53, 'productCount': 4, 'lowCount': 2, 'outCount': 1},
    'outstanding': {
      'balanceMinor': 1250000,
      'invoiceCount': 3,
      'overdueMinor': 350000,
      'overdueCount': 1,
    },
    if (role != 'SALES') ...{
      'monthProfit': {
        'netSalesMinor': 7530000,
        'grossProfitMinor': 1845000,
        'marginBp': 2450,
      },
      'inventoryValueMinor': 15085000,
    },
    'attentionProducts': [
      {
        'id': 'p9',
        'name': 'Sold Out Pendant',
        'sku': 'VLR-SO-099',
        'quantity': 0,
        'stockStatus': 'OUT',
      },
    ],
    'recentDocuments': [
      {
        'type': 'INVOICE',
        'id': 'i7',
        'number': 'INV-2026-00007',
        'issuedAt': '2026-11-16T05:00:00.000Z',
        'customer': {
          'id': 'c1',
          'name': 'Maya Farah',
          'company': 'Maison Luxe',
          'mobile': '+971558204412',
        },
        'salesperson': {'memberId': 'm3', 'fullName': 'Ahmed Karim'},
        'lineCount': 1,
        'totalMinor': 735000,
        'status': 'ISSUED',
        'paymentStatus': 'PARTIAL',
        'balanceMinor': 67500,
        'dueDate': '2026-12-16',
        'isOverdue': false,
      },
      {
        'type': 'QUOTATION',
        'id': 'q3',
        'number': 'QT-2026-00003',
        'issuedAt': '2026-11-15T09:00:00.000Z',
        'customer': {
          'id': 'c2',
          'name': 'Arjun Mehta',
          'company': 'ABC Trading',
          'mobile': null,
        },
        'salesperson': {'memberId': 'm3', 'fullName': 'Ahmed Karim'},
        'lineCount': 2,
        'totalMinor': 298095,
        'quotationStatus': 'OPEN',
        'validUntil': '2026-11-29',
      },
    ],
  };

  Map<String, dynamic> get _summary => emptyPeriod
      ? {
          'invoiceCount': 0,
          'invoicedMinor': 0,
          'netSalesMinor': 0,
          'taxMinor': 0,
          'discountMinor': 0,
          'returnsMinor': 0,
          'receivedMinor': 0,
          if (_manager) ...{
            'cogsMinor': 0,
            'grossProfitMinor': 0,
            'marginBp': null,
          },
          'outstandingNowMinor': 67500,
          'overdueNowMinor': 0,
        }
      : {
          'invoiceCount': _manager ? 2 : 1,
          'invoicedMinor': _manager ? 1069425 : 735000,
          'netSalesMinor': _manager ? 668500 : 350000,
          'taxMinor': _manager ? 33425 : 17500,
          'discountMinor': 28000,
          'returnsMinor': 367500,
          'receivedMinor': _manager ? 634425 : 300000,
          if (_manager) ...{
            'cogsMinor': 525000,
            'grossProfitMinor': 143500,
            'marginBp': 2147,
          },
          'outstandingNowMinor': 67500,
          'overdueNowMinor': 67500,
        };

  ResponseBody _csv(String text) => ResponseBody.fromBytes(
    utf8.encode(text),
    200,
    headers: {
      Headers.contentTypeHeader: ['text/csv; charset=utf-8'],
    },
  );

  ResponseBody? _office(RequestOptions r, Map<String, dynamic>? body) {
    final path = r.path;
    final method = r.method;
    final wantsCsv = r.headers['Accept'] == 'text/csv';

    if (path == '/auth/me') {
      final me = meJson(role: role);
      final settings = me['settings'] as Map<String, dynamic>;
      settings['defaultCreditDays'] = organization['defaultCreditDays'];
      settings['currencyCode'] = organization['currencyCode'];
      return ok(me);
    }
    if (path == '/dashboard/summary') {
      if (dashboardOffline) {
        dashboardOffline = false;
        offline(r);
      }
      return ok(dashboard);
    }

    if (path == '/reports/sales-summary') {
      if (wantsCsv) {
        if (!_manager) return apiError(403, 'FORBIDDEN');
        csvRequests++;
        return _csv('Invoice,Date\r\nINV-2026-00007,2026-11-16\r\n');
      }
      return ok({
        'from': r.queryParameters['from'],
        'to': r.queryParameters['to'],
        ..._summary,
      });
    }
    if (path == '/reports/payment-status') {
      Map<String, dynamic> row(String s, int n, int total, int balance) => {
        'status': s,
        'count': emptyPeriod ? 0 : n,
        'totalMinor': emptyPeriod ? 0 : total,
        'balanceMinor': emptyPeriod ? 0 : balance,
      };
      return ok([
        row('PAID', 5, 2500000, 0),
        row('PARTIAL', 2, 1100000, 400000),
        row('UNPAID', 1, 334425, 334425),
        row('OVERDUE', 1, 735000, 67500),
      ]);
    }
    if (path == '/reports/sales-by-salesperson') {
      if (!_manager) return apiError(403, 'FORBIDDEN');
      return ok(
        emptyPeriod
            ? <Object>[]
            : [
                {
                  'memberId': 'm3',
                  'fullName': 'Ahmed Karim',
                  'invoiceCount': 1,
                  'invoicedMinor': 735000,
                  'netSalesMinor': 350000,
                  'grossProfitMinor': 70000,
                },
                {
                  'memberId': 'm1',
                  'fullName': 'Maya Manager',
                  'invoiceCount': 1,
                  'invoicedMinor': 334425,
                  'netSalesMinor': 318500,
                  'grossProfitMinor': 73500,
                },
              ],
      );
    }
    if (path == '/reports/inventory-valuation') {
      if (!_manager) return apiError(403, 'FORBIDDEN');
      if (wantsCsv) {
        csvRequests++;
        return _csv('SKU,Product\r\nVLR-BR-001,Alhambra Gold Bracelet\r\n');
      }
      return json(200, {
        'data': [
          {
            'productId': 'p1',
            'name': 'Alhambra Gold Bracelet',
            'sku': 'VLR-BR-001',
            'quantity': 23,
            'costMinor': 280000,
            'valueMinor': 6440000,
          },
          {
            'productId': 'p3',
            'name': 'Rose Gold Cuff',
            'sku': 'VLR-RC-021',
            'quantity': 16,
            'costMinor': 245000,
            'valueMinor': 3920000,
          },
        ],
        'meta': {
          'summary': {'units': 43, 'valueMinor': 12840000, 'productCount': 3},
          'hasMore': true,
          'nextCursor': 'next',
        },
      });
    }

    if (path == '/organization') {
      final view = Map<String, dynamic>.of(organization);
      if (!_manager) {
        for (final k in [
          'maxMarkupBp',
          'defaultMarkupBp',
          'defaultMinMarkupBp',
          'regionalSettingsLocked',
        ]) {
          view.remove(k);
        }
      }
      if (method == 'GET') return ok(view);
      if (!_owner) return apiError(403, 'FORBIDDEN');
      final changes = body!;
      if (changes['currencyCode'] == 'ZZZ') {
        return apiError(
          400,
          'VALIDATION_ERROR',
          details: [
            {'field': 'currencyCode', 'rule': 'unknown_currency'},
          ],
        );
      }
      final max = changes['maxMarkupBp'];
      if (max is int && max < 4500) {
        return apiError(
          422,
          'MARKUP_POLICY_INVALID',
          details: [
            {'field': 'maxMarkupBp', 'productCount': 2},
          ],
        );
      }
      organization.addAll(changes);
      return ok(organization);
    }

    if (path == '/organization/members') {
      if (!_manager) return apiError(403, 'FORBIDDEN');
      if (method == 'GET') return ok(members);
      if (!_owner) return apiError(403, 'FORBIDDEN');
      if (members.any((m) => m['email'] == body!['email'])) {
        return apiError(409, 'MEMBER_EXISTS');
      }
      final member = _member(
        'm${members.length + 1}',
        body!['fullName'] as String,
        body['email'] as String,
        body['role'] as String,
        pending: true,
      );
      members.add(member);
      return json(201, {
        'data': {...member, 'invitationEmailSent': !mailDown},
      });
    }
    if (path.startsWith('/organization/members/')) {
      if (!_owner) return apiError(403, 'FORBIDDEN');
      final member = members.firstWhere(
        (m) => m['memberId'] == path.split('/').last,
      );
      member.addAll(body!);
      return ok(member);
    }

    if (path == '/tax-rates') {
      if (method == 'GET') {
        final all = r.queryParameters['includeInactive'] == true && _manager;
        return ok(taxRates.where((t) => all || t['isActive'] == true).toList());
      }
      if (!_owner) return apiError(403, 'FORBIDDEN');
      final name = body!['name'] as String;
      if (taxRates.any(
        (t) => (t['name'] as String).toLowerCase() == name.toLowerCase(),
      )) {
        return apiError(409, 'DUPLICATE_NAME');
      }
      final isDefault = body['isDefault'] == true;
      if (isDefault) {
        for (final t in taxRates) {
          t['isDefault'] = false;
        }
      }
      final rate = _rate(
        't${taxRates.length + 10}',
        name,
        body['rateBp'] as int,
        isDefault: isDefault,
      );
      taxRates.add(rate);
      return json(201, {'data': rate});
    }
    if (path.startsWith('/tax-rates/')) {
      if (!_owner) return apiError(403, 'FORBIDDEN');
      final rate = taxRates.firstWhere((t) => t['id'] == path.split('/').last);
      if (body!['isDefault'] == true) {
        for (final t in taxRates) {
          t['isDefault'] = false;
        }
      }
      rate.addAll(body);
      return ok(rate);
    }

    if (path == '/auth/sessions') return ok(sessions);
    if (path.startsWith('/auth/sessions/')) {
      sessions.removeWhere((s) => s['id'] == path.split('/').last);
      return noContent();
    }
    return null;
  }

  ResponseBody handle(RequestOptions r, Map<String, dynamic>? body) =>
      _office(r, body) ?? shop.handle(r, body) ?? apiError(404, 'NOT_FOUND');
}

Handler officeHandler(FakeOfficeServer server) => server.handle;

/// A successful sign-in response.
ResponseBody officeLogin() =>
    ok({'accessToken': 'access-1', 'refreshToken': 'refresh-1'});
