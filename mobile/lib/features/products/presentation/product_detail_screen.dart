import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../../app/router/routes.dart';
import '../../../app/theme/tokens.dart';
import '../../../core/api/failure.dart';
import '../../../core/api/failure_messages.dart';
import '../../../core/auth/session_controller.dart';
import '../../../core/money/money_format.dart';
import '../../../core/money/money_providers.dart';
import '../../../core/widgets/state_views.dart';
import '../data/product.dart';
import '../data/products_api.dart';
import 'inventory_controllers.dart';
import 'product_widgets.dart';

enum _Action { edit, archive }

/// C2 Product detail.
class ProductDetailScreen extends ConsumerWidget {
  const ProductDetailScreen({super.key, required this.productId});
  final String productId;

  Future<void> _archive(
    BuildContext context,
    WidgetRef ref,
    Product product,
  ) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Archive this product?'),
        content: Text(
          '${product.name} will be hidden from inventory and can no longer be sold. '
          'Its history and past documents are kept.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          TextButton(
            key: const Key('confirm-archive'),
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Archive'),
          ),
        ],
      ),
    );
    if (confirmed != true || !context.mounted) return;
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref.read(productsApiProvider).archive(product.id);
      ref.invalidate(inventoryListProvider);
      messenger.showSnackBar(
        SnackBar(content: Text('${product.name} archived')),
      );
      if (context.mounted) context.pop();
    } on Failure catch (failure) {
      messenger.showSnackBar(SnackBar(content: Text(describeFailure(failure))));
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final product = ref.watch(productProvider(productId));
    final canManage =
        ref.watch(currentUserProvider)?.can('product.manage') ?? false;
    final loaded = product.value;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Product'),
        actions: [
          if (canManage && loaded != null && !loaded.isArchived)
            PopupMenuButton<_Action>(
              key: const Key('product-menu'),
              tooltip: 'More actions',
              onSelected: (action) => switch (action) {
                _Action.edit => context.push(Routes.editProduct(productId)),
                _Action.archive => _archive(context, ref, loaded),
              },
              itemBuilder: (_) => const [
                PopupMenuItem(value: _Action.edit, child: Text('Edit product')),
                PopupMenuItem(
                  value: _Action.archive,
                  child: Text('Archive product'),
                ),
              ],
            ),
        ],
      ),
      bottomNavigationBar: canManage && loaded != null && !loaded.isArchived
          ? PinnedBar(
              child: Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      key: const Key('adjust-stock'),
                      onPressed: () =>
                          context.push(Routes.adjustStock(productId)),
                      child: const Text('Adjust stock'),
                    ),
                  ),
                  const SizedBox(width: Space.md),
                  Expanded(
                    child: FilledButton(
                      key: const Key('receive-stock'),
                      onPressed: () =>
                          context.push(Routes.receiveStock(productId)),
                      child: const Text('Receive stock'),
                    ),
                  ),
                ],
              ),
            )
          : null,
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(recentMovementsProvider(productId));
          final _ = await ref.refresh(productProvider(productId).future);
        },
        child: AsyncValueView<Product>(
          value: product,
          onRetry: () => ref.invalidate(productProvider(productId)),
          data: (p) => _Body(product: p),
        ),
      ),
    );
  }
}

class _Body extends ConsumerWidget {
  const _Body({required this.product});
  final Product product;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final money = ref.watch(moneyFormatterProvider);
    final movements = ref.watch(recentMovementsProvider(product.id));
    final muted = theme.textTheme.bodyMedium?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    final cost = product.costMinor;

    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.all(Space.lg),
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const ProductThumb(size: 72),
            const SizedBox(width: Space.lg),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Semantics(
                    header: true,
                    child: Text(
                      product.name,
                      style: theme.textTheme.headlineMedium,
                    ),
                  ),
                  const SizedBox(height: Space.xs),
                  Text(
                    [product.sku, ?product.weight?.display].join(' · '),
                    style: muted,
                  ),
                  if (product.barcode != null)
                    Text('Barcode ${product.barcode}', style: muted),
                ],
              ),
            ),
          ],
        ),
        if (product.description != null) ...[
          const SizedBox(height: Space.md),
          Text(product.description!, style: theme.textTheme.bodyLarge),
        ],
        const SizedBox(height: Space.lg),
        SectionCard(
          title: 'Stock',
          trailing: product.isArchived
              ? const StockPillArchived()
              : StockPill(product.stockStatus),
          children: [
            FactRow(
              label: 'On hand',
              value: '${product.quantity} pcs',
              emphasize: true,
            ),
            if (product.stockByBranch.length > 1)
              for (final b in product.stockByBranch)
                FactRow(label: b.branchName, value: '${b.quantity} pcs'),
            FactRow(
              label: 'Low-stock level',
              value: product.reorderLevel == null
                  ? '${product.effectiveReorderLevel} pcs (business default)'
                  : '${product.effectiveReorderLevel} pcs',
            ),
          ],
        ),
        const SizedBox(height: Space.lg),
        SectionCard(
          title: 'Pricing',
          children: [
            if (cost != null)
              FactRow(
                label: 'Cost',
                value: money.format(cost),
                emphasize: true,
              ),
            if (product.defaultMarkupBp != null)
              FactRow(
                label: 'Default markup',
                value: formatBasisPoints(product.defaultMarkupBp!),
              ),
            if (product.minMarkupBp != null)
              FactRow(
                label: 'Minimum markup',
                value: formatBasisPoints(product.minMarkupBp!),
              ),
            FactRow(
              label: 'List price',
              value: money.format(product.listPriceMinor),
              emphasize: cost == null,
            ),
            FactRow(
              label: 'Lowest price',
              value: money.format(product.floorPriceMinor),
            ),
            if (cost != null && product.quantity > 0)
              FactRow(
                label: 'Stock value at cost',
                value: money.format(cost * product.quantity),
              ),
          ],
        ),
        const SizedBox(height: Space.lg),
        SectionCard(
          title: 'Recent stock movements',
          trailing: TextButton(
            key: const Key('view-history'),
            onPressed: () => context.push(Routes.stockHistory(product.id)),
            child: const Text('View all'),
          ),
          children: [
            switch (movements) {
              AsyncData(:final value) when value.isEmpty => Padding(
                padding: const EdgeInsets.symmetric(vertical: Space.md),
                child: Text('No stock movements yet.', style: muted),
              ),
              AsyncData(:final value) => Column(
                children: [
                  for (final (i, m) in value.indexed) ...[
                    if (i > 0) const Divider(),
                    MovementTile(
                      movement: m,
                      costText: m.unitCostMinor == null
                          ? null
                          : money.format(m.unitCostMinor!),
                    ),
                  ],
                ],
              ),
              AsyncError(:final error) => Padding(
                padding: const EdgeInsets.symmetric(vertical: Space.md),
                child: Text(describeFailure(Failure.from(error)), style: muted),
              ),
              _ => const Padding(
                padding: EdgeInsets.all(Space.lg),
                child: Center(child: CircularProgressIndicator()),
              ),
            },
          ],
        ),
      ],
    );
  }
}

class StockPillArchived extends StatelessWidget {
  const StockPillArchived({super.key});

  @override
  Widget build(BuildContext context) {
    final colors = VeloraTokens.of(context).neutral;
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: Space.md,
        vertical: Space.xs,
      ),
      decoration: BoxDecoration(
        color: colors.background,
        borderRadius: BorderRadius.circular(100),
      ),
      child: Text(
        'Archived',
        style: Theme.of(context).textTheme.labelMedium
            ?.copyWith(color: colors.foreground),
      ),
    );
  }
}
