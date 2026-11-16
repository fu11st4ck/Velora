import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../../app/router/routes.dart';
import '../../../app/theme/tokens.dart';
import '../../../core/money/money_providers.dart';
import '../../../core/widgets/sections.dart';
import '../../../core/widgets/state_views.dart';
import '../../products/data/product.dart';
import '../../products/data/products_api.dart';
import '../../products/presentation/product_widgets.dart' show ProductThumb;
import 'cart_controller.dart';
import 'price_sheet.dart';

const _pageSize = 50;

/// Products that can be sold right now (active, in stock), for one search text.
final sellableProductsProvider = FutureProvider.autoDispose
    .family<PageOf<Product>, String>(
      (ref, search) => ref
          .watch(productsApiProvider)
          .list(q: search, sellable: true, limit: _pageSize),
    );

/// D1 Sell: pick products for the sale in progress.
class SellScreen extends ConsumerStatefulWidget {
  const SellScreen({super.key});

  @override
  ConsumerState<SellScreen> createState() => _SellScreenState();
}

class _SellScreenState extends ConsumerState<SellScreen> {
  final _search = TextEditingController();
  Timer? _debounce;
  String _query = '';

  @override
  void dispose() {
    _debounce?.cancel();
    _search.dispose();
    super.dispose();
  }

  void _onChanged(String value) {
    setState(() {});
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 300), () {
      if (mounted) setState(() => _query = value.trim());
    });
  }

  Future<void> _pick(Product product) async {
    final cart = ref.read(cartProvider);
    final choice = await showPriceSheet(
      context,
      name: product.name,
      sku: product.sku,
      listPriceMinor: product.listPriceMinor,
      floorPriceMinor: product.floorPriceMinor,
      ceilingPriceMinor: product.ceilingPriceMinor,
      costMinor: product.costMinor,
      // What is already in the cart is no longer available to add.
      maxQuantity: product.quantity - cart.unitsOf(product.id),
    );
    if (choice == null || !mounted) return;
    ref
        .read(cartProvider.notifier)
        .add(
          product,
          quantity: choice.quantity,
          unitPriceMinor: choice.unitPriceMinor,
          belowMinimumReason: choice.belowMinimumReason,
        );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final money = ref.watch(moneyFormatterProvider);
    final cart = ref.watch(cartProvider);
    final products = ref.watch(sellableProductsProvider(_query));

    return Scaffold(
      appBar: AppBar(title: const Text('New sale')),
      bottomNavigationBar: cart.isEmpty
          ? null
          : PinnedBar(
              child: Row(
                children: [
                  Expanded(
                    child: MergeSemantics(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(
                            '${cart.units} ${cart.units == 1 ? 'item' : 'items'}',
                            style: theme.textTheme.bodyMedium?.copyWith(
                              color: theme.colorScheme.onSurfaceVariant,
                            ),
                          ),
                          Text(
                            money.format(cart.subtotalMinor),
                            key: const Key('cart-subtotal'),
                            style: VeloraTokens.of(context).moneyRow,
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(width: Space.md),
                  FilledButton(
                    key: const Key('review-cart'),
                    style: FilledButton.styleFrom(
                      minimumSize: const Size(0, 52),
                    ),
                    onPressed: () => context.push(Routes.cart),
                    child: const Text('Review cart'),
                  ),
                ],
              ),
            ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(
              Space.lg,
              Space.sm,
              Space.lg,
              Space.md,
            ),
            child: TextField(
              key: const Key('sell-search'),
              controller: _search,
              onChanged: _onChanged,
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
                          _onChanged('');
                        },
                      ),
              ),
            ),
          ),
          const Divider(),
          Expanded(
            child: RefreshIndicator(
              onRefresh: () =>
                  ref.refresh(sellableProductsProvider(_query).future),
              child: AsyncValueView<PageOf<Product>>(
                value: products,
                onRetry: () => ref.invalidate(sellableProductsProvider(_query)),
                isEmpty: (page) => page.items.isEmpty,
                empty: MessageView(
                  icon: Icons.inventory_2_outlined,
                  title: _query.isEmpty
                      ? 'Nothing in stock to sell'
                      : 'No product in stock matches "$_query"',
                  body: _query.isEmpty
                      ? 'Products appear here once they have stock.'
                      : null,
                ),
                data: (page) => ListView.separated(
                  physics: const AlwaysScrollableScrollPhysics(),
                  itemCount:
                      page.items.length + (page.nextCursor != null ? 1 : 0),
                  separatorBuilder: (_, _) =>
                      const Divider(indent: Space.lg, endIndent: Space.lg),
                  itemBuilder: (context, i) {
                    if (i >= page.items.length) {
                      return Padding(
                        padding: const EdgeInsets.all(Space.lg),
                        child: Text(
                          'Showing the first $_pageSize. Search to find other products.',
                          style: theme.textTheme.bodyMedium?.copyWith(
                            color: theme.colorScheme.onSurfaceVariant,
                          ),
                          textAlign: TextAlign.center,
                        ),
                      );
                    }
                    final p = page.items[i];
                    final inCart = cart.unitsOf(p.id);
                    final left = p.quantity - inCart;
                    return InkWell(
                      key: Key('sell-${p.sku}'),
                      onTap: () => _pick(p),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(
                          horizontal: Space.lg,
                          vertical: Space.md,
                        ),
                        child: Row(
                          children: [
                            const ProductThumb(size: 48),
                            const SizedBox(width: Space.md),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    p.name,
                                    style: theme.textTheme.titleMedium,
                                  ),
                                  Text(
                                    inCart > 0
                                        ? '${p.sku} · $left available · $inCart in cart'
                                        : '${p.sku} · $left available',
                                    style: theme.textTheme.bodyMedium?.copyWith(
                                      color: theme.colorScheme.onSurfaceVariant,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            const SizedBox(width: Space.md),
                            Text(
                              money.format(p.listPriceMinor),
                              style: VeloraTokens.of(context).moneyRow,
                            ),
                          ],
                        ),
                      ),
                    );
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
