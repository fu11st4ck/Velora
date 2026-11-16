import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:velora/core/money/money_math.dart';

import 'fake_customer_server.dart';
import 'fake_inventory_server.dart';
import 'fakes.dart';

/// An in-memory stand-in for the whole API a sale touches: products, customers, pricing,
/// quotations, invoices, payments, cancellation, returns and the documents list. It follows the
/// backend's rules (docs/business-rules.md) closely enough to drive the screens end to end.
class FakeShopServer {
  FakeShopServer({String role = 'SALES'})
    : inventory = FakeInventoryServer(role: role)..seedReferenceCatalogue(),
      customers = FakeCustomerServer(role: role)..seedReference();

  final FakeInventoryServer inventory;
  final FakeCustomerServer customers;
  final List<Map<String, dynamic>> invoices = [];
  final List<Map<String, dynamic>> quotations = [];
  final Map<String, String> _replays = {};
  final List<Map<String, dynamic>> taxRates = [
    {
      'id': 't1',
      'name': 'VAT 5%',
      'rateBp': 500,
      'isDefault': true,
      'isActive': true,
    },
    {
      'id': 't0',
      'name': 'Zero rated 0%',
      'rateBp': 0,
      'isDefault': false,
      'isActive': true,
    },
  ];
  int _credit = 0;
  int pdfRequests = 0;

  /// When set, the next POST fails once as if the connection dropped.
  bool failNextPost = false;

  String get role => inventory.role;
  set role(String value) {
    inventory.role = value;
    customers.role = value;
  }

  bool get _manager => role != 'SALES';
  String get _me => _manager ? 'Maya Manager' : 'Ahmed Khan';

  Map<String, dynamic> product(String sku) => inventory.bySku(sku);

  ResponseBody _json(int status, Object body) => ResponseBody.fromString(
    jsonEncode(body),
    status,
    headers: {
      Headers.contentTypeHeader: [Headers.jsonContentType],
    },
  );

  /// Prices a cart exactly as the backend does; returns the priced document or an error response.
  ({Map<String, dynamic>? priced, ResponseBody? error}) _price(
    Map<String, dynamic> body, {
    required bool checkStock,
  }) {
    final rate = taxRates.firstWhere(
      (t) => t['id'] == (body['taxRateId'] ?? 't1'),
      orElse: () => <String, dynamic>{},
    );
    if (rate.isEmpty) {
      return (priced: null, error: apiError(422, 'TAX_RATE_INACTIVE'));
    }
    final requested = <String, int>{};
    final lines = <Map<String, dynamic>>[];
    var lineNo = 0;
    for (final raw in body['lines'] as List<dynamic>) {
      final l = raw as Map<String, dynamic>;
      lineNo++;
      final p = inventory.products
          .where((p) => p['id'] == l['productId'] && p['archivedAt'] == null)
          .firstOrNull;
      final qty = l['quantity'] as int;
      final price = l['unitPriceMinor'] as int;
      final issues = <Map<String, dynamic>>[];
      if (p == null) {
        issues.add({'code': 'PRODUCT_UNAVAILABLE'});
        lines.add({
          'lineNo': lineNo,
          'productId': l['productId'],
          'quantity': qty,
          'unitPriceMinor': price,
          'lineTotalMinor': price * qty,
          'available': 0,
          'issues': issues,
        });
        continue;
      }
      final cost = p['costMinor'] as int;
      final floor = priceFromMarkup(cost, p['minMarkupBp'] as int);
      final ceiling = priceFromMarkup(cost, inventory.maxMarkupBp);
      final overridden = _manager && l['belowMinimumReason'] != null;
      if (price < floor && !overridden) {
        issues.add({'code': 'PRICE_BELOW_MINIMUM', 'floorPriceMinor': floor});
      }
      if (price > ceiling) {
        issues.add({
          'code': 'PRICE_ABOVE_MAXIMUM',
          'ceilingPriceMinor': ceiling,
        });
      }
      final total = (requested[p['id']] ?? 0) + qty;
      requested[p['id'] as String] = total;
      if (checkStock && total > (p['quantity'] as int)) {
        issues.add({'code': 'INSUFFICIENT_STOCK', 'available': p['quantity']});
      }
      lines.add({
        'lineNo': lineNo,
        'productId': p['id'],
        'name': p['name'],
        'sku': p['sku'],
        'quantity': qty,
        'returnedQuantity': 0,
        'unitPriceMinor': price,
        'lineTotalMinor': price * qty,
        'unitCostMinor': cost,
        'markupBp': cost == 0 || price <= cost
            ? 0
            : ((price - cost) * 10000) ~/ cost,
        'available': p['quantity'],
        'belowMinimumReason': overridden ? l['belowMinimumReason'] : null,
        'issues': issues,
      });
    }
    final subtotal = lines.fold(0, (s, l) => s + (l['lineTotalMinor'] as int));
    final discount = (body['discountMinor'] as int?) ?? 0;
    if (discount > subtotal) {
      return (
        priced: null,
        error: apiError(
          422,
          'DISCOUNT_EXCEEDS_SUBTOTAL',
          details: [
            {'subtotalMinor': subtotal},
          ],
        ),
      );
    }
    final tax = divRoundHalfUp(
      (subtotal - discount) * (rate['rateBp'] as int),
      10000,
    );
    return (
      priced: {
        'lines': lines,
        'subtotalMinor': subtotal,
        'discountMinor': discount,
        'tax': {
          'id': rate['id'],
          'name': rate['name'],
          'rateBp': rate['rateBp'],
          'amountMinor': tax,
        },
        'totalMinor': subtotal - discount + tax,
        'valid': lines.every((l) => (l['issues'] as List).isEmpty),
      },
      error: null,
    );
  }

  ResponseBody? _firstIssue(Map<String, dynamic> priced) {
    for (final l in priced['lines'] as List<Map<String, dynamic>>) {
      for (final issue in l['issues'] as List<Map<String, dynamic>>) {
        final code = issue['code'] as String;
        return apiError(
          code == 'INSUFFICIENT_STOCK' ? 409 : 422,
          code,
          details: [
            {
              'lineNo': l['lineNo'],
              'productId': l['productId'],
              ...issue,
              'requested': l['quantity'],
            },
          ],
        );
      }
    }
    return null;
  }

  Map<String, dynamic> _customerSnapshot(String id) {
    final c = customers.customers.firstWhere((c) => c['id'] == id);
    return {
      'id': c['id'],
      'name': c['name'],
      'company': c['company'],
      'mobile': c['mobile'],
      'email': c['email'],
      'address': c['address'],
      'taxRegistrationNumber': c['taxRegistrationNumber'],
    };
  }

  List<Map<String, dynamic>> _lineViews(List<dynamic> lines) => [
    for (final l in lines.cast<Map<String, dynamic>>())
      {
        'lineNo': l['lineNo'],
        'productId': l['productId'],
        'name': l['name'],
        'sku': l['sku'],
        'quantity': l['quantity'],
        'returnedQuantity': l['returnedQuantity'],
        'unitPriceMinor': l['unitPriceMinor'],
        'lineTotalMinor': l['lineTotalMinor'],
        if (_manager) ...{
          'unitCostMinor': l['unitCostMinor'],
          'markupBp': l['markupBp'],
        },
      },
  ];

  Map<String, dynamic> invoiceView(Map<String, dynamic> i) {
    final paid = i['paidMinor'] as int;
    final balance =
        (i['totalMinor'] as int) - (i['returnedMinor'] as int) - paid;
    final cancelled = i['status'] == 'CANCELLED';
    final lines = (i['lines'] as List).cast<Map<String, dynamic>>();
    final net = (i['subtotalMinor'] as int) - (i['discountMinor'] as int);
    final cost = lines.fold(
      0,
      (s, l) =>
          s +
          (l['unitCostMinor'] as int) *
              ((l['quantity'] as int) - (l['returnedQuantity'] as int)),
    );
    return {
      ...i,
      'lines': _lineViews(lines),
      'balanceMinor': balance,
      'paymentStatus': balance == 0
          ? 'PAID'
          : (paid == 0 ? 'UNPAID' : 'PARTIAL'),
      'isOverdue': !cancelled && balance > 0 && i['overdue'] == true,
      if (_manager)
        'profit': {
          'costMinor': cost,
          'grossProfitMinor': net - cost,
          'marginBp': net > 0 ? ((net - cost) * 10000) ~/ net : null,
        },
    };
  }

  Map<String, dynamic> _summary(
    Map<String, dynamic> d, {
    required bool invoice,
  }) {
    final base = {
      'type': invoice ? 'INVOICE' : 'QUOTATION',
      'id': d['id'],
      'number': d['number'],
      'issuedAt': d['issuedAt'],
      'customer': d['customer'],
      'salesperson': d['salesperson'],
      'lineCount': (d['lines'] as List).length,
      'totalMinor': d['totalMinor'],
    };
    if (!invoice) {
      return {
        ...base,
        'quotationStatus': d['status'],
        'validUntil': d['validUntil'],
      };
    }
    final v = invoiceView(d);
    return {
      ...base,
      'status': d['status'],
      'paymentStatus': v['paymentStatus'],
      'balanceMinor': v['balanceMinor'],
      'dueDate': d['dueDate'],
      'isOverdue': v['isOverdue'],
    };
  }

  ResponseBody? handle(RequestOptions r, Map<String, dynamic>? body) {
    final path = r.path;
    if (path == '/auth/me') return ok(meJson(role: role, fullName: _me));
    final delegated = inventory.handle(r, body) ?? customers.handle(r, body);
    if (delegated != null) return delegated;

    if (path == '/tax-rates') return ok(taxRates);
    if (path == '/pricing/preview') {
      final result = _price(body!, checkStock: true);
      return result.error ??
          ok(
            result.priced!
              ..['lines'] = [
                for (final l
                    in result.priced!['lines'] as List<Map<String, dynamic>>)
                  {
                    'productId': l['productId'],
                    'quantity': l['quantity'],
                    'unitPriceMinor': l['unitPriceMinor'],
                    'lineTotalMinor': l['lineTotalMinor'],
                    'available': l['available'],
                    'issues': l['issues'],
                  },
              ],
          );
    }
    if (path == '/documents') {
      final type = r.queryParameters['type'] as String?;
      final statuses = ((r.queryParameters['status'] as String?) ?? '')
          .split(',')
          .where((s) => s.isNotEmpty)
          .toSet();
      final q = ((r.queryParameters['q'] as String?) ?? '').toLowerCase();
      bool matches(Map<String, dynamic> s) {
        final customer = s['customer'] as Map<String, dynamic>;
        if (q.isNotEmpty &&
            !'${s['number']} ${customer['name']} ${customer['company']}'
                .toLowerCase()
                .contains(q)) {
          return false;
        }
        if (statuses.isEmpty) return true;
        if (s['type'] == 'QUOTATION') return false;
        final cancelled = s['status'] == 'CANCELLED';
        return (statuses.contains('cancelled') && cancelled) ||
            (!cancelled &&
                statuses.contains(
                  (s['paymentStatus'] as String).toLowerCase(),
                )) ||
            (statuses.contains('overdue') && s['isOverdue'] == true);
      }

      final all =
          [
            if (type != 'quotation')
              for (final i in invoices) _summary(i, invoice: true),
            if (type != 'invoice')
              for (final q in quotations) _summary(q, invoice: false),
          ].where(matches).toList()..sort(
            (a, b) =>
                (b['issuedAt'] as String).compareTo(a['issuedAt'] as String),
          );
      return _json(200, {
        'data': all,
        'meta': {'nextCursor': null, 'hasMore': false},
      });
    }

    final key = r.headers['Idempotency-Key'] as String?;
    if (r.method == 'POST' && failNextPost) {
      failNextPost = false;
      offline(r);
    }
    if (r.method == 'POST' && key != null && _replays[key] != null) {
      return ResponseBody.fromString(
        _replays[key]!,
        201,
        headers: {
          Headers.contentTypeHeader: [Headers.jsonContentType],
        },
      );
    }
    ResponseBody created(Object data, [int status = 201]) {
      final text = jsonEncode({'data': data});
      if (key != null) _replays[key] = text;
      return ResponseBody.fromString(
        text,
        status,
        headers: {
          Headers.contentTypeHeader: [Headers.jsonContentType],
        },
      );
    }

    final stamp = DateTime.utc(
      2026,
      11,
      16,
      10,
      invoices.length + quotations.length,
    ).toIso8601String();

    if (path == '/quotations' && r.method == 'POST') {
      final result = _price(body!, checkStock: false);
      if (result.error != null) return result.error;
      final issue = _firstIssue(result.priced!);
      if (issue != null) return issue;
      final q = {
        ...result.priced!,
        'id': 'q${quotations.length + 1}',
        'number':
            'QT-2026-${(quotations.length + 1).toString().padLeft(5, '0')}',
        'status': 'OPEN',
        'issuedAt': stamp,
        'validUntil': '2026-11-30',
        'currencyCode': 'AED',
        'customer': _customerSnapshot(body['customerId'] as String),
        'salesperson': {'memberId': 'm1', 'fullName': _me},
        'notes': body['notes'],
        'invoice': null,
      };
      quotations.add(q);
      return created({...q, 'lines': _lineViews(q['lines'] as List)});
    }

    if (path == '/invoices' && r.method == 'POST') {
      final quotationId = body!['quotationId'] as String?;
      final quotation = quotationId == null
          ? null
          : quotations.firstWhere((q) => q['id'] == quotationId);
      if (quotation != null && quotation['status'] != 'OPEN') {
        return apiError(409, 'QUOTATION_ALREADY_CONVERTED');
      }
      final result = _price(body, checkStock: true);
      if (result.error != null) return result.error;
      final issue = _firstIssue(result.priced!);
      if (issue != null) return issue;
      final priced = result.priced!;
      final payment = body['payment'] as Map<String, dynamic>?;
      final received = (payment?['amountMinor'] as int?) ?? 0;
      final total = priced['totalMinor'] as int;
      if (received > total) {
        return apiError(
          422,
          'PAYMENT_EXCEEDS_BALANCE',
          details: [
            {'balanceMinor': total},
          ],
        );
      }
      for (final l in priced['lines'] as List<Map<String, dynamic>>) {
        final p = inventory.products.firstWhere(
          (p) => p['id'] == l['productId'],
        );
        p['quantity'] = (p['quantity'] as int) - (l['quantity'] as int);
      }
      final n = invoices.length + 1;
      final invoice = {
        ...priced,
        'id': 'i$n',
        'number': 'INV-2026-${n.toString().padLeft(5, '0')}',
        'status': 'ISSUED',
        'issuedAt': stamp,
        'currencyCode': 'AED',
        'customer': _customerSnapshot(body['customerId'] as String),
        'salesperson': {'memberId': 'm1', 'fullName': _me},
        'returnedMinor': 0,
        'paidMinor': received,
        'creditDays': received < total ? body['creditDays'] : null,
        'dueDate': received < total ? '2026-12-16' : null,
        'notes': body['notes'],
        'payments': [
          if (payment != null)
            {
              'id': 'pay${n}a',
              'kind': 'PAYMENT',
              'method': payment['method'],
              'amountMinor': received,
              'reference': payment['reference'],
              'note': null,
              'receivedAt': stamp,
              'recordedBy': {'memberId': 'm1', 'fullName': _me},
            },
        ],
        'returns': <Map<String, dynamic>>[],
        'quotation': quotation == null
            ? null
            : {'id': quotation['id'], 'number': quotation['number']},
        'cancellation': null,
        'request': body,
      };
      invoices.add(invoice);
      if (quotation != null) {
        quotation['status'] = 'CONVERTED';
        quotation['invoice'] = {
          'id': invoice['id'],
          'number': invoice['number'],
        };
      }
      return created(invoiceView(invoice));
    }

    final segments = path.split('/').where((s) => s.isNotEmpty).toList();
    if (segments.first == 'quotations') {
      final q = quotations.where((q) => q['id'] == segments[1]).firstOrNull;
      if (q == null) return apiError(404, 'NOT_FOUND');
      if (segments.length == 2) {
        return ok({...q, 'lines': _lineViews(q['lines'] as List)});
      }
      if (segments[2] == 'pdf') return _pdf();
      if (segments[2] == 'cancel') {
        if (q['status'] != 'OPEN') return apiError(409, 'INVALID_STATE');
        q['status'] = 'CANCELLED';
        return ok({...q, 'lines': _lineViews(q['lines'] as List)});
      }
    }
    if (segments.first == 'invoices') {
      final i = invoices.where((i) => i['id'] == segments[1]).firstOrNull;
      if (i == null) return apiError(404, 'NOT_FOUND');
      if (segments.length == 2) return ok(invoiceView(i));
      if (segments[2] == 'pdf') return _pdf();
      if (i['status'] == 'CANCELLED') return apiError(409, 'INVOICE_CANCELLED');
      final paid = i['paidMinor'] as int;
      final balance =
          (i['totalMinor'] as int) - (i['returnedMinor'] as int) - paid;
      final payments = i['payments'] as List;
      Map<String, dynamic> row(
        String kind,
        int amount,
        String method, {
        String? reference,
        String? note,
      }) => {
        'id': 'pay${payments.length + 1}-${i['id']}',
        'kind': kind,
        'method': method,
        'amountMinor': amount,
        'reference': reference,
        'note': note,
        'receivedAt': stamp,
        'recordedBy': {'memberId': 'm1', 'fullName': _me},
      };
      switch (segments[2]) {
        case 'payments':
          final amount = body!['amountMinor'] as int;
          if (balance == 0) return apiError(422, 'INVOICE_ALREADY_PAID');
          if (amount > balance) {
            return apiError(
              422,
              'PAYMENT_EXCEEDS_BALANCE',
              details: [
                {'balanceMinor': balance},
              ],
            );
          }
          payments.add(
            row(
              'PAYMENT',
              amount,
              body['method'] as String,
              reference: body['reference'] as String?,
            ),
          );
          i['paidMinor'] = paid + amount;
          return created({'payment': payments.last, 'invoice': invoiceView(i)});
        case 'cancel':
          if (!_manager) return apiError(403, 'FORBIDDEN');
          if ((i['returns'] as List).isNotEmpty) {
            return apiError(409, 'INVOICE_HAS_RETURNS');
          }
          if (paid > 0 && body!['refundMethod'] == null) {
            return apiError(
              422,
              'REFUND_METHOD_REQUIRED',
              details: [
                {'refundMinor': paid},
              ],
            );
          }
          if (paid > 0) {
            payments.add(
              row(
                'REFUND',
                paid,
                body!['refundMethod'] as String,
                note: 'Invoice cancelled',
              ),
            );
          }
          for (final l in (i['lines'] as List).cast<Map<String, dynamic>>()) {
            final p = inventory.products.firstWhere(
              (p) => p['id'] == l['productId'],
            );
            p['quantity'] = (p['quantity'] as int) + (l['quantity'] as int);
          }
          i
            ..['status'] = 'CANCELLED'
            ..['paidMinor'] = 0
            ..['cancellation'] = {
              'at': stamp,
              'by': {'memberId': 'm1', 'fullName': _me},
              'reason': body!['reason'],
            };
          return created(invoiceView(i), 200);
        case 'returns':
          if (!_manager) return apiError(403, 'FORBIDDEN');
          final lines = (i['lines'] as List).cast<Map<String, dynamic>>();
          final net = (i['subtotalMinor'] as int) - (i['discountMinor'] as int);
          final taxTotal =
              (i['tax'] as Map<String, dynamic>)['amountMinor'] as int;
          var credit = 0;
          var units = 0;
          final returned = <Map<String, dynamic>>[];
          for (final raw
              in (body!['lines'] as List).cast<Map<String, dynamic>>()) {
            final l = lines.firstWhere((l) => l['lineNo'] == raw['lineNo']);
            final qty = raw['quantity'] as int;
            if (qty > (l['quantity'] as int) - (l['returnedQuantity'] as int)) {
              return apiError(422, 'RETURN_QUANTITY_EXCEEDS_SOLD');
            }
            // Proportional share of the document's net and tax (the fake does not need the
            // backend's remainder handling; the backend's own tests cover that).
            final share = (l['lineTotalMinor'] as int) * qty;
            final subtotal = i['subtotalMinor'] as int;
            credit +=
                divRoundHalfUp(net * share, subtotal * (l['quantity'] as int)) +
                divRoundHalfUp(
                  taxTotal * share,
                  subtotal * (l['quantity'] as int),
                );
            units += qty;
            returned.add({
              'line': l,
              'qty': qty,
              'restock': raw['restock'] ?? true,
            });
          }
          final refund = credit > balance ? credit - balance : 0;
          if (refund > 0 && body['refund'] == null) {
            return apiError(
              422,
              'REFUND_METHOD_REQUIRED',
              details: [
                {'refundMinor': refund},
              ],
            );
          }
          for (final x in returned) {
            final l = x['line'] as Map<String, dynamic>;
            l['returnedQuantity'] =
                (l['returnedQuantity'] as int) + (x['qty'] as int);
            if (x['restock'] == true) {
              final p = inventory.products.firstWhere(
                (p) => p['id'] == l['productId'],
              );
              p['quantity'] = (p['quantity'] as int) + (x['qty'] as int);
            }
          }
          if (refund > 0) {
            payments.add(
              row(
                'REFUND',
                refund,
                (body['refund'] as Map<String, dynamic>)['method'] as String,
                note: 'Refund',
              ),
            );
          }
          final creditNote = {
            'id': 'r${++_credit}',
            'number': 'CN-2026-${_credit.toString().padLeft(5, '0')}',
            'reason': body['reason'],
            'subtotalMinor': credit,
            'taxMinor': 0,
            'totalMinor': credit,
            'refundMinor': refund,
            'lines': [
              for (final x in returned)
                {
                  'lineNo': (x['line'] as Map<String, dynamic>)['lineNo'],
                  'quantity': x['qty'],
                  'restock': x['restock'],
                  'amountMinor': 0,
                  'taxMinor': 0,
                },
            ],
            'createdAt': stamp,
            'units': units,
          };
          (i['returns'] as List).add(creditNote);
          i
            ..['returnedMinor'] = (i['returnedMinor'] as int) + credit
            ..['paidMinor'] = paid - refund;
          return created({'return': creditNote, 'invoice': invoiceView(i)});
      }
    }
    return null;
  }

  ResponseBody _pdf() {
    pdfRequests++;
    return ResponseBody.fromBytes(
      Uint8List.fromList(utf8.encode('%PDF-1.7 fake')),
      200,
      headers: {
        Headers.contentTypeHeader: ['application/pdf'],
      },
    );
  }
}

Handler shopHandler(FakeShopServer server) =>
    (r, body) => server.handle(r, body) ?? apiError(404, 'NOT_FOUND');
