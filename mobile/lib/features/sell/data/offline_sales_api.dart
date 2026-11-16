import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api_client.dart';
import '../../../core/api/failure.dart';
import '../../../core/auth/session.dart';
import '../../../core/auth/session_controller.dart';
import '../../../core/money/money_math.dart';
import '../../../core/offline/local_db.dart';
import '../../documents/data/document.dart';
import '../../products/data/offline_products_api.dart' show isUnreachable;
import 'sales_api.dart';

/// Pricing from the server; when it cannot be reached, an estimate from this device's copy of
/// the products, using the same integer rules. Creating documents always goes to the server
/// (directly, or later through the queue), which checks everything again.
class OfflineSalesApi extends SalesApi {
  OfflineSalesApi(this._ref) : super(_ref.watch(dioProvider));
  final Ref _ref;

  LocalDb get _db => _ref.read(localDbProvider);

  @override
  Future<List<TaxRate>> taxRates() async {
    try {
      final rates = await super.taxRates();
      _db.write(
        'tax_rates',
        jsonEncode([
          for (final r in rates)
            {'id': r.id, 'name': r.name, 'rateBp': r.rateBp},
        ]),
      );
      return rates;
    } on Failure catch (failure) {
      final saved = isUnreachable(failure) ? _savedRates() : null;
      if (saved == null) rethrow;
      return saved;
    }
  }

  List<TaxRate>? _savedRates() {
    final saved = _db.read('tax_rates');
    if (saved != null) {
      return (jsonDecode(saved) as List<dynamic>)
          .map((r) => TaxRate.fromJson(r as Map<String, dynamic>))
          .toList();
    }
    final fallback = _ref.read(currentUserProvider)?.settings.defaultTaxRate;
    return fallback == null ? null : [fallback];
  }

  @override
  Future<PricePreview> preview({
    required List<SaleLine> lines,
    required int discountMinor,
    String? taxRateId,
  }) async {
    try {
      return await super.preview(
        lines: lines,
        discountMinor: discountMinor,
        taxRateId: taxRateId,
      );
    } on Failure catch (failure) {
      if (!isUnreachable(failure)) rethrow;
      final rates = _savedRates();
      final rate = rates == null || rates.isEmpty
          ? null
          : rates.firstWhere(
              (r) => r.id == taxRateId,
              orElse: () => rates.first,
            );
      if (rate == null) rethrow;
      return _estimate(lines, discountMinor, rate);
    }
  }

  PricePreview _estimate(
    List<SaleLine> lines,
    int discountMinor,
    TaxRate rate,
  ) {
    final requested = <String, int>{};
    for (final l in lines) {
      requested[l.productId] = (requested[l.productId] ?? 0) + l.quantity;
    }
    var subtotal = 0;
    final issues = <List<LineIssue>>[];
    for (final line in lines) {
      subtotal += line.unitPriceMinor * line.quantity;
      final product = _db.product(line.productId);
      if (product == null || product['isActive'] == false) {
        issues.add(const [LineIssue(code: 'PRODUCT_UNAVAILABLE')]);
        continue;
      }
      final floor = product['floorPriceMinor'] as int;
      final ceiling = product['ceilingPriceMinor'] as int;
      final available = product['quantity'] as int;
      issues.add([
        if (line.unitPriceMinor < floor && line.belowMinimumReason == null)
          LineIssue(code: 'PRICE_BELOW_MINIMUM', floorPriceMinor: floor),
        if (line.unitPriceMinor > ceiling)
          LineIssue(code: 'PRICE_ABOVE_MAXIMUM', ceilingPriceMinor: ceiling),
        if (requested[line.productId]! > available)
          LineIssue(code: 'INSUFFICIENT_STOCK', available: available),
      ]);
    }
    final taxable = subtotal - discountMinor;
    // Tax on the discounted total, rounded half up (business rules T4) — as the server does.
    final tax = taxable <= 0 ? 0 : divRoundHalfUp(taxable * rate.rateBp, 10000);
    return PricePreview(
      subtotalMinor: subtotal,
      discountMinor: discountMinor,
      tax: TaxLine(
        id: rate.id,
        name: rate.name,
        rateBp: rate.rateBp,
        amountMinor: tax,
      ),
      totalMinor: taxable + tax,
      valid: issues.every((i) => i.isEmpty),
      issues: issues,
      estimated: true,
    );
  }
}
