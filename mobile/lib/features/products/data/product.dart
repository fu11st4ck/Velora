import 'package:flutter/foundation.dart';

enum StockStatus {
  inStock,
  low,
  out;

  static StockStatus parse(String value) => switch (value) {
    'IN_STOCK' => StockStatus.inStock,
    'LOW' => StockStatus.low,
    'OUT' => StockStatus.out,
    _ => throw FormatException('Unknown stock status "$value"'),
  };

  String get label => switch (this) {
    StockStatus.inStock => 'In stock',
    StockStatus.low => 'Low stock',
    StockStatus.out => 'Out of stock',
  };
}

enum WeightUnit {
  g('G', 'g'),
  kg('KG', 'kg');

  const WeightUnit(this.wire, this.label);
  final String wire;
  final String label;

  static WeightUnit parse(String value) =>
      values.firstWhere((u) => u.wire == value);
}

@immutable
class Weight {
  const Weight({required this.value, required this.unit});

  factory Weight.fromJson(Map<String, dynamic> json) => Weight(
    value: json['value'] as String,
    unit: WeightUnit.parse(json['unit'] as String),
  );

  /// Decimal text exactly as entered (never a floating-point number).
  final String value;
  final WeightUnit unit;

  String get display => '$value ${unit.label}';
  Map<String, dynamic> toJson() => {'value': value, 'unit': unit.wire};
}

@immutable
class Product {
  const Product({
    required this.id,
    required this.sku,
    required this.name,
    required this.quantity,
    required this.stockStatus,
    required this.effectiveReorderLevel,
    required this.listPriceMinor,
    required this.floorPriceMinor,
    required this.ceilingPriceMinor,
    required this.isActive,
    required this.version,
    this.barcode,
    this.description,
    this.weight,
    this.imageUrl,
    this.reorderLevel,
    this.costMinor,
    this.defaultMarkupBp,
    this.minMarkupBp,
    this.archivedAt,
    this.stockByBranch = const [],
  });

  factory Product.fromJson(Map<String, dynamic> json) => Product(
    id: json['id'] as String,
    sku: json['sku'] as String,
    barcode: json['barcode'] as String?,
    name: json['name'] as String,
    description: json['description'] as String?,
    weight: json['weight'] == null
        ? null
        : Weight.fromJson(json['weight'] as Map<String, dynamic>),
    imageUrl: json['imageUrl'] as String?,
    quantity: json['quantity'] as int,
    stockStatus: StockStatus.parse(json['stockStatus'] as String),
    reorderLevel: json['reorderLevel'] as int?,
    effectiveReorderLevel: json['effectiveReorderLevel'] as int,
    listPriceMinor: json['listPriceMinor'] as int,
    floorPriceMinor: json['floorPriceMinor'] as int,
    ceilingPriceMinor: json['ceilingPriceMinor'] as int,
    costMinor: json['costMinor'] as int?,
    defaultMarkupBp: json['defaultMarkupBp'] as int?,
    minMarkupBp: json['minMarkupBp'] as int?,
    isActive: json['isActive'] as bool,
    archivedAt: json['archivedAt'] == null
        ? null
        : DateTime.parse(json['archivedAt'] as String),
    version: json['version'] as int,
    stockByBranch: (json['stockByBranch'] as List<dynamic>? ?? const [])
        .map((b) => BranchStock.fromJson(b as Map<String, dynamic>))
        .toList(growable: false),
  );

  final String id;
  final String sku;
  final String? barcode;
  final String name;
  final String? description;
  final Weight? weight;
  final String? imageUrl;
  final int quantity;
  final StockStatus stockStatus;
  final int? reorderLevel;
  final int effectiveReorderLevel;
  final int listPriceMinor;
  final int floorPriceMinor;
  final int ceilingPriceMinor;

  /// Present only for roles allowed to see cost; the server omits these for the sales role.
  final int? costMinor;
  final int? defaultMarkupBp;
  final int? minMarkupBp;
  final bool isActive;
  final DateTime? archivedAt;
  final int version;
  final List<BranchStock> stockByBranch;

  bool get isArchived => archivedAt != null;
}

@immutable
class BranchStock {
  const BranchStock({
    required this.branchId,
    required this.branchName,
    required this.quantity,
  });

  factory BranchStock.fromJson(Map<String, dynamic> json) => BranchStock(
    branchId: json['branchId'] as String,
    branchName: json['branchName'] as String,
    quantity: json['quantity'] as int,
  );

  final String branchId;
  final String branchName;
  final int quantity;
}

@immutable
class ProductCounts {
  const ProductCounts({
    required this.all,
    required this.inStock,
    required this.low,
    required this.out,
  });

  factory ProductCounts.fromJson(Map<String, dynamic> json) => ProductCounts(
    all: json['all'] as int,
    inStock: json['inStock'] as int,
    low: json['low'] as int,
    out: json['out'] as int,
  );

  final int all;
  final int inStock;
  final int low;
  final int out;
}

/// One page of a cursor-paginated list.
@immutable
class PageOf<T> {
  const PageOf({required this.items, required this.nextCursor, this.counts});
  final List<T> items;
  final String? nextCursor;
  final ProductCounts? counts;
}

enum StockFilter {
  all(null, 'All'),
  inStock('in_stock', 'In stock'),
  low('low', 'Low'),
  out('out', 'Out');

  const StockFilter(this.wire, this.label);
  final String? wire;
  final String label;
}

enum ProductSort {
  name('name', 'Name (A–Z)'),
  quantityAsc('quantity', 'Stock: low to high'),
  quantityDesc('-quantity', 'Stock: high to low'),
  newest('-createdAt', 'Recently added');

  const ProductSort(this.wire, this.label);
  final String wire;
  final String label;
}

enum MovementType {
  opening('OPENING', 'Opening stock'),
  purchaseReceipt('PURCHASE_RECEIPT', 'Stock received'),
  sale('SALE', 'Sale'),
  saleCancellation('SALE_CANCELLATION', 'Sale cancelled'),
  customerReturn('CUSTOMER_RETURN', 'Customer return'),
  adjustmentIn('ADJUSTMENT_IN', 'Adjustment (added)'),
  adjustmentOut('ADJUSTMENT_OUT', 'Adjustment (removed)');

  const MovementType(this.wire, this.label);
  final String wire;
  final String label;

  static MovementType parse(String value) =>
      values.firstWhere((t) => t.wire == value);
}

@immutable
class StockMovement {
  const StockMovement({
    required this.id,
    required this.type,
    required this.quantityDelta,
    required this.balanceAfter,
    required this.createdByName,
    required this.createdAt,
    this.unitCostMinor,
    this.supplierName,
    this.referenceNote,
    this.reason,
    this.documentNumber,
  });

  factory StockMovement.fromJson(Map<String, dynamic> json) {
    final invoice = json['invoice'] as Map<String, dynamic>?;
    final ret = json['return'] as Map<String, dynamic>?;
    return StockMovement(
      id: json['id'] as String,
      type: MovementType.parse(json['type'] as String),
      quantityDelta: json['quantityDelta'] as int,
      balanceAfter: json['balanceAfter'] as int,
      unitCostMinor: json['unitCostMinor'] as int?,
      supplierName: json['supplierName'] as String?,
      referenceNote: json['referenceNote'] as String?,
      reason: json['reason'] as String?,
      documentNumber: (invoice?['number'] ?? ret?['number']) as String?,
      createdByName:
          (json['createdBy'] as Map<String, dynamic>)['fullName'] as String,
      createdAt: DateTime.parse(json['createdAt'] as String),
    );
  }

  final String id;
  final MovementType type;
  final int quantityDelta;
  final int balanceAfter;
  final int? unitCostMinor;
  final String? supplierName;
  final String? referenceNote;
  final String? reason;
  final String? documentNumber;
  final String createdByName;
  final DateTime createdAt;
}

/// Input for creating a product. Amounts are minor units; markups are basis points.
@immutable
class NewProduct {
  const NewProduct({
    required this.name,
    required this.costMinor,
    required this.defaultMarkupBp,
    required this.minMarkupBp,
    required this.openingQuantity,
    this.sku,
    this.barcode,
    this.description,
    this.weight,
    this.reorderLevel,
    this.supplierName,
    this.referenceNote,
  });

  final String name;
  final String? sku;
  final String? barcode;
  final String? description;
  final Weight? weight;
  final int costMinor;
  final int defaultMarkupBp;
  final int minMarkupBp;
  final int openingQuantity;
  final int? reorderLevel;
  final String? supplierName;
  final String? referenceNote;

  Map<String, dynamic> toJson() => {
    'name': name,
    'sku': sku,
    'barcode': barcode,
    'description': description,
    'weight': weight?.toJson(),
    'costMinor': costMinor,
    'defaultMarkupBp': defaultMarkupBp,
    'minMarkupBp': minMarkupBp,
    'openingQuantity': openingQuantity,
    'reorderLevel': reorderLevel,
    'supplierName': supplierName,
    'referenceNote': referenceNote,
  };
}
