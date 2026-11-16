import 'dart:convert';

import 'package:flutter/foundation.dart';

import '../../customers/data/customer.dart';
import '../../products/data/product.dart';
import 'sales_api.dart';

/// One line of the sale in progress, with the product limits needed to edit it without a round trip.
@immutable
class CartLine {
  const CartLine({
    required this.productId,
    required this.name,
    required this.sku,
    required this.quantity,
    required this.unitPriceMinor,
    required this.listPriceMinor,
    required this.floorPriceMinor,
    required this.ceilingPriceMinor,
    required this.available,
    this.costMinor,
    this.belowMinimumReason,
  });

  factory CartLine.of(
    Product product, {
    required int quantity,
    required int unitPriceMinor,
    String? belowMinimumReason,
  }) => CartLine(
    productId: product.id,
    name: product.name,
    sku: product.sku,
    quantity: quantity,
    unitPriceMinor: unitPriceMinor,
    listPriceMinor: product.listPriceMinor,
    floorPriceMinor: product.floorPriceMinor,
    ceilingPriceMinor: product.ceilingPriceMinor,
    available: product.quantity,
    costMinor: product.costMinor,
    belowMinimumReason: belowMinimumReason,
  );

  factory CartLine.fromJson(Map<String, dynamic> json) => CartLine(
    productId: json['productId'] as String,
    name: json['name'] as String,
    sku: json['sku'] as String,
    quantity: json['quantity'] as int,
    unitPriceMinor: json['unitPriceMinor'] as int,
    listPriceMinor: json['listPriceMinor'] as int,
    floorPriceMinor: json['floorPriceMinor'] as int,
    ceilingPriceMinor: json['ceilingPriceMinor'] as int,
    available: json['available'] as int,
    costMinor: json['costMinor'] as int?,
    belowMinimumReason: json['belowMinimumReason'] as String?,
  );

  final String productId;
  final String name;
  final String sku;
  final int quantity;
  final int unitPriceMinor;
  final int listPriceMinor;
  final int floorPriceMinor;
  final int ceilingPriceMinor;

  /// Stock on hand when the line was added or last checked.
  final int available;

  /// Present only for roles the server shows cost to.
  final int? costMinor;
  final String? belowMinimumReason;

  int get lineTotalMinor => unitPriceMinor * quantity;

  CartLine copyWith({
    int? quantity,
    int? unitPriceMinor,
    String? Function()? belowMinimumReason,
  }) => CartLine(
    productId: productId,
    name: name,
    sku: sku,
    quantity: quantity ?? this.quantity,
    unitPriceMinor: unitPriceMinor ?? this.unitPriceMinor,
    listPriceMinor: listPriceMinor,
    floorPriceMinor: floorPriceMinor,
    ceilingPriceMinor: ceilingPriceMinor,
    available: available,
    costMinor: costMinor,
    belowMinimumReason: belowMinimumReason == null
        ? this.belowMinimumReason
        : belowMinimumReason(),
  );

  SaleLine toSaleLine() => SaleLine(
    productId: productId,
    quantity: quantity,
    unitPriceMinor: unitPriceMinor,
    belowMinimumReason: belowMinimumReason,
  );

  Map<String, dynamic> toJson() => {
    'productId': productId,
    'name': name,
    'sku': sku,
    'quantity': quantity,
    'unitPriceMinor': unitPriceMinor,
    'listPriceMinor': listPriceMinor,
    'floorPriceMinor': floorPriceMinor,
    'ceilingPriceMinor': ceilingPriceMinor,
    'available': available,
    'costMinor': costMinor,
    'belowMinimumReason': belowMinimumReason,
  };
}

/// The customer chosen for the sale: just what the cart needs to show and send.
@immutable
class CartCustomer {
  const CartCustomer({
    required this.id,
    required this.displayName,
    this.details,
  });

  factory CartCustomer.of(Customer customer) => CartCustomer(
    id: customer.id,
    displayName: customer.displayName,
    details: [?customer.secondaryName, ?customer.mobile].join(' · '),
  );

  factory CartCustomer.fromJson(Map<String, dynamic> json) => CartCustomer(
    id: json['id'] as String,
    displayName: json['displayName'] as String,
    details: json['details'] as String?,
  );

  final String id;
  final String displayName;
  final String? details;

  Map<String, dynamic> toJson() => {
    'id': id,
    'displayName': displayName,
    'details': details,
  };
}

/// The sale in progress. Saved on the device after every change, so closing the app, switching
/// tabs or opening another screen never loses it (the reference lost it when its drawer closed).
@immutable
class Cart {
  const Cart({
    this.lines = const [],
    this.customer,
    this.discountMinor = 0,
    this.taxRateId,
    this.notes,
    this.quotationId,
    this.quotationNumber,
  });

  factory Cart.fromJson(Map<String, dynamic> json) => Cart(
    lines: (json['lines'] as List<dynamic>)
        .map((l) => CartLine.fromJson(l as Map<String, dynamic>))
        .toList(),
    customer: json['customer'] == null
        ? null
        : CartCustomer.fromJson(json['customer'] as Map<String, dynamic>),
    discountMinor: json['discountMinor'] as int? ?? 0,
    taxRateId: json['taxRateId'] as String?,
    notes: json['notes'] as String?,
    quotationId: json['quotationId'] as String?,
    quotationNumber: json['quotationNumber'] as String?,
  );

  /// Reads a saved cart; anything unreadable is treated as no cart rather than an error.
  static Cart decode(String? source) {
    if (source == null) return const Cart();
    try {
      return Cart.fromJson(jsonDecode(source) as Map<String, dynamic>);
    } on Object {
      return const Cart();
    }
  }

  final List<CartLine> lines;
  final CartCustomer? customer;
  final int discountMinor;

  /// Null means the business's default rate.
  final String? taxRateId;
  final String? notes;

  /// Set when this cart was loaded from a quotation that the invoice will convert.
  final String? quotationId;
  final String? quotationNumber;

  bool get isEmpty => lines.isEmpty;
  int get units => lines.fold(0, (sum, l) => sum + l.quantity);
  int get subtotalMinor => lines.fold(0, (sum, l) => sum + l.lineTotalMinor);

  /// Units of a product already in the cart, optionally ignoring the line being edited.
  int unitsOf(String productId, {int? exceptIndex}) {
    var total = 0;
    for (var i = 0; i < lines.length; i++) {
      if (i != exceptIndex && lines[i].productId == productId) {
        total += lines[i].quantity;
      }
    }
    return total;
  }

  Cart copyWith({
    List<CartLine>? lines,
    CartCustomer? Function()? customer,
    int? discountMinor,
    String? Function()? taxRateId,
    String? Function()? notes,
  }) => Cart(
    lines: lines ?? this.lines,
    customer: customer == null ? this.customer : customer(),
    discountMinor: discountMinor ?? this.discountMinor,
    taxRateId: taxRateId == null ? this.taxRateId : taxRateId(),
    notes: notes == null ? this.notes : notes(),
    quotationId: quotationId,
    quotationNumber: quotationNumber,
  );

  String encode() => jsonEncode({
    'lines': lines.map((l) => l.toJson()).toList(),
    'customer': customer?.toJson(),
    'discountMinor': discountMinor,
    'taxRateId': taxRateId,
    'notes': notes,
    'quotationId': quotationId,
    'quotationNumber': quotationNumber,
  });
}
