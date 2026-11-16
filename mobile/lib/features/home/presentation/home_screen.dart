import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../../app/router/routes.dart';
import '../../../app/theme/tokens.dart';
import '../../../core/auth/session_controller.dart';
import '../../../core/money/money_format.dart';
import '../../../core/money/money_providers.dart';
import '../../../core/time/clock.dart';
import '../../../core/widgets/sections.dart';
import '../../../core/widgets/state_views.dart';
import '../../documents/data/document.dart';
import '../../documents/presentation/document_controllers.dart';
import '../../documents/presentation/documents_screen.dart' show DocumentTile;
import '../../products/data/product.dart';
import '../../products/presentation/inventory_controllers.dart';
import '../data/dashboard.dart';

/// B1 Home: today's figures, what needs attention and the latest documents.
class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  static String greeting(DateTime now) {
    if (now.hour < 12) return 'Good morning';
    if (now.hour < 18) return 'Good afternoon';
    return 'Good evening';
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final me = ref.watch(currentUserProvider);
    if (me == null) return const SizedBox.shrink();
    final theme = Theme.of(context);
    final tokens = VeloraTokens.of(context);
    final dashboard = ref.watch(dashboardProvider);

    return Scaffold(
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: () => ref.refresh(dashboardProvider.future),
          child: CustomScrollView(
            physics: const AlwaysScrollableScrollPhysics(),
            slivers: [
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(
                  Space.lg,
                  Space.xl,
                  Space.lg,
                  Space.lg,
                ),
                sliver: SliverToBoxAdapter(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        me.organizationName.toUpperCase(),
                        style: tokens.overline,
                      ),
                      const SizedBox(height: Space.xs),
                      Semantics(
                        header: true,
                        child: Text(
                          '${greeting(ref.watch(clockProvider)())}, ${me.firstName}',
                          style: theme.textTheme.headlineMedium,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              switch (dashboard) {
                AsyncData(:final value) => SliverPadding(
                  padding: const EdgeInsets.fromLTRB(
                    Space.lg,
                    0,
                    Space.lg,
                    Space.xxl,
                  ),
                  sliver: SliverToBoxAdapter(
                    child: _Dashboard(
                      data: value,
                      canManageProducts: me.can('product.manage'),
                    ),
                  ),
                ),
                _ => SliverFillRemaining(
                  hasScrollBody: false,
                  child: AsyncValueView<Dashboard>(
                    value: dashboard,
                    onRetry: () => ref.invalidate(dashboardProvider),
                    data: (_) => const SizedBox.shrink(),
                  ),
                ),
              },
            ],
          ),
        ),
      ),
    );
  }
}

class _Dashboard extends ConsumerWidget {
  const _Dashboard({required this.data, required this.canManageProducts});
  final Dashboard data;
  final bool canManageProducts;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final money = ref.watch(moneyFormatterProvider);
    final d = data;
    final danger = VeloraTokens.of(context).status(StatusTone.danger);

    final invoices =
        '${d.todayInvoiceCount} ${d.todayInvoiceCount == 1 ? 'invoice' : 'invoices'}';
    final change = switch (d.changeBp) {
      null => null,
      0 => 'Same as yesterday',
      final bp when bp > 0 => 'Up ${formatBasisPoints(bp)} on yesterday',
      final bp => 'Down ${formatBasisPoints(-bp)} on yesterday',
    };

    final tiles = [
      _Kpi(
        key: const Key('kpi-today'),
        label: "Today's sales",
        value: money.format(d.todayInvoicedMinor),
        lines: [invoices, ?change],
      ),
      _Kpi(
        key: const Key('kpi-outstanding'),
        label: 'Outstanding',
        value: money.format(d.outstandingMinor),
        lines: [
          '${d.outstandingCount} ${d.outstandingCount == 1 ? 'invoice' : 'invoices'}',
        ],
        alert: d.overdueMinor > 0
            ? 'Overdue ${money.format(d.overdueMinor)}'
            : null,
      ),
      _Kpi(
        key: const Key('kpi-stock'),
        label: 'In stock',
        value: '${d.stockUnits} pcs',
        lines: [
          '${d.productCount} ${d.productCount == 1 ? 'product' : 'products'}',
        ],
      ),
      if (d.showsProfit)
        _Kpi(
          key: const Key('kpi-profit'),
          label: "This month's profit",
          value: money.format(d.monthGrossProfitMinor!),
          lines: [
            d.monthMarginBp == null
                ? 'No sales yet this month'
                : 'Margin ${formatBasisPoints(d.monthMarginBp!)}',
          ],
        )
      else
        const _Kpi(
          key: Key('kpi-profit'),
          label: "This month's profit",
          value: null,
          lines: ['Shown to managers'],
        ),
    ];

    final attention = [
      if (d.outCount > 0)
        _AttentionRow(
          key: const Key('attention-out'),
          icon: Icons.remove_shopping_cart_outlined,
          text:
              '${d.outCount} ${d.outCount == 1 ? 'product is' : 'products are'} out of stock',
          onTap: () => _openInventory(context, ref, StockFilter.out),
        ),
      if (d.lowCount > 0)
        _AttentionRow(
          key: const Key('attention-low'),
          icon: Icons.inventory_2_outlined,
          text:
              '${d.lowCount} ${d.lowCount == 1 ? 'product is' : 'products are'} low in stock',
          onTap: () => _openInventory(context, ref, StockFilter.low),
        ),
      if (d.overdueCount > 0)
        _AttentionRow(
          key: const Key('attention-overdue'),
          icon: Icons.schedule,
          text:
              '${d.overdueCount} ${d.overdueCount == 1 ? 'invoice' : 'invoices'} overdue · ${money.format(d.overdueMinor)}',
          color: danger.foreground,
          onTap: () {
            ref
                .read(documentFilterRequestProvider.notifier)
                .request(DocumentFilter.overdue);
            context.go(Routes.documents);
          },
        ),
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        LayoutBuilder(
          builder: (context, constraints) {
            // Two columns on a phone, four on a tablet, one when the text is very large.
            final scale = MediaQuery.textScalerOf(context).scale(1);
            final columns = constraints.maxWidth >= 720
                ? 4
                : scale > 1.5
                ? 1
                : 2;
            // Tiles in a row share the height of the tallest one.
            return Column(
              children: [
                for (var i = 0; i < tiles.length; i += columns) ...[
                  if (i > 0) const SizedBox(height: Space.md),
                  IntrinsicHeight(
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        for (var j = i; j < i + columns; j++) ...[
                          if (j > i) const SizedBox(width: Space.md),
                          Expanded(
                            child: j < tiles.length
                                ? tiles[j]
                                : const SizedBox.shrink(),
                          ),
                        ],
                      ],
                    ),
                  ),
                ],
              ],
            );
          },
        ),
        if (d.inventoryValueMinor != null) ...[
          const SizedBox(height: Space.md),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(Space.lg),
              child: FactRow(
                key: const Key('inventory-value'),
                label: 'Inventory value at cost',
                value: money.format(d.inventoryValueMinor!),
                emphasize: true,
              ),
            ),
          ),
        ],
        if (d.productCount == 0 && canManageProducts) ...[
          const SizedBox(height: Space.lg),
          Card(
            clipBehavior: Clip.antiAlias,
            child: ListTile(
              key: const Key('add-first-product'),
              leading: const Icon(Icons.add_box_outlined),
              title: const Text('Add your first product'),
              subtitle: const Text(
                'Products and their stock are the start of every sale.',
              ),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => context.go(Routes.newProduct),
            ),
          ),
        ],
        if (attention.isNotEmpty) ...[
          const SizedBox(height: Space.lg),
          Card(
            clipBehavior: Clip.antiAlias,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(
                    Space.lg,
                    Space.lg,
                    Space.lg,
                    Space.xs,
                  ),
                  child: Semantics(
                    header: true,
                    child: Text(
                      'Needs attention',
                      style: theme.textTheme.titleLarge,
                    ),
                  ),
                ),
                ...attention,
                const SizedBox(height: Space.sm),
              ],
            ),
          ),
        ],
        const SizedBox(height: Space.lg),
        Card(
          clipBehavior: Clip.antiAlias,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(
                  Space.lg,
                  Space.sm,
                  Space.sm,
                  0,
                ),
                child: Row(
                  children: [
                    Expanded(
                      child: Semantics(
                        header: true,
                        child: Text(
                          'Recent documents',
                          style: theme.textTheme.titleLarge,
                        ),
                      ),
                    ),
                    TextButton(
                      key: const Key('view-all-documents'),
                      onPressed: () => context.go(Routes.documents),
                      child: const Text('View all'),
                    ),
                  ],
                ),
              ),
              if (d.recentDocuments.isEmpty)
                Padding(
                  padding: const EdgeInsets.fromLTRB(
                    Space.lg,
                    Space.sm,
                    Space.lg,
                    Space.lg,
                  ),
                  child: Text(
                    'Quotations and invoices appear here once you make a sale.',
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                )
              else
                for (final (i, doc) in d.recentDocuments.indexed) ...[
                  if (i > 0)
                    const Divider(indent: Space.lg, endIndent: Space.lg),
                  DocumentTile(document: doc),
                ],
            ],
          ),
        ),
      ],
    );
  }

  void _openInventory(BuildContext context, WidgetRef ref, StockFilter filter) {
    ref.read(inventoryQueryProvider.notifier)
      ..clear()
      ..setFilter(filter);
    context.go(Routes.inventory);
  }
}

/// One headline figure. [value] null means the figure is not shown to this role.
class _Kpi extends StatelessWidget {
  const _Kpi({
    super.key,
    required this.label,
    required this.value,
    required this.lines,
    this.alert,
  });
  final String label;
  final String? value;
  final List<String> lines;
  final String? alert;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final tokens = VeloraTokens.of(context);
    final muted = theme.textTheme.bodySmall?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(Space.lg),
        child: MergeSemantics(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label.toUpperCase(), style: tokens.overline),
              const SizedBox(height: Space.sm),
              if (value == null)
                Icon(
                  Icons.lock_outline,
                  color: theme.colorScheme.onSurfaceVariant,
                  semanticLabel: 'Hidden',
                )
              else
                // Amounts stay on one line and shrink rather than wrap mid-number.
                FittedBox(
                  fit: BoxFit.scaleDown,
                  alignment: AlignmentDirectional.centerStart,
                  child: Text(value!, style: tokens.moneyRow),
                ),
              const SizedBox(height: Space.xs),
              for (final line in lines) Text(line, style: muted),
              if (alert != null)
                Text(
                  alert!,
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: tokens.status(StatusTone.danger).foreground,
                    fontWeight: FontWeight.w600,
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _AttentionRow extends StatelessWidget {
  const _AttentionRow({
    super.key,
    required this.icon,
    required this.text,
    required this.onTap,
    this.color,
  });
  final IconData icon;
  final String text;
  final VoidCallback onTap;
  final Color? color;

  @override
  Widget build(BuildContext context) => ListTile(
    leading: Icon(icon, color: color),
    title: Text(text),
    trailing: const Icon(Icons.chevron_right),
    onTap: onTap,
  );
}
