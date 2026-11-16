import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api_client.dart';
import '../../../core/api/failure.dart';
import '../../../core/api/idempotency.dart';
import '../../../core/offline/local_db.dart';
import '../../../core/offline/sync_engine.dart';
import '../../products/data/offline_products_api.dart' show isUnreachable;
import 'customer.dart';
import 'customers_api.dart';

const _offlineCursor = 'offline:';

/// Customers from the server; when it cannot be reached, from the copy on this device. A customer
/// created offline is kept here and queued, and is sent when the connection returns.
class OfflineCustomersApi extends CustomersApi {
  OfflineCustomersApi(this._ref) : super(_ref.watch(dioProvider));
  final Ref _ref;

  LocalDb get _db => _ref.read(localDbProvider);
  bool get _hasCopy => _db.lastSyncedAt != null;

  @override
  Future<CustomerPage> list({String? q, String? cursor, int limit = 25}) async {
    if (cursor == null || !cursor.startsWith(_offlineCursor)) {
      try {
        return await super.list(q: q, cursor: cursor, limit: limit);
      } on Failure catch (failure) {
        if (!isUnreachable(failure) || !_hasCopy || cursor != null) rethrow;
      }
    }
    final offset = cursor == null
        ? 0
        : int.parse(cursor.substring(_offlineCursor.length));
    final rows = _db.customers(q: q, offset: offset, limit: limit + 1);
    return CustomerPage(
      items: rows.take(limit).map(Customer.fromJson).toList(),
      nextCursor: rows.length > limit
          ? '$_offlineCursor${offset + limit}'
          : null,
    );
  }

  @override
  Future<List<Customer>> findByMobile(String mobile) async {
    try {
      return await super.findByMobile(mobile);
    } on Failure catch (failure) {
      if (!isUnreachable(failure)) rethrow;
      // Best effort from the copy; the server checks again when the customer is sent.
      return _db.customersByMobile(mobile).map(Customer.fromJson).toList();
    }
  }

  @override
  Future<Customer> get(String id) async {
    try {
      return await super.get(id);
    } on Failure catch (failure) {
      final copy = isUnreachable(failure) ? _db.customer(id) : null;
      if (copy == null) rethrow;
      return Customer.fromJson(copy);
    }
  }

  @override
  Future<Customer> create(
    CustomerInput input, {
    required String idempotencyKey,
  }) async {
    try {
      return await super.create(input, idempotencyKey: idempotencyKey);
    } on Failure catch (failure) {
      if (!isUnreachable(failure)) rethrow;
    }
    // Kept on this device under an id chosen here, so a quotation made offline can refer to it.
    final json = <String, dynamic>{
      ...input.toJson(),
      'id': newIdempotencyKey(),
    };
    _db.applyCustomers([json], const [], pending: true);
    _ref
        .read(syncProvider.notifier)
        .enqueue(
          type: 'customer.create',
          path: '/customers',
          body: json,
          summary: 'New customer: ${input.name ?? input.company ?? ''}',
          idempotencyKey: idempotencyKey,
        );
    return Customer.fromJson(json);
  }
}
