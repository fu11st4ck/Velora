import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api_client.dart';
import '../../../core/api/failure.dart';
import 'document.dart';

final documentsApiProvider = Provider<DocumentsApi>(
  (ref) => DocumentsApi(ref.watch(dioProvider)),
);

/// Remote data source for documents, payments, cancellation and returns
/// (docs/api-specification.md §3.7–3.9). Throws [Failure].
class DocumentsApi {
  DocumentsApi(this._dio);
  final Dio _dio;

  Future<({List<DocumentSummary> items, String? nextCursor})> list({
    String? q,
    DocumentFilter filter = DocumentFilter.all,
    String? customerId,
    String? cursor,
    int limit = 25,
  }) => _guard(() async {
    final res = await _dio.get<Map<String, dynamic>>(
      '/documents',
      queryParameters: {
        if (q != null && q.isNotEmpty) 'q': q,
        'status': ?filter.status,
        'type': ?filter.type,
        'customerId': ?customerId,
        'limit': limit,
        'cursor': ?cursor,
      },
    );
    return (
      items: (res.data!['data'] as List<dynamic>)
          .map((d) => DocumentSummary.fromJson(d as Map<String, dynamic>))
          .toList(),
      nextCursor:
          (res.data!['meta'] as Map<String, dynamic>)['nextCursor'] as String?,
    );
  });

  Future<Invoice> invoice(String id) => _guard(() async {
    final res = await _dio.get<Map<String, dynamic>>('/invoices/$id');
    return Invoice.fromJson(res.data!['data'] as Map<String, dynamic>);
  });

  Future<Quotation> quotation(String id) => _guard(() async {
    final res = await _dio.get<Map<String, dynamic>>('/quotations/$id');
    return Quotation.fromJson(res.data!['data'] as Map<String, dynamic>);
  });

  Future<Quotation> cancelQuotation(String id) => _guard(() async {
    final res = await _dio.post<Map<String, dynamic>>(
      '/quotations/$id/cancel',
      data: <String, dynamic>{},
    );
    return Quotation.fromJson(res.data!['data'] as Map<String, dynamic>);
  });

  Future<Invoice> recordPayment(
    String invoiceId, {
    required int amountMinor,
    required PaymentMethod method,
    String? reference,
    required String idempotencyKey,
  }) => _guard(() async {
    final res = await _dio.post<Map<String, dynamic>>(
      '/invoices/$invoiceId/payments',
      data: {
        'amountMinor': amountMinor,
        'method': method.wire,
        'reference': reference,
      },
      options: _idempotent(idempotencyKey),
    );
    return _invoiceOf(res);
  });

  Future<Invoice> cancelInvoice(
    String invoiceId, {
    required String reason,
    PaymentMethod? refundMethod,
    required String idempotencyKey,
  }) => _guard(() async {
    final res = await _dio.post<Map<String, dynamic>>(
      '/invoices/$invoiceId/cancel',
      data: {'reason': reason, 'refundMethod': ?refundMethod?.wire},
      options: _idempotent(idempotencyKey),
    );
    return Invoice.fromJson(res.data!['data'] as Map<String, dynamic>);
  });

  /// [lines] maps an invoice line number to the quantity returned and whether it is restocked.
  Future<Invoice> createReturn(
    String invoiceId, {
    required String reason,
    required List<({int lineNo, int quantity, bool restock})> lines,
    PaymentMethod? refundMethod,
    required String idempotencyKey,
  }) => _guard(() async {
    final res = await _dio.post<Map<String, dynamic>>(
      '/invoices/$invoiceId/returns',
      data: {
        'reason': reason,
        'lines': [
          for (final l in lines)
            {'lineNo': l.lineNo, 'quantity': l.quantity, 'restock': l.restock},
        ],
        if (refundMethod != null) 'refund': {'method': refundMethod.wire},
      },
      options: _idempotent(idempotencyKey),
    );
    return _invoiceOf(res);
  });

  /// The customer-facing PDF of an invoice or quotation.
  Future<Uint8List> pdf({required bool isInvoice, required String id}) =>
      _guard(() async {
        final res = await _dio.get<List<int>>(
          '/${isInvoice ? 'invoices' : 'quotations'}/$id/pdf',
          options: Options(responseType: ResponseType.bytes),
        );
        return Uint8List.fromList(res.data!);
      });

  static Options _idempotent(String key) =>
      Options(headers: {'Idempotency-Key': key});

  static Invoice _invoiceOf(Response<Map<String, dynamic>> res) =>
      Invoice.fromJson(
        (res.data!['data'] as Map<String, dynamic>)['invoice']
            as Map<String, dynamic>,
      );

  Future<T> _guard<T>(Future<T> Function() call) async {
    try {
      return await call();
    } on DioException catch (e) {
      throw Failure.from(e);
    }
  }
}
