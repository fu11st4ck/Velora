import 'dart:convert';

import 'package:dio/dio.dart';

import 'fakes.dart';

/// An in-memory stand-in for the customers API (docs/api-specification.md §3.5).
class FakeCustomerServer {
  FakeCustomerServer({this.role = 'SALES'});

  String role;
  final List<Map<String, dynamic>> customers = [];
  final Map<String, Map<String, dynamic>> summaries = {};
  final Map<String, String> _replays = {};
  int _seq = 0;

  Map<String, dynamic> seed({
    String? name,
    String? company,
    String? mobile,
    String? email,
    String? address,
    String? trn,
  }) {
    final c = <String, dynamic>{
      'id': 'c${++_seq}',
      'name': name,
      'company': company,
      'mobile': mobile,
      'email': email,
      'address': address,
      'taxRegistrationNumber': trn,
      'notes': null,
      'archivedAt': null,
      'createdAt': '2026-11-16T09:00:00.000Z',
      'updatedAt': '2026-11-16T09:00:00.000Z',
    };
    customers.add(c);
    return c;
  }

  void seedReference() {
    seed(name: 'Arjun Mehta', company: 'ABC Trading', mobile: '+971505550184');
    seed(
      name: 'Maya Farah',
      company: 'Maison Luxe',
      mobile: '+971558204412',
      email: 'maya@maisonluxe.example',
    );
    seed(name: 'Noura Al Mansoori', mobile: '+971562907218');
  }

  Map<String, dynamic> byName(String name) =>
      customers.firstWhere((c) => c['name'] == name || c['company'] == name);

  /// Mirrors the server: UAE local numbers gain +971; anything else must already be international.
  static String? normalize(String input) {
    final digits = input.replaceAll(RegExp(r'[^\d+]'), '');
    if (RegExp(r'^\+\d{8,15}$').hasMatch(digits)) return digits;
    if (RegExp(r'^0\d{9}$').hasMatch(digits)) {
      return '+971${digits.substring(1)}';
    }
    return null;
  }

  String _display(Map<String, dynamic> c) =>
      ((c['name'] ?? c['company']) as String).toLowerCase();

  ResponseBody? handle(RequestOptions r, Map<String, dynamic>? body) {
    if (!r.path.startsWith('/customers')) return null;
    final segments = r.path.split('/').where((s) => s.isNotEmpty).toList();

    if (segments.length == 1 && r.method == 'GET') {
      final q = ((r.queryParameters['q'] as String?) ?? '').toLowerCase();
      final mobile = r.queryParameters['mobile'] as String?;
      final limit = (r.queryParameters['limit'] as int?) ?? 25;
      final offset =
          int.tryParse((r.queryParameters['cursor'] as String?) ?? '0') ?? 0;
      final digits = q
          .replaceAll(RegExp(r'\D'), '')
          .replaceFirst(RegExp(r'^0+'), '');
      final all = customers.where((c) => c['archivedAt'] == null).where((c) {
        if (mobile != null) {
          return c['mobile'] != null && c['mobile'] == normalize(mobile);
        }
        if (q.isEmpty) return true;
        final text =
            '${c['name'] ?? ''} ${c['company'] ?? ''} ${c['email'] ?? ''}'
                .toLowerCase();
        return text.contains(q) ||
            (digits.length >= 3 &&
                ((c['mobile'] as String?) ?? '').contains(digits));
      }).toList()..sort((a, b) => _display(a).compareTo(_display(b)));
      final next = offset + limit < all.length ? '${offset + limit}' : null;
      return json(200, {
        'data': all.skip(offset).take(limit).toList(),
        'meta': {'nextCursor': next, 'hasMore': next != null},
      });
    }

    if (segments.length == 1 && r.method == 'POST') {
      final key = r.headers['Idempotency-Key'] as String?;
      if (key == null) return apiError(400, 'IDEMPOTENCY_KEY_REQUIRED');
      final replay = _replays[key];
      if (replay != null) return _created(replay);
      final error = _validate(body!);
      if (error != null) return error;
      final c = seed();
      // A customer created offline keeps the id its device chose.
      if (body['id'] != null) c['id'] = body['id'];
      _apply(c, body);
      return _created(_replays[key] = jsonEncode({'data': c}));
    }

    final c = customers.where((c) => c['id'] == segments[1]).firstOrNull;
    if (c == null) return apiError(404, 'NOT_FOUND');
    switch (r.method) {
      case 'GET':
        return ok({
          ...c,
          'summary':
              summaries[c['id']] ??
              {
                'invoicedMinor': 0,
                'outstandingMinor': 0,
                'overdueMinor': 0,
                'invoiceCount': 0,
                'lastInvoiceAt': null,
              },
        });
      case 'PATCH':
        final merged = {...c, ...body!};
        final error = _validate(merged);
        if (error != null) return error;
        _apply(c, body);
        return ok(c);
      case 'DELETE':
        if (role == 'SALES') return apiError(403, 'FORBIDDEN');
        c['archivedAt'] = '2026-11-16T10:00:00.000Z';
        return noContent();
    }
    return apiError(404, 'NOT_FOUND');
  }

  ResponseBody _created(String body) => ResponseBody.fromString(
    body,
    201,
    headers: {
      Headers.contentTypeHeader: [Headers.jsonContentType],
    },
  );

  ResponseBody? _validate(Map<String, dynamic> b) {
    if (b['name'] == null && b['company'] == null) {
      return apiError(
        400,
        'VALIDATION_ERROR',
        details: [
          {'field': 'name', 'rule': 'nameOrCompanyRequired'},
        ],
      );
    }
    final mobile = b['mobile'] as String?;
    if (mobile != null && normalize(mobile) == null) {
      return apiError(
        400,
        'VALIDATION_ERROR',
        details: [
          {'field': 'mobile', 'rule': 'phone'},
        ],
      );
    }
    return null;
  }

  void _apply(Map<String, dynamic> c, Map<String, dynamic> body) {
    for (final f in [
      'name',
      'company',
      'email',
      'address',
      'taxRegistrationNumber',
      'notes',
    ]) {
      if (body.containsKey(f)) c[f] = body[f];
    }
    if (body.containsKey('mobile')) {
      c['mobile'] = body['mobile'] == null
          ? null
          : normalize(body['mobile'] as String);
    }
  }
}

Handler customerHandler(FakeCustomerServer server) => (r, body) {
  if (r.path == '/auth/me') return ok(meJson(role: server.role));
  return server.handle(r, body) ?? apiError(404, 'NOT_FOUND');
};
