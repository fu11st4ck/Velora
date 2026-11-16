import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api_client.dart';
import '../../../core/api/failure.dart';

/// An inclusive range of business calendar days, as `YYYY-MM-DD`.
@immutable
class ReportPeriod {
  const ReportPeriod(this.from, this.to);
  final String from;
  final String to;

  @override
  bool operator ==(Object other) =>
      other is ReportPeriod && other.from == from && other.to == to;

  @override
  int get hashCode => Object.hash(from, to);
}

/// Figures for a period (docs/business-rules.md §8). Cost-based ones are null for the sales role.
@immutable
class SalesSummary {
  const SalesSummary({
    required this.invoiceCount,
    required this.invoicedMinor,
    required this.netSalesMinor,
    required this.taxMinor,
    required this.discountMinor,
    required this.returnsMinor,
    required this.receivedMinor,
    required this.outstandingNowMinor,
    required this.overdueNowMinor,
    this.cogsMinor,
    this.grossProfitMinor,
    this.marginBp,
  });

  factory SalesSummary.fromJson(Map<String, dynamic> json) => SalesSummary(
    invoiceCount: json['invoiceCount'] as int,
    invoicedMinor: json['invoicedMinor'] as int,
    netSalesMinor: json['netSalesMinor'] as int,
    taxMinor: json['taxMinor'] as int,
    discountMinor: json['discountMinor'] as int,
    returnsMinor: json['returnsMinor'] as int,
    receivedMinor: json['receivedMinor'] as int,
    outstandingNowMinor: json['outstandingNowMinor'] as int,
    overdueNowMinor: json['overdueNowMinor'] as int,
    cogsMinor: json['cogsMinor'] as int?,
    grossProfitMinor: json['grossProfitMinor'] as int?,
    marginBp: json['marginBp'] as int?,
  );

  final int invoiceCount;
  final int invoicedMinor;
  final int netSalesMinor;
  final int taxMinor;
  final int discountMinor;
  final int returnsMinor;
  final int receivedMinor;
  final int outstandingNowMinor;
  final int overdueNowMinor;
  final int? cogsMinor;
  final int? grossProfitMinor;
  final int? marginBp;
}

@immutable
class SalespersonSales {
  const SalespersonSales({
    required this.memberId,
    required this.fullName,
    required this.invoiceCount,
    required this.netSalesMinor,
    required this.grossProfitMinor,
  });

  factory SalespersonSales.fromJson(Map<String, dynamic> json) =>
      SalespersonSales(
        memberId: json['memberId'] as String,
        fullName: json['fullName'] as String,
        invoiceCount: json['invoiceCount'] as int,
        netSalesMinor: json['netSalesMinor'] as int,
        grossProfitMinor: json['grossProfitMinor'] as int,
      );

  final String memberId;
  final String fullName;
  final int invoiceCount;
  final int netSalesMinor;
  final int grossProfitMinor;
}

/// One row of the invoice status breakdown: PAID, PARTIAL, UNPAID, or OVERDUE (a subset of the
/// two before it, reported separately).
@immutable
class StatusCount {
  const StatusCount({
    required this.status,
    required this.count,
    required this.totalMinor,
    required this.balanceMinor,
  });

  factory StatusCount.fromJson(Map<String, dynamic> json) => StatusCount(
    status: json['status'] as String,
    count: json['count'] as int,
    totalMinor: json['totalMinor'] as int,
    balanceMinor: json['balanceMinor'] as int,
  );

  final String status;
  final int count;
  final int totalMinor;
  final int balanceMinor;
}

@immutable
class ValuedProduct {
  const ValuedProduct({
    required this.productId,
    required this.name,
    required this.sku,
    required this.quantity,
    required this.valueMinor,
  });

  factory ValuedProduct.fromJson(Map<String, dynamic> json) => ValuedProduct(
    productId: json['productId'] as String,
    name: json['name'] as String,
    sku: json['sku'] as String,
    quantity: json['quantity'] as int,
    valueMinor: json['valueMinor'] as int,
  );

  final String productId;
  final String name;
  final String sku;
  final int quantity;
  final int valueMinor;
}

@immutable
class Valuation {
  const Valuation({
    required this.units,
    required this.valueMinor,
    required this.productCount,
    required this.top,
  });
  final int units;
  final int valueMinor;
  final int productCount;

  /// The products holding the most value, largest first.
  final List<ValuedProduct> top;
}

/// Everything the Reports screen shows for one period. Manager-only parts are null for sales.
@immutable
class ReportData {
  const ReportData({
    required this.summary,
    required this.statuses,
    this.team,
    this.valuation,
  });
  final SalesSummary summary;
  final List<StatusCount> statuses;
  final List<SalespersonSales>? team;
  final Valuation? valuation;
}

final reportsApiProvider = Provider<ReportsApi>(
  (ref) => ReportsApi(ref.watch(dioProvider)),
);

/// Remote data source for reports (docs/api-specification.md §3.10). Throws [Failure].
class ReportsApi {
  ReportsApi(this._dio);
  final Dio _dio;

  Map<String, dynamic> _range(ReportPeriod p) => {'from': p.from, 'to': p.to};

  Future<SalesSummary> salesSummary(ReportPeriod period) => _guard(() async {
    final res = await _dio.get<Map<String, dynamic>>(
      '/reports/sales-summary',
      queryParameters: _range(period),
    );
    return SalesSummary.fromJson(res.data!['data'] as Map<String, dynamic>);
  });

  Future<List<StatusCount>> paymentStatus(ReportPeriod period) =>
      _guard(() async {
        final res = await _dio.get<Map<String, dynamic>>(
          '/reports/payment-status',
          queryParameters: _range(period),
        );
        return (res.data!['data'] as List<dynamic>)
            .map((s) => StatusCount.fromJson(s as Map<String, dynamic>))
            .toList();
      });

  Future<List<SalespersonSales>> bySalesperson(ReportPeriod period) =>
      _guard(() async {
        final res = await _dio.get<Map<String, dynamic>>(
          '/reports/sales-by-salesperson',
          queryParameters: _range(period),
        );
        return (res.data!['data'] as List<dynamic>)
            .map((s) => SalespersonSales.fromJson(s as Map<String, dynamic>))
            .toList();
      });

  Future<Valuation> valuation({int top = 5}) => _guard(() async {
    final res = await _dio.get<Map<String, dynamic>>(
      '/reports/inventory-valuation',
      queryParameters: {'limit': top},
    );
    final summary =
        (res.data!['meta'] as Map<String, dynamic>)['summary']
            as Map<String, dynamic>;
    return Valuation(
      units: summary['units'] as int,
      valueMinor: summary['valueMinor'] as int,
      productCount: summary['productCount'] as int,
      top: (res.data!['data'] as List<dynamic>)
          .map((p) => ValuedProduct.fromJson(p as Map<String, dynamic>))
          .toList(),
    );
  });

  /// One row per invoice in the period, as a CSV file (managers).
  Future<Uint8List> salesCsv(ReportPeriod period) =>
      _csv('/reports/sales-summary', _range(period));

  /// The stock valuation as a CSV file (managers).
  Future<Uint8List> valuationCsv() => _csv('/reports/inventory-valuation', {});

  Future<Uint8List> _csv(String path, Map<String, dynamic> query) =>
      _guard(() async {
        final res = await _dio.get<List<int>>(
          path,
          queryParameters: query,
          options: Options(
            responseType: ResponseType.bytes,
            headers: {'Accept': 'text/csv'},
          ),
        );
        return Uint8List.fromList(res.data!);
      });

  Future<T> _guard<T>(Future<T> Function() call) async {
    try {
      return await call();
    } on DioException catch (e) {
      throw Failure.from(e);
    }
  }
}
