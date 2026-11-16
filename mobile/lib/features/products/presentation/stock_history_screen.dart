import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../../../app/theme/tokens.dart';
import '../../../core/money/money_providers.dart';
import '../../../core/widgets/state_views.dart';
import 'inventory_controllers.dart';
import 'product_widgets.dart';

/// C6 Stock history: the full ledger for one product.
class StockHistoryScreen extends ConsumerStatefulWidget {
  const StockHistoryScreen({super.key, required this.productId});
  final String productId;

  @override
  ConsumerState<StockHistoryScreen> createState() => _StockHistoryScreenState();
}

class _StockHistoryScreenState extends ConsumerState<StockHistoryScreen> {
  final _scroll = ScrollController();
  HistoryFilter _filter = HistoryFilter.all;

  HistoryKey get _key => (productId: widget.productId, filter: _filter);

  @override
  void initState() {
    super.initState();
    _scroll.addListener(() {
      if (_scroll.position.extentAfter < 400) {
        unawaited(ref.read(stockHistoryProvider(_key).notifier).loadMore());
      }
    });
  }

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final history = ref.watch(stockHistoryProvider(_key));
    final money = ref.watch(moneyFormatterProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Stock history')),
      body: Column(
        children: [
          SizedBox(
            height: 56,
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: Space.lg),
              child: Row(
                children: [
                  for (final f in HistoryFilter.values)
                    Builder(
                      builder: (context) {
                        return Padding(
                          padding: const EdgeInsets.only(right: Space.sm),
                          child: Center(
                            child: FilterChip(
                              key: Key('history-${f.name}'),
                              label: Text(f.label),
                              selected: _filter == f,
                              showCheckmark: false,
                              materialTapTargetSize:
                                  MaterialTapTargetSize.padded,
                              onSelected: (_) => setState(() => _filter = f),
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
            child: AsyncValueView<StockHistory>(
              value: history,
              onRetry: () => ref.invalidate(stockHistoryProvider(_key)),
              isEmpty: (h) => h.items.isEmpty,
              empty: MessageView(
                icon: Icons.history,
                title: _filter == HistoryFilter.all
                    ? 'No stock movements yet'
                    : 'No ${_filter.label.toLowerCase()} yet',
              ),
              data: (h) => ListView.separated(
                controller: _scroll,
                padding: const EdgeInsets.symmetric(
                  horizontal: Space.lg,
                  vertical: Space.sm,
                ),
                itemCount: h.items.length + (h.nextCursor != null ? 1 : 0),
                separatorBuilder: (_, _) => const Divider(),
                itemBuilder: (context, i) {
                  if (i >= h.items.length) {
                    return const Padding(
                      padding: EdgeInsets.all(Space.xl),
                      child: Center(child: CircularProgressIndicator()),
                    );
                  }
                  final m = h.items[i];
                  return MovementTile(
                    movement: m,
                    costText: m.unitCostMinor == null
                        ? null
                        : money.format(m.unitCostMinor!),
                  );
                },
              ),
            ),
          ),
        ],
      ),
    );
  }
}
