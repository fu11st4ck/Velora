import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api_client.dart';
import '../../../core/api/failure.dart';
import '../../../core/offline/local_db.dart';
import 'offline_products_api.dart';
import 'product.dart';

final productsApiProvider = Provider<ProductsApi>(
  (ref) =>
      offlineProductsApi(ref.watch(dioProvider), ref.watch(localDbProvider)),
);

/// Remote data source for products and inventory (docs/api-specification.md §3.3–3.4). Throws [Failure].
class ProductsApi {
  ProductsApi(this._dio);
  final Dio _dio;

  Future<PageOf<Product>> list({
    String? q,
    StockFilter filter = StockFilter.all,
    ProductSort sort = ProductSort.name,
    bool sellable = false,
    String? cursor,
    int limit = 25,
  }) => _guard(() async {
    final res = await _dio.get<Map<String, dynamic>>(
      '/products',
      queryParameters: {
        if (q != null && q.isNotEmpty) 'q': q,
        'stockStatus': ?filter.wire,
        if (sellable) 'sellable': true,
        'sort': sort.wire,
        'limit': limit,
        'cursor': ?cursor,
      },
    );
    final meta = res.data!['meta'] as Map<String, dynamic>;
    return PageOf(
      items: (res.data!['data'] as List<dynamic>)
          .map((p) => Product.fromJson(p as Map<String, dynamic>))
          .toList(),
      nextCursor: meta['nextCursor'] as String?,
      counts: meta['counts'] == null
          ? null
          : ProductCounts.fromJson(meta['counts'] as Map<String, dynamic>),
    );
  });

  Future<Product> get(String id) => _guard(() async {
    final res = await _dio.get<Map<String, dynamic>>('/products/$id');
    return Product.fromJson(res.data!['data'] as Map<String, dynamic>);
  });

  Future<Product> create(
    NewProduct product, {
    required String idempotencyKey,
  }) => _guard(() async {
    final res = await _dio.post<Map<String, dynamic>>(
      '/products',
      data: product.toJson(),
      options: _idempotent(idempotencyKey),
    );
    return Product.fromJson(res.data!['data'] as Map<String, dynamic>);
  });

  /// [changes] holds only the fields to change; [version] is the version the edit was based on.
  Future<Product> update(
    String id, {
    required int version,
    required Map<String, dynamic> changes,
  }) => _guard(() async {
    final res = await _dio.patch<Map<String, dynamic>>(
      '/products/$id',
      data: {'version': version, ...changes},
    );
    return Product.fromJson(res.data!['data'] as Map<String, dynamic>);
  });

  Future<void> archive(String id) =>
      _guard(() => _dio.delete<void>('/products/$id'));

  Future<Product> receive({
    required String productId,
    required int quantity,
    required int unitCostMinor,
    String? supplierName,
    String? referenceNote,
    required String idempotencyKey,
  }) => _guard(() async {
    final res = await _dio.post<Map<String, dynamic>>(
      '/inventory/receipts',
      data: {
        'productId': productId,
        'quantity': quantity,
        'unitCostMinor': unitCostMinor,
        'supplierName': supplierName,
        'referenceNote': referenceNote,
      },
      options: _idempotent(idempotencyKey),
    );
    return _productOf(res);
  });

  Future<Product> adjust({
    required String productId,
    required int quantityDelta,
    required String reason,
    required String idempotencyKey,
  }) => _guard(() async {
    final res = await _dio.post<Map<String, dynamic>>(
      '/inventory/adjustments',
      data: {
        'productId': productId,
        'quantityDelta': quantityDelta,
        'reason': reason,
      },
      options: _idempotent(idempotencyKey),
    );
    return _productOf(res);
  });

  Future<PageOf<StockMovement>> movements({
    required String productId,
    List<MovementType> types = const [],
    String? cursor,
    int limit = 25,
  }) => _guard(() async {
    final res = await _dio.get<Map<String, dynamic>>(
      '/inventory/movements',
      queryParameters: {
        'productId': productId,
        if (types.isNotEmpty) 'type': types.map((t) => t.wire).join(','),
        'limit': limit,
        'cursor': ?cursor,
      },
    );
    final meta = res.data!['meta'] as Map<String, dynamic>;
    return PageOf(
      items: (res.data!['data'] as List<dynamic>)
          .map((m) => StockMovement.fromJson(m as Map<String, dynamic>))
          .toList(),
      nextCursor: meta['nextCursor'] as String?,
    );
  });

  static Options _idempotent(String key) =>
      Options(headers: {'Idempotency-Key': key});

  static Product _productOf(Response<Map<String, dynamic>> res) =>
      Product.fromJson(
        (res.data!['data'] as Map<String, dynamic>)['product']
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
