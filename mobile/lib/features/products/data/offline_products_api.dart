import 'package:dio/dio.dart';

import '../../../core/api/failure.dart';
import '../../../core/offline/local_db.dart';
import 'product.dart';
import 'products_api.dart';

const _offlineCursor = 'offline:';

/// True for the failures that mean "the server could not be reached".
bool isUnreachable(Object error) =>
    error is NetworkFailure || error is TimeoutFailure;

/// Products from the server; when it cannot be reached, from the copy on this device.
/// Everything that changes products or stock still needs the server.
class OfflineProductsApi extends ProductsApi {
  OfflineProductsApi(super.dio, this._db);
  final LocalDb _db;

  bool get _hasCopy => _db.lastSyncedAt != null;

  @override
  Future<PageOf<Product>> list({
    String? q,
    StockFilter filter = StockFilter.all,
    ProductSort sort = ProductSort.name,
    bool sellable = false,
    String? cursor,
    int limit = 25,
  }) async {
    // A list that started from the copy continues from the copy, so pages stay consistent.
    if (cursor == null || !cursor.startsWith(_offlineCursor)) {
      try {
        return await super.list(
          q: q,
          filter: filter,
          sort: sort,
          sellable: sellable,
          cursor: cursor,
          limit: limit,
        );
      } on Failure catch (failure) {
        if (!isUnreachable(failure) || !_hasCopy || cursor != null) rethrow;
      }
    }
    final offset = cursor == null
        ? 0
        : int.parse(cursor.substring(_offlineCursor.length));
    final rows = _db.products(
      q: q,
      status: switch (filter) {
        StockFilter.all => null,
        StockFilter.inStock => 'IN_STOCK',
        StockFilter.low => 'LOW',
        StockFilter.out => 'OUT',
      },
      sellable: sellable,
      orderBy: switch (sort) {
        ProductSort.name => 'name',
        ProductSort.quantityAsc => 'quantity',
        ProductSort.quantityDesc => 'quantity DESC',
        ProductSort.newest => 'created_at DESC',
      },
      offset: offset,
      limit: limit + 1,
    );
    final counts = _db.productCounts(q: q);
    return PageOf(
      items: rows.take(limit).map(Product.fromJson).toList(),
      nextCursor: rows.length > limit
          ? '$_offlineCursor${offset + limit}'
          : null,
      counts: ProductCounts(
        all: counts.all,
        inStock: counts.inStock,
        low: counts.low,
        out: counts.out,
      ),
    );
  }

  @override
  Future<Product> get(String id) async {
    try {
      return await super.get(id);
    } on Failure catch (failure) {
      final copy = isUnreachable(failure) ? _db.product(id) : null;
      if (copy == null) rethrow;
      return Product.fromJson(copy);
    }
  }
}

ProductsApi offlineProductsApi(Dio dio, LocalDb db) =>
    OfflineProductsApi(dio, db);
