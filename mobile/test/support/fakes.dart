import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:velora/core/auth/session.dart';

typedef Handler = FutureOr<ResponseBody> Function(
  RequestOptions request,
  Map<String, dynamic>? body,
);

/// A Dio transport that answers from a function, recording every request it receives.
class FakeAdapter implements HttpClientAdapter {
  FakeAdapter(this.handler);
  Handler handler;
  final List<RequestOptions> requests = [];

  int count(String path) => requests.where((r) => r.path == path).length;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(options);
    Map<String, dynamic>? body;
    if (requestStream != null) {
      final bytes = await requestStream.fold<List<int>>(
        [],
        (a, b) => a..addAll(b),
      );
      if (bytes.isNotEmpty) {
        body = jsonDecode(utf8.decode(bytes)) as Map<String, dynamic>;
      }
    }
    return handler(options, body);
  }

  @override
  void close({bool force = false}) {}
}

ResponseBody json(
  int status,
  Object body, {
  Map<String, List<String>> headers = const {},
}) => ResponseBody.fromString(
  jsonEncode(body),
  status,
  headers: {
    Headers.contentTypeHeader: [Headers.jsonContentType],
    ...headers,
  },
);

ResponseBody ok(Object data) => json(200, {'data': data});

ResponseBody noContent() => ResponseBody.fromString('', 204);

ResponseBody apiError(
  int status,
  String code, {
  List<Map<String, Object?>>? details,
  Map<String, List<String>> headers = const {},
}) => json(status, {
  'error': {
    'code': code,
    'message': 'server message for $code',
    'details': ?details,
    'requestId': 'req_test',
  },
}, headers: headers);

Never offline(RequestOptions request) => throw DioException.connectionError(
  requestOptions: request,
  reason: 'no route to host',
);

Map<String, dynamic> meJson({
  String role = 'MANAGER',
  String fullName = 'Maya Manager',
}) => {
  'user': {'id': 'u1', 'fullName': fullName, 'email': 'maya@velora.example'},
  'membership': {
    'memberId': 'm1',
    'role': role,
    'branchId': null,
    'organization': {'id': 'o1', 'name': 'Velora Fine Jewellery LLC'},
  },
  // The same sets the backend grants (backend/src/authz/permissions.ts).
  'permissions': [
    'product.read',
    'inventory.read',
    'customer.read',
    'customer.write',
    'sale.create',
    'document.read_own',
    'payment.record',
    'report.read_own',
    if (role != 'SALES') ...[
      'product.read_cost',
      'product.manage',
      'inventory.manage',
      'customer.archive',
      'sale.below_minimum',
      'document.read_all',
      'payment.refund',
      'invoice.cancel',
      'invoice.return',
      'report.read_all',
      'settings.read',
      'team.read',
    ],
    if (role == 'OWNER') ...['settings.manage', 'team.manage'],
  ],
  'settings': {
    'currencyCode': 'AED',
    'currencyExponent': 2,
    'timezone': 'Asia/Dubai',
    'locale': 'en',
    if (role != 'SALES') 'maxMarkupBp': 6000,
    'defaultCreditDays': 30,
    'quotationValidityDays': 14,
    'lowStockThreshold': 8,
    'allowOfflineSales': false,
    'defaultTaxRate': {
      'id': 't1',
      'name': 'VAT 5%',
      'rateBp': 500,
      'isDefault': true,
      'isActive': true,
    },
  },
};

Me me({String role = 'MANAGER'}) => Me.fromJson(meJson(role: role));
