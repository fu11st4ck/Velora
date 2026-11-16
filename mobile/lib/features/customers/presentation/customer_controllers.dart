import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/failure.dart';
import '../data/customer.dart';
import '../data/customers_api.dart';

@immutable
class CustomerList {
  const CustomerList({
    required this.items,
    required this.nextCursor,
    this.loadingMore = false,
  });
  final List<Customer> items;
  final String? nextCursor;
  final bool loadingMore;
}

/// The customer directory for one search text, loaded page by page. Keyed by the search so the
/// directory screen and the picker each keep their own results.
final customerListProvider = AsyncNotifierProvider.autoDispose
    .family<CustomerListController, CustomerList, String>(
      CustomerListController.new,
    );

class CustomerListController extends AsyncNotifier<CustomerList> {
  CustomerListController(this.search);
  final String search;

  @override
  Future<CustomerList> build() async {
    final page = await ref.watch(customersApiProvider).list(q: search);
    return CustomerList(items: page.items, nextCursor: page.nextCursor);
  }

  Future<void> loadMore() async {
    final current = state.value;
    if (current == null || current.nextCursor == null || current.loadingMore) {
      return;
    }
    state = AsyncData(
      CustomerList(
        items: current.items,
        nextCursor: current.nextCursor,
        loadingMore: true,
      ),
    );
    try {
      final page = await ref
          .read(customersApiProvider)
          .list(q: search, cursor: current.nextCursor);
      state = AsyncData(
        CustomerList(
          items: [...current.items, ...page.items],
          nextCursor: page.nextCursor,
        ),
      );
    } on Failure {
      // Keeps what is shown; scrolling again retries.
      state = AsyncData(
        CustomerList(items: current.items, nextCursor: current.nextCursor),
      );
    }
  }
}

final customerProvider = FutureProvider.autoDispose.family<Customer, String>(
  (ref, id) => ref.watch(customersApiProvider).get(id),
);

/// Call after a customer was created, edited or archived.
void refreshCustomerData(WidgetRef ref, [String? customerId]) {
  ref.invalidate(customerListProvider);
  if (customerId != null) ref.invalidate(customerProvider(customerId));
}
