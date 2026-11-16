import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api_client.dart';
import '../../../core/api/failure.dart';
import '../../../core/auth/session.dart';
import '../../documents/data/document.dart';

final salesApiProvider = Provider<SalesApi>(
  (ref) => SalesApi(ref.watch(dioProvider)),
);

/// The tax rates a sale can use, default first.
final taxRatesProvider = FutureProvider.autoDispose<List<TaxRate>>(
  (ref) => ref.watch(salesApiProvider).taxRates(),
);

/// One line as sent to the server: what is sold, how many, and at what price.
@immutable
class SaleLine {
  const SaleLine({
    required this.productId,
    required this.quantity,
    required this.unitPriceMinor,
    this.belowMinimumReason,
  });
  final String productId;
  final int quantity;
  final int unitPriceMinor;
  final String? belowMinimumReason;

  Map<String, dynamic> toJson() => {
    'productId': productId,
    'quantity': quantity,
    'unitPriceMinor': unitPriceMinor,
    'belowMinimumReason': ?belowMinimumReason,
  };
}

/// A problem the server found with one cart line.
@immutable
class LineIssue {
  const LineIssue({
    required this.code,
    this.floorPriceMinor,
    this.ceilingPriceMinor,
    this.available,
  });

  factory LineIssue.fromJson(Map<String, dynamic> json) => LineIssue(
    code: json['code'] as String,
    floorPriceMinor: json['floorPriceMinor'] as int?,
    ceilingPriceMinor: json['ceilingPriceMinor'] as int?,
    available: json['available'] as int?,
  );

  final String code;
  final int? floorPriceMinor;
  final int? ceilingPriceMinor;
  final int? available;
}

/// The server's totals for a cart, plus any problem per line (same order as the lines sent).
@immutable
class PricePreview {
  const PricePreview({
    required this.subtotalMinor,
    required this.discountMinor,
    required this.tax,
    required this.totalMinor,
    required this.valid,
    required this.issues,
  });

  factory PricePreview.fromJson(Map<String, dynamic> json) => PricePreview(
    subtotalMinor: json['subtotalMinor'] as int,
    discountMinor: json['discountMinor'] as int,
    tax: TaxLine.fromJson(json['tax'] as Map<String, dynamic>),
    totalMinor: json['totalMinor'] as int,
    valid: json['valid'] as bool,
    issues: [
      for (final l in json['lines'] as List<dynamic>)
        ((l as Map<String, dynamic>)['issues'] as List<dynamic>)
            .map((i) => LineIssue.fromJson(i as Map<String, dynamic>))
            .toList(),
    ],
  );

  final int subtotalMinor;
  final int discountMinor;
  final TaxLine tax;
  final int totalMinor;
  final bool valid;
  final List<List<LineIssue>> issues;
}

/// Remote data source for pricing and issuing documents (docs/api-specification.md §3.6, 3.8, 3.9).
class SalesApi {
  SalesApi(this._dio);
  final Dio _dio;

  Future<List<TaxRate>> taxRates() => _guard(() async {
    final res = await _dio.get<Map<String, dynamic>>('/tax-rates');
    return (res.data!['data'] as List<dynamic>)
        .map((r) => TaxRate.fromJson(r as Map<String, dynamic>))
        .toList();
  });

  Future<PricePreview> preview({
    required List<SaleLine> lines,
    required int discountMinor,
    String? taxRateId,
  }) => _guard(() async {
    final res = await _dio.post<Map<String, dynamic>>(
      '/pricing/preview',
      data: {
        'lines': lines.map((l) => l.toJson()).toList(),
        'discountMinor': discountMinor,
        'taxRateId': ?taxRateId,
      },
    );
    return PricePreview.fromJson(res.data!['data'] as Map<String, dynamic>);
  });

  Future<Quotation> createQuotation({
    required String customerId,
    required List<SaleLine> lines,
    required int discountMinor,
    String? taxRateId,
    String? notes,
    required String idempotencyKey,
  }) => _guard(() async {
    final res = await _dio.post<Map<String, dynamic>>(
      '/quotations',
      data: {
        'customerId': customerId,
        'lines': lines.map((l) => l.toJson()).toList(),
        'discountMinor': discountMinor,
        'taxRateId': ?taxRateId,
        'notes': notes,
      },
      options: Options(headers: {'Idempotency-Key': idempotencyKey}),
    );
    return Quotation.fromJson(res.data!['data'] as Map<String, dynamic>);
  });

  Future<Invoice> createInvoice({
    required String customerId,
    required List<SaleLine> lines,
    required int discountMinor,
    String? taxRateId,
    String? notes,
    String? quotationId,
    int? receivedMinor,
    PaymentMethod? method,
    String? reference,
    int? creditDays,
    required String idempotencyKey,
  }) => _guard(() async {
    final res = await _dio.post<Map<String, dynamic>>(
      '/invoices',
      data: {
        'customerId': customerId,
        'quotationId': ?quotationId,
        'lines': lines.map((l) => l.toJson()).toList(),
        'discountMinor': discountMinor,
        'taxRateId': ?taxRateId,
        'notes': notes,
        if (receivedMinor != null && receivedMinor > 0)
          'payment': {
            'amountMinor': receivedMinor,
            'method': method!.wire,
            'reference': reference,
          },
        'creditDays': ?creditDays,
      },
      options: Options(headers: {'Idempotency-Key': idempotencyKey}),
    );
    return Invoice.fromJson(res.data!['data'] as Map<String, dynamic>);
  });

  Future<T> _guard<T>(Future<T> Function() call) async {
    try {
      return await call();
    } on DioException catch (e) {
      throw Failure.from(e);
    }
  }
}
