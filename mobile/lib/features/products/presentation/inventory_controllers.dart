import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/failure.dart';
import '../data/product.dart';
import '../data/products_api.dart';

@immutable
class InventoryQuery {
  const InventoryQuery({
    this.search = '',
    this.filter = StockFilter.all,
    this.sort = ProductSort.name,
  });
  final String search;
  final StockFilter filter;
  final ProductSort sort;

  InventoryQuery copyWith({
    String? search,
    StockFilter? filter,
    ProductSort? sort,
  }) => InventoryQuery(
    search: search ?? this.search,
    filter: filter ?? this.filter,
    sort: sort ?? this.sort,
  );

  bool get isFiltered => search.isNotEmpty || filter != StockFilter.all;
}

final inventoryQueryProvider =
    NotifierProvider<InventoryQueryController, InventoryQuery>(
      InventoryQueryController.new,
    );

class InventoryQueryController extends Notifier<InventoryQuery> {
  @override
  InventoryQuery build() => const InventoryQuery();

  void setSearch(String value) => state = state.copyWith(search: value.trim());
  void setFilter(StockFilter value) => state = state.copyWith(filter: value);
  void setSort(ProductSort value) => state = state.copyWith(sort: value);
  void clear() => state = InventoryQuery(sort: state.sort);
}

@immutable
class InventoryList {
  const InventoryList({
    required this.items,
    required this.nextCursor,
    required this.counts,
    this.loadingMore = false,
    this.loadMoreFailure,
  });

  final List<Product> items;
  final String? nextCursor;
  final ProductCounts? counts;
  final bool loadingMore;
  final Failure? loadMoreFailure;

  bool get hasMore => nextCursor != null;
}

final inventoryListProvider =
    AsyncNotifierProvider<InventoryListController, InventoryList>(
      InventoryListController.new,
    );

/// The inventory list for the current query, loaded page by page.
class InventoryListController extends AsyncNotifier<InventoryList> {
  @override
  Future<InventoryList> build() async {
    final query = ref.watch(inventoryQueryProvider);
    final page = await ref
        .watch(productsApiProvider)
        .list(q: query.search, filter: query.filter, sort: query.sort);
    return InventoryList(
      items: page.items,
      nextCursor: page.nextCursor,
      counts: page.counts,
    );
  }

  Future<void> loadMore() async {
    final current = state.value;
    if (current == null || !current.hasMore || current.loadingMore) return;
    final query = ref.read(inventoryQueryProvider);
    state = AsyncData(
      InventoryList(
        items: current.items,
        nextCursor: current.nextCursor,
        counts: current.counts,
        loadingMore: true,
      ),
    );
    try {
      final page = await ref
          .read(productsApiProvider)
          .list(
            q: query.search,
            filter: query.filter,
            sort: query.sort,
            cursor: current.nextCursor,
          );
      // The query may have changed while this page was loading; a newer build owns the state then.
      if (ref.read(inventoryQueryProvider) != query) return;
      state = AsyncData(
        InventoryList(
          items: [...current.items, ...page.items],
          nextCursor: page.nextCursor,
          counts: current.counts,
        ),
      );
    } on Failure catch (failure) {
      state = AsyncData(
        InventoryList(
          items: current.items,
          nextCursor: current.nextCursor,
          counts: current.counts,
          loadMoreFailure: failure,
        ),
      );
    }
  }
}

/// One product with its per-branch stock.
final productProvider = FutureProvider.autoDispose.family<Product, String>(
  (ref, id) => ref.watch(productsApiProvider).get(id),
);

/// The latest few ledger entries shown on the product screen.
final recentMovementsProvider = FutureProvider.autoDispose
    .family<List<StockMovement>, String>(
      (ref, id) async =>
          (await ref
                  .watch(productsApiProvider)
                  .movements(productId: id, limit: 5))
              .items,
    );

/// Call after any change to a product or its stock so every screen showing it reloads.
void refreshProductData(WidgetRef ref, String productId) {
  ref.invalidate(productProvider(productId));
  ref.invalidate(recentMovementsProvider(productId));
  ref.invalidate(stockHistoryProvider);
  ref.invalidate(inventoryListProvider);
}

enum HistoryFilter {
  all('All', []),
  receipts('Receipts', [MovementType.opening, MovementType.purchaseReceipt]),
  sales('Sales', [MovementType.sale, MovementType.saleCancellation]),
  returns('Returns', [MovementType.customerReturn]),
  adjustments('Adjustments', [
    MovementType.adjustmentIn,
    MovementType.adjustmentOut,
  ]);

  const HistoryFilter(this.label, this.types);
  final String label;
  final List<MovementType> types;
}

typedef HistoryKey = ({String productId, HistoryFilter filter});

@immutable
class StockHistory {
  const StockHistory({
    required this.items,
    required this.nextCursor,
    this.loadingMore = false,
  });
  final List<StockMovement> items;
  final String? nextCursor;
  final bool loadingMore;
}

final stockHistoryProvider = AsyncNotifierProvider.autoDispose
    .family<StockHistoryController, StockHistory, HistoryKey>(
      StockHistoryController.new,
    );

class StockHistoryController extends AsyncNotifier<StockHistory> {
  StockHistoryController(this.key);
  final HistoryKey key;

  @override
  Future<StockHistory> build() async {
    final page = await ref
        .watch(productsApiProvider)
        .movements(productId: key.productId, types: key.filter.types);
    return StockHistory(items: page.items, nextCursor: page.nextCursor);
  }

  Future<void> loadMore() async {
    final current = state.value;
    if (current == null || current.nextCursor == null || current.loadingMore) {
      return;
    }
    state = AsyncData(
      StockHistory(
        items: current.items,
        nextCursor: current.nextCursor,
        loadingMore: true,
      ),
    );
    try {
      final page = await ref
          .read(productsApiProvider)
          .movements(
            productId: key.productId,
            types: key.filter.types,
            cursor: current.nextCursor,
          );
      state = AsyncData(
        StockHistory(
          items: [...current.items, ...page.items],
          nextCursor: page.nextCursor,
        ),
      );
    } on Failure {
      state = AsyncData(
        StockHistory(items: current.items, nextCursor: current.nextCursor),
      );
    }
  }
}
