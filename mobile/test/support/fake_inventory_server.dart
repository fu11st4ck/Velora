import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:velora/core/money/money_math.dart';

import 'fakes.dart';

/// An in-memory stand-in for the products and inventory API, following the same rules as the
/// real backend (docs/api-specification.md §3.3–3.4) closely enough to drive the screens.
class FakeInventoryServer {
  FakeInventoryServer({
    this.role = 'MANAGER',
    this.threshold = 8,
    this.maxMarkupBp = 6000,
  });

  String role;
  final int threshold;
  final int maxMarkupBp;
  final List<Map<String, dynamic>> products = [];
  final List<Map<String, dynamic>> movements = [];
  final Map<String, ResponseBody Function()> _replays = {};
  final List<String> idempotencyKeys = [];
  int _seq = 0;

  /// When set, the next matching request fails this way once.
  bool failNextWithNetworkError = false;

  bool get _manager => role != 'SALES';

  Map<String, dynamic> seed({
    required String sku,
    required String name,
    int quantity = 10,
    int costMinor = 280000,
    int defaultMarkupBp = 3000,
    int minMarkupBp = 1500,
    String? barcode,
    String? weight,
    int? reorderLevel,
  }) {
    final p = <String, dynamic>{
      'id': 'p${++_seq}',
      'sku': sku,
      'barcode': barcode,
      'name': name,
      'description': null,
      'weight': weight == null ? null : {'value': weight, 'unit': 'G'},
      'quantity': quantity,
      'reorderLevel': reorderLevel,
      'costMinor': costMinor,
      'defaultMarkupBp': defaultMarkupBp,
      'minMarkupBp': minMarkupBp,
      'isActive': true,
      'archivedAt': null,
      'version': 1,
      'seq': _seq,
    };
    products.add(p);
    if (quantity > 0) _move(p, 'OPENING', quantity, costMinor);
    return p;
  }

  void seedReferenceCatalogue() {
    seed(
      sku: 'VLR-BR-001',
      name: 'Alhambra Gold Bracelet',
      quantity: 24,
      weight: '12.8',
    );
    seed(
      sku: 'VLR-BG-014',
      name: 'Classic Gold Bangle',
      quantity: 8,
      costMinor: 215000,
      minMarkupBp: 1800,
      weight: '9.4',
    );
    seed(
      sku: 'VLR-DB-008',
      name: 'Diamond Tennis Bracelet',
      quantity: 4,
      costMinor: 620000,
      defaultMarkupBp: 2800,
      weight: '7.2',
    );
    seed(
      sku: 'VLR-RC-021',
      name: 'Rose Gold Cuff',
      quantity: 17,
      costMinor: 245000,
      weight: '10.1',
    );
  }

  Map<String, dynamic> bySku(String sku) =>
      products.firstWhere((p) => p['sku'] == sku);

  void _move(
    Map<String, dynamic> p,
    String type,
    int delta,
    int unitCost, {
    String? reason,
    String? supplier,
    String? note,
  }) {
    movements.add({
      'id': 'm${movements.length + 1}',
      'productId': p['id'],
      'productName': p['name'],
      'productSku': p['sku'],
      'type': type,
      'quantityDelta': delta,
      'balanceAfter': p['quantity'],
      'unitCostMinor': unitCost,
      'invoice': null,
      'return': null,
      'supplierName': supplier,
      'referenceNote': note,
      'reason': reason,
      'createdBy': {'memberId': 'm1', 'fullName': 'Maya Manager'},
      'createdAt': DateTime.utc(
        2026,
        11,
        16,
        9,
        movements.length,
      ).toIso8601String(),
    });
  }

  String _status(Map<String, dynamic> p) {
    final qty = p['quantity'] as int;
    final eff = (p['reorderLevel'] as int?) ?? threshold;
    return qty <= 0 ? 'OUT' : (qty <= eff ? 'LOW' : 'IN_STOCK');
  }

  Map<String, dynamic> view(Map<String, dynamic> p) {
    final cost = p['costMinor'] as int;
    final def = p['defaultMarkupBp'] as int;
    final min = p['minMarkupBp'] as int;
    return {
      'id': p['id'],
      'sku': p['sku'],
      'barcode': p['barcode'],
      'name': p['name'],
      'description': p['description'],
      'weight': p['weight'],
      'imageUrl': null,
      'quantity': p['quantity'],
      'stockStatus': _status(p),
      'reorderLevel': p['reorderLevel'],
      'effectiveReorderLevel': (p['reorderLevel'] as int?) ?? threshold,
      'listPriceMinor': priceFromMarkup(cost, def),
      'floorPriceMinor': priceFromMarkup(cost, min),
      'ceilingPriceMinor': priceFromMarkup(cost, maxMarkupBp),
      if (_manager) ...{
        'costMinor': cost,
        'defaultMarkupBp': def,
        'minMarkupBp': min,
      },
      'isActive': p['isActive'],
      'archivedAt': p['archivedAt'],
      'version': p['version'],
      'createdAt': '2026-11-16T09:00:00.000Z',
      'updatedAt': '2026-11-16T09:00:00.000Z',
    };
  }

  Map<String, dynamic> _movementView(Map<String, dynamic> m) => _manager
      ? m
      : ({...m}
          ..remove('unitCostMinor')
          ..remove('supplierName'));

  /// Handles a request, or returns null when the path is not an inventory route.
  ResponseBody? handle(RequestOptions r, Map<String, dynamic>? body) {
    final path = r.path;
    if (!path.startsWith('/products') && !path.startsWith('/inventory')) {
      return null;
    }
    if (failNextWithNetworkError) {
      failNextWithNetworkError = false;
      offline(r);
    }
    final key = r.headers['Idempotency-Key'] as String?;
    if (r.method == 'POST') {
      if (key == null) return apiError(400, 'IDEMPOTENCY_KEY_REQUIRED');
      idempotencyKeys.add(key);
      final replay = _replays[key];
      if (replay != null) return replay();
    }
    if (r.method != 'GET' && !_manager) return apiError(403, 'FORBIDDEN');

    final segments = path.split('/').where((s) => s.isNotEmpty).toList();
    ResponseBody remember(ResponseBody Function() make) {
      if (key != null) _replays[key] = make;
      return make();
    }

    if (path == '/products' && r.method == 'GET') return _list(r);
    if (path == '/products' && r.method == 'POST') {
      final error = _validatePolicy(
        body!['minMarkupBp'] as int,
        body['defaultMarkupBp'] as int,
      );
      if (error != null) return error;
      final sku =
          (body['sku'] as String?) ?? 'SKU-${(100000 + _seq).toString()}';
      if (products.any(
        (p) => (p['sku'] as String).toLowerCase() == sku.toLowerCase(),
      )) {
        return apiError(409, 'SKU_TAKEN');
      }
      if (body['barcode'] != null &&
          products.any((p) => p['barcode'] == body['barcode'])) {
        return apiError(409, 'BARCODE_TAKEN');
      }
      final p = seed(
        sku: sku,
        name: body['name'] as String,
        quantity: 0,
        costMinor: body['costMinor'] as int,
        defaultMarkupBp: body['defaultMarkupBp'] as int,
        minMarkupBp: body['minMarkupBp'] as int,
        barcode: body['barcode'] as String?,
        reorderLevel: body['reorderLevel'] as int?,
      );
      p['weight'] = body['weight'];
      p['description'] = body['description'];
      final qty = body['openingQuantity'] as int;
      if (qty > 0) {
        p['quantity'] = qty;
        _move(
          p,
          'PURCHASE_RECEIPT',
          qty,
          p['costMinor'] as int,
          supplier: body['supplierName'] as String?,
        );
      }
      final snapshot = jsonEncode({'data': view(p)});
      return remember(
        () => ResponseBody.fromString(
          snapshot,
          201,
          headers: {
            Headers.contentTypeHeader: [Headers.jsonContentType],
          },
        ),
      );
    }

    if (segments.first == 'products' && segments.length == 2) {
      final p = products.where((p) => p['id'] == segments[1]).firstOrNull;
      if (p == null) return apiError(404, 'NOT_FOUND');
      switch (r.method) {
        case 'GET':
          return ok({
            ...view(p),
            'stockByBranch': [
              {
                'branchId': 'b1',
                'branchName': 'Main showroom',
                'quantity': p['quantity'],
              },
            ],
          });
        case 'PATCH':
          if (body!['version'] != p['version']) {
            return apiError(
              409,
              'VERSION_CONFLICT',
              details: [
                {'currentVersion': p['version']},
              ],
            );
          }
          final min = (body['minMarkupBp'] as int?) ?? p['minMarkupBp'] as int;
          final def =
              (body['defaultMarkupBp'] as int?) ?? p['defaultMarkupBp'] as int;
          final error = _validatePolicy(min, def);
          if (error != null) return error;
          final sku = body['sku'] as String?;
          if (sku != null &&
              products.any(
                (o) =>
                    o != p &&
                    (o['sku'] as String).toLowerCase() == sku.toLowerCase(),
              )) {
            return apiError(409, 'SKU_TAKEN');
          }
          for (final f in [
            'name',
            'sku',
            'barcode',
            'description',
            'weight',
            'defaultMarkupBp',
            'minMarkupBp',
            'reorderLevel',
          ]) {
            if (body.containsKey(f)) p[f] = body[f];
          }
          p['version'] = (p['version'] as int) + 1;
          return ok(view(p));
        case 'DELETE':
          if ((p['quantity'] as int) > 0) {
            return apiError(
              409,
              'PRODUCT_HAS_STOCK',
              details: [
                {'quantity': p['quantity']},
              ],
            );
          }
          p['archivedAt'] = '2026-11-16T10:00:00.000Z';
          p['isActive'] = false;
          return noContent();
      }
    }

    if (path == '/inventory/receipts' || path == '/inventory/adjustments') {
      final p = products
          .where((p) => p['id'] == body!['productId'])
          .firstOrNull;
      if (p == null) return apiError(404, 'NOT_FOUND');
      final onHand = p['quantity'] as int;
      if (path.endsWith('receipts')) {
        final qty = body!['quantity'] as int;
        final unit = body['unitCostMinor'] as int;
        p['costMinor'] = weightedAverageCost(
          onHand: onHand,
          currentCostMinor: p['costMinor'] as int,
          received: qty,
          receivedUnitCostMinor: unit,
        );
        p['quantity'] = onHand + qty;
        _move(
          p,
          'PURCHASE_RECEIPT',
          qty,
          unit,
          supplier: body['supplierName'] as String?,
          note: body['referenceNote'] as String?,
        );
      } else {
        final delta = body!['quantityDelta'] as int;
        if (onHand + delta < 0) {
          return apiError(
            409,
            'INSUFFICIENT_STOCK',
            details: [
              {'productId': p['id'], 'requested': -delta, 'available': onHand},
            ],
          );
        }
        p['quantity'] = onHand + delta;
        _move(
          p,
          delta > 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT',
          delta,
          p['costMinor'] as int,
          reason: body['reason'] as String?,
        );
      }
      final snapshot = jsonEncode({
        'data': {'movement': _movementView(movements.last), 'product': view(p)},
      });
      return remember(
        () => ResponseBody.fromString(
          snapshot,
          201,
          headers: {
            Headers.contentTypeHeader: [Headers.jsonContentType],
          },
        ),
      );
    }

    if (path == '/inventory/movements') {
      final types = (r.queryParameters['type'] as String?)?.split(',');
      final limit = (r.queryParameters['limit'] as int?) ?? 25;
      final offset =
          int.tryParse((r.queryParameters['cursor'] as String?) ?? '0') ?? 0;
      final all = movements.reversed
          .where(
            (m) =>
                m['productId'] == r.queryParameters['productId'] &&
                (types == null || types.contains(m['type'])),
          )
          .map(_movementView)
          .toList();
      final page = all.skip(offset).take(limit).toList();
      final next = offset + limit < all.length ? '${offset + limit}' : null;
      return json(200, {
        'data': page,
        'meta': {'nextCursor': next, 'hasMore': next != null},
      });
    }
    return apiError(404, 'NOT_FOUND');
  }

  ResponseBody? _validatePolicy(int min, int def) =>
      (min > def || def > maxMarkupBp)
      ? apiError(
          422,
          'MARKUP_POLICY_INVALID',
          details: [
            {'maxMarkupBp': maxMarkupBp},
          ],
        )
      : null;

  ResponseBody _list(RequestOptions r) {
    final q = ((r.queryParameters['q'] as String?) ?? '').toLowerCase();
    final status = r.queryParameters['stockStatus'] as String?;
    final sort = (r.queryParameters['sort'] as String?) ?? 'name';
    final limit = (r.queryParameters['limit'] as int?) ?? 25;
    final offset =
        int.tryParse((r.queryParameters['cursor'] as String?) ?? '0') ?? 0;

    final base = products
        .where((p) => p['archivedAt'] == null)
        .where(
          (p) =>
              q.isEmpty ||
              '${p['name']} ${p['sku']} ${p['barcode'] ?? ''}'
                  .toLowerCase()
                  .contains(q),
        )
        .toList();
    int count(String s) => base.where((p) => _status(p) == s).length;
    final filtered = base
        .where(
          (p) => switch (status) {
            'in_stock' => _status(p) == 'IN_STOCK',
            'low' => _status(p) == 'LOW',
            'out' => _status(p) == 'OUT',
            _ => true,
          },
        )
        .toList();
    int byName(Map<String, dynamic> a, Map<String, dynamic> b) =>
        (a['name'] as String).toLowerCase().compareTo(
          (b['name'] as String).toLowerCase(),
        );
    filtered.sort(switch (sort) {
      'quantity' => (a, b) => (a['quantity'] as int).compareTo(
        b['quantity'] as int,
      ),
      '-quantity' => (a, b) => (b['quantity'] as int).compareTo(
        a['quantity'] as int,
      ),
      '-createdAt' => (a, b) => (b['seq'] as int).compareTo(a['seq'] as int),
      _ => byName,
    });
    final page = filtered.skip(offset).take(limit).map(view).toList();
    final next = offset + limit < filtered.length ? '${offset + limit}' : null;
    return json(200, {
      'data': page,
      'meta': {
        'nextCursor': next,
        'hasMore': next != null,
        if (offset == 0)
          'counts': {
            'all': base.length,
            'inStock': count('IN_STOCK'),
            'low': count('LOW'),
            'out': count('OUT'),
          },
      },
    });
  }
}

/// A signed-in app talking to [server]: answers `/auth/me` for the server's role and delegates the rest.
Handler inventoryHandler(FakeInventoryServer server) => (r, body) {
  if (r.path == '/auth/me') return ok(meJson(role: server.role));
  return server.handle(r, body) ?? apiError(404, 'NOT_FOUND');
};
