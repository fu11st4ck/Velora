import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/failure.dart';
import 'customer.dart';
import 'offline_customers_api.dart';

final customersApiProvider = Provider<CustomersApi>(OfflineCustomersApi.new);

/// Remote data source for customers (docs/api-specification.md §3.5). Throws [Failure].
class CustomersApi {
  CustomersApi(this._dio);
  final Dio _dio;

  Future<CustomerPage> list({String? q, String? cursor, int limit = 25}) =>
      _guard(() async {
        final res = await _dio.get<Map<String, dynamic>>(
          '/customers',
          queryParameters: {
            if (q != null && q.isNotEmpty) 'q': q,
            'limit': limit,
            'cursor': ?cursor,
          },
        );
        return _page(res);
      });

  /// Customers whose mobile number is exactly [mobile], in any spelling. Used before creating one.
  Future<List<Customer>> findByMobile(String mobile) => _guard(() async {
    final res = await _dio.get<Map<String, dynamic>>(
      '/customers',
      queryParameters: {'mobile': mobile, 'limit': 5},
    );
    return _page(res).items;
  });

  Future<Customer> get(String id) => _guard(() async {
    final res = await _dio.get<Map<String, dynamic>>('/customers/$id');
    return Customer.fromJson(res.data!['data'] as Map<String, dynamic>);
  });

  Future<Customer> create(
    CustomerInput input, {
    required String idempotencyKey,
  }) => _guard(() async {
    final res = await _dio.post<Map<String, dynamic>>(
      '/customers',
      data: input.toJson(),
      options: Options(headers: {'Idempotency-Key': idempotencyKey}),
    );
    return Customer.fromJson(res.data!['data'] as Map<String, dynamic>);
  });

  Future<Customer> update(String id, CustomerInput input) => _guard(() async {
    final res = await _dio.patch<Map<String, dynamic>>(
      '/customers/$id',
      data: input.toJson(),
    );
    return Customer.fromJson(res.data!['data'] as Map<String, dynamic>);
  });

  Future<void> archive(String id) =>
      _guard(() => _dio.delete<void>('/customers/$id'));

  static CustomerPage _page(Response<Map<String, dynamic>> res) => CustomerPage(
    items: (res.data!['data'] as List<dynamic>)
        .map((c) => Customer.fromJson(c as Map<String, dynamic>))
        .toList(),
    nextCursor:
        (res.data!['meta'] as Map<String, dynamic>)['nextCursor'] as String?,
  );

  Future<T> _guard<T>(Future<T> Function() call) async {
    try {
      return await call();
    } on DioException catch (e) {
      throw Failure.from(e);
    }
  }
}
