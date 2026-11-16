import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api_client.dart';
import '../../../core/api/failure.dart';
import '../../documents/data/document.dart';

@immutable
class AttentionProduct {
  const AttentionProduct({
    required this.id,
    required this.name,
    required this.sku,
    required this.quantity,
    required this.isOut,
  });

  factory AttentionProduct.fromJson(Map<String, dynamic> json) =>
      AttentionProduct(
        id: json['id'] as String,
        name: json['name'] as String,
        sku: json['sku'] as String,
        quantity: json['quantity'] as int,
        isOut: json['stockStatus'] == 'OUT',
      );

  final String id;
  final String name;
  final String sku;
  final int quantity;
  final bool isOut;
}

/// `GET /dashboard/summary`. Cost-based figures are null for the sales role: the server omits them.
@immutable
class Dashboard {
  const Dashboard({
    required this.asOf,
    required this.todayInvoicedMinor,
    required this.todayInvoiceCount,
    required this.changeBp,
    required this.stockUnits,
    required this.productCount,
    required this.lowCount,
    required this.outCount,
    required this.outstandingMinor,
    required this.outstandingCount,
    required this.overdueMinor,
    required this.overdueCount,
    required this.monthNetSalesMinor,
    required this.monthGrossProfitMinor,
    required this.monthMarginBp,
    required this.inventoryValueMinor,
    required this.attentionProducts,
    required this.recentDocuments,
  });

  factory Dashboard.fromJson(Map<String, dynamic> json) {
    final today = json['todaySales'] as Map<String, dynamic>;
    final stock = json['stock'] as Map<String, dynamic>;
    final outstanding = json['outstanding'] as Map<String, dynamic>;
    final month = json['monthProfit'] as Map<String, dynamic>?;
    return Dashboard(
      asOf: DateTime.parse(json['asOf'] as String),
      todayInvoicedMinor: today['invoicedMinor'] as int,
      todayInvoiceCount: today['invoiceCount'] as int,
      changeBp: today['changeBp'] as int?,
      stockUnits: stock['units'] as int,
      productCount: stock['productCount'] as int,
      lowCount: stock['lowCount'] as int,
      outCount: stock['outCount'] as int,
      outstandingMinor: outstanding['balanceMinor'] as int,
      outstandingCount: outstanding['invoiceCount'] as int,
      overdueMinor: outstanding['overdueMinor'] as int,
      overdueCount: outstanding['overdueCount'] as int,
      monthNetSalesMinor: month?['netSalesMinor'] as int?,
      monthGrossProfitMinor: month?['grossProfitMinor'] as int?,
      monthMarginBp: month?['marginBp'] as int?,
      inventoryValueMinor: json['inventoryValueMinor'] as int?,
      attentionProducts: (json['attentionProducts'] as List<dynamic>)
          .map((p) => AttentionProduct.fromJson(p as Map<String, dynamic>))
          .toList(),
      recentDocuments: (json['recentDocuments'] as List<dynamic>)
          .map((d) => DocumentSummary.fromJson(d as Map<String, dynamic>))
          .toList(),
    );
  }

  final DateTime asOf;
  final int todayInvoicedMinor;
  final int todayInvoiceCount;

  /// Change against yesterday's full day; null when yesterday had no sales.
  final int? changeBp;
  final int stockUnits;
  final int productCount;
  final int lowCount;
  final int outCount;
  final int outstandingMinor;
  final int outstandingCount;
  final int overdueMinor;
  final int overdueCount;
  final int? monthNetSalesMinor;
  final int? monthGrossProfitMinor;
  final int? monthMarginBp;
  final int? inventoryValueMinor;
  final List<AttentionProduct> attentionProducts;
  final List<DocumentSummary> recentDocuments;

  bool get showsProfit => monthGrossProfitMinor != null;
}

final dashboardProvider = FutureProvider.autoDispose<Dashboard>((ref) async {
  try {
    final res = await ref
        .watch(dioProvider)
        .get<Map<String, dynamic>>('/dashboard/summary');
    return Dashboard.fromJson(res.data!['data'] as Map<String, dynamic>);
  } on DioException catch (e) {
    throw Failure.from(e);
  }
});
