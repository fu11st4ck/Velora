import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../../app/router/routes.dart';
import '../../../app/theme/tokens.dart';
import '../../../core/api/failure_messages.dart';
import '../../../core/auth/session_controller.dart';
import '../../../core/money/money_providers.dart';
import '../../../core/widgets/state_views.dart';
import '../data/product.dart';
import 'inventory_controllers.dart';
import 'product_widgets.dart';

/// C1 Inventory list.
class InventoryScreen extends ConsumerStatefulWidget {
  const InventoryScreen({super.key});

  @override
  ConsumerState<InventoryScreen> createState() => _InventoryScreenState();
}

class _InventoryScreenState extends ConsumerState<InventoryScreen> {
  final _search = TextEditingController();
  final _scroll = ScrollController();
  Timer? _debounce;

  @override
  void initState() {
    super.initState();
    _search.text = ref.read(inventoryQueryProvider).search;
    _scroll.addListener(() {
      if (_scroll.position.extentAfter < 400) {
        unawaited(ref.read(inventoryListProvider.notifier).loadMore());
      }
    });
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _search.dispose();
    _scroll.dispose();
    super.dispose();
  }

  void _onSearchChanged(String value) {
    setState(() {}); // shows or hides the clear button
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 300), () {
      ref.read(inventoryQueryProvider.notifier).setSearch(value);
    });
  }

  void _clearFilters() {
    _debounce?.cancel();
    _search.clear();
    ref.read(inventoryQueryProvider.notifier).clear();
    setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final query = ref.watch(inventoryQueryProvider);
    final list = ref.watch(inventoryListProvider);
    final canManage =
        ref.watch(currentUserProvider)?.can('product.manage') ?? false;
    final counts = list.value?.counts;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Inventory'),
        actions: [
          PopupMenuButton<ProductSort>(
            tooltip: 'Sort',
            icon: const Icon(Icons.sort),
            initialValue: query.sort,
            onSelected: ref.read(inventoryQueryProvider.notifier).setSort,
            itemBuilder: (_) => [
              for (final sort in ProductSort.values)
                PopupMenuItem(value: sort, child: Text(sort.label)),
            ],
          ),
        ],
      ),
      floatingActionButton: canManage
          // Kept compact at large text sizes so it does not cover the list.
          ? MediaQuery.withClampedTextScaling(
              maxScaleFactor: 1.3,
              child: FloatingActionButton.extended(
                key: const Key('new-product'),
                onPressed: () => context.push(Routes.newProduct),
                icon: const Icon(Icons.add),
                label: const Text('New product'),
              ),
            )
          : null,
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(
              Space.lg,
              Space.sm,
              Space.lg,
              Space.sm,
            ),
            child: TextField(
              key: const Key('inventory-search'),
              controller: _search,
              onChanged: _onSearchChanged,
              textInputAction: TextInputAction.search,
              decoration: InputDecoration(
                hintText: 'Search name, SKU or barcode',
                prefixIcon: const Icon(Icons.search),
                suffixIcon: _search.text.isEmpty
                    ? null
                    : IconButton(
                        tooltip: 'Clear search',
                        icon: const Icon(Icons.close),
                        onPressed: () {
                          _search.clear();
                          _onSearchChanged('');
                        },
                      ),
              ),
            ),
          ),
          SizedBox(
            height: 56,
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: Space.lg),
              child: Row(
                children: [
                  for (final filter in StockFilter.values)
                    Builder(
                      builder: (context) {
                        final count = switch (filter) {
                          StockFilter.all => counts?.all,
                          StockFilter.inStock => counts?.inStock,
                          StockFilter.low => counts?.low,
                          StockFilter.out => counts?.out,
                        };
                        return Padding(
                          padding: const EdgeInsets.only(right: Space.sm),
                          child: Center(
                            child: FilterChip(
                              key: Key('filter-${filter.name}'),
                              label: Text(
                                count == null
                                    ? filter.label
                                    : '${filter.label} · $count',
                              ),
                              selected: query.filter == filter,
                              showCheckmark: false,
                              materialTapTargetSize:
                                  MaterialTapTargetSize.padded,
                              onSelected: (_) => ref
                                  .read(inventoryQueryProvider.notifier)
                                  .setFilter(filter),
                            ),
                          ),
                        );
                      },
                    ),
                ],
              ),
            ),
          ),
          const Divider(),
          Expanded(
            child: RefreshIndicator(
              onRefresh: () => ref.refresh(inventoryListProvider.future),
              child: AsyncValueView<InventoryList>(
                value: list,
                onRetry: () => ref.invalidate(inventoryListProvider),
                isEmpty: (data) => data.items.isEmpty,
                empty: _Scrollable(
                  child: query.isFiltered
                      ? MessageView(
                          icon: Icons.search_off,
                          title: 'No products match',
                          body: 'Try another search or filter.',
                          actionLabel: 'Clear filters',
                          onAction: _clearFilters,
                        )
                      : MessageView(
                          title: 'No products yet',
                          body: canManage
                              ? 'Add your first product to start tracking stock.'
                              : null,
                          actionLabel: canManage ? 'Add product' : null,
                          onAction: canManage
                              ? () => context.push(Routes.newProduct)
                              : null,
                        ),
                ),
                data: (data) => ListView.separated(
                  controller: _scroll,
                  physics: const AlwaysScrollableScrollPhysics(),
                  padding: const EdgeInsets.only(bottom: 96),
                  itemCount: data.items.length + 1,
                  separatorBuilder: (_, _) =>
                      const Divider(indent: Space.lg, endIndent: Space.lg),
                  itemBuilder: (context, i) {
                    if (i < data.items.length) {
                      return _ProductRow(product: data.items[i]);
                    }
                    if (data.loadMoreFailure != null) {
                      return Padding(
                        padding: const EdgeInsets.all(Space.lg),
                        child: Column(
                          children: [
                            Text(
                              describeFailure(data.loadMoreFailure!),
                              style: theme.textTheme.bodyMedium,
                            ),
                            TextButton(
                              onPressed: ref
                                  .read(inventoryListProvider.notifier)
                                  .loadMore,
                              child: const Text('Try again'),
                            ),
                          ],
                        ),
                      );
                    }
                    return data.hasMore
                        ? const Padding(
                            padding: EdgeInsets.all(Space.xl),
                            child: Center(child: CircularProgressIndicator()),
                          )
                        : const SizedBox.shrink();
                  },
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Lets pull-to-refresh work when the content is a centred message.
class _Scrollable extends StatelessWidget {
  const _Scrollable({required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) => SingleChildScrollView(
      physics: const AlwaysScrollableScrollPhysics(),
      child: SizedBox(height: constraints.maxHeight, child: child),
    ),
  );
}

class _ProductRow extends ConsumerWidget {
  const _ProductRow({required this.product});
  final Product product;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final money = ref.watch(moneyFormatterProvider);
    final muted = theme.textTheme.bodyMedium?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    final cost = product.costMinor;
    // Managers see what the item cost; sales staff see what it sells for (cost is never sent to them).
    final price = cost != null
        ? 'Cost ${money.format(cost)}'
        : 'From ${money.format(product.listPriceMinor)}';

    final stock = [
      Text(
        '${product.quantity}',
        style: VeloraTokens.of(context).moneyRow,
        semanticsLabel: '${product.quantity} in stock',
      ),
      StockPill(product.stockStatus),
    ];
    final text = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(product.name, style: theme.textTheme.titleMedium),
        Text([product.sku, ?product.weight?.display].join(' · '), style: muted),
        Text(price, style: muted),
      ],
    );
    // At large text sizes the stock figures move under the name instead of squeezing it.
    final largeText = MediaQuery.textScalerOf(context).scale(1) > 1.3;

    return InkWell(
      key: Key('product-${product.sku}'),
      onTap: () => context.push(Routes.product(product.id)),
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: Space.lg,
          vertical: Space.md,
        ),
        child: Row(
          crossAxisAlignment: largeText
              ? CrossAxisAlignment.start
              : CrossAxisAlignment.center,
          children: [
            const ProductThumb(),
            const SizedBox(width: Space.md),
            Expanded(
              child: largeText
                  ? Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        text,
                        const SizedBox(height: Space.xs),
                        Wrap(
                          spacing: Space.sm,
                          runSpacing: Space.xs,
                          crossAxisAlignment: WrapCrossAlignment.center,
                          children: stock,
                        ),
                      ],
                    )
                  : text,
            ),
            if (!largeText) ...[
              const SizedBox(width: Space.md),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  stock[0],
                  const SizedBox(height: Space.xs),
                  stock[1],
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}
