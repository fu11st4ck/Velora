import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../../../app/theme/tokens.dart';
import '../../../core/widgets/state_views.dart';
import '../data/customer.dart';
import 'customer_controllers.dart';

/// Search field plus paged results. Shared by the customer directory and the customer picker;
/// they differ only in what tapping a row does and what the empty state offers.
class CustomerListView extends ConsumerStatefulWidget {
  const CustomerListView({
    super.key,
    required this.onSelected,
    required this.onCreate,
    this.bottomPadding = 0,
  });

  final ValueChanged<Customer> onSelected;

  /// Starts creating a customer; receives the current search text to pre-fill the form.
  final ValueChanged<String> onCreate;
  final double bottomPadding;

  @override
  ConsumerState<CustomerListView> createState() => _CustomerListViewState();
}

class _CustomerListViewState extends ConsumerState<CustomerListView> {
  final _search = TextEditingController();
  final _scroll = ScrollController();
  Timer? _debounce;
  String _query = '';

  @override
  void initState() {
    super.initState();
    _scroll.addListener(() {
      if (_scroll.position.extentAfter < 400) {
        unawaited(ref.read(customerListProvider(_query).notifier).loadMore());
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

  void _onChanged(String value) {
    setState(() {});
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 300), () {
      if (mounted) setState(() => _query = value.trim());
    });
  }

  @override
  Widget build(BuildContext context) {
    final list = ref.watch(customerListProvider(_query));
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(
            Space.lg,
            Space.sm,
            Space.lg,
            Space.md,
          ),
          child: TextField(
            key: const Key('customer-search'),
            controller: _search,
            onChanged: _onChanged,
            textInputAction: TextInputAction.search,
            decoration: InputDecoration(
              hintText: 'Search name, company or mobile',
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
          child: AsyncValueView<CustomerList>(
            value: list,
            onRetry: () => ref.invalidate(customerListProvider(_query)),
            isEmpty: (data) => data.items.isEmpty,
            empty: _query.isEmpty
                ? MessageView(
                    title: 'No customers yet',
                    body: 'Customers you add are saved here, so their details are never typed twice.',
                    actionLabel: 'Add customer',
                    onAction: () => widget.onCreate(''),
                  )
                : MessageView(
                    icon: Icons.person_search_outlined,
                    title: 'No customer matches "$_query"',
                    actionLabel: 'Add as new customer',
                    onAction: () => widget.onCreate(_query),
                  ),
            data: (data) => ListView.separated(
              controller: _scroll,
              padding: EdgeInsets.only(bottom: widget.bottomPadding),
              itemCount: data.items.length + (data.nextCursor != null ? 1 : 0),
              separatorBuilder: (_, _) =>
                  const Divider(indent: Space.lg, endIndent: Space.lg),
              itemBuilder: (context, i) {
                if (i >= data.items.length) {
                  return const Padding(
                    padding: EdgeInsets.all(Space.xl),
                    child: Center(child: CircularProgressIndicator()),
                  );
                }
                final customer = data.items[i];
                return CustomerTile(
                  customer: customer,
                  onTap: () => widget.onSelected(customer),
                );
              },
            ),
          ),
        ),
      ],
    );
  }
}

class CustomerTile extends StatelessWidget {
  const CustomerTile({super.key, required this.customer, required this.onTap});
  final Customer customer;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodyMedium?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    final details = [?customer.secondaryName, ?customer.mobile].join(' · ');
    return InkWell(
      key: Key('customer-${customer.id}'),
      onTap: onTap,
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 64),
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: Space.lg,
            vertical: Space.md,
          ),
          child: Row(
            children: [
              CustomerAvatar(customer: customer),
              const SizedBox(width: Space.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text(
                      customer.displayName,
                      style: theme.textTheme.titleMedium,
                    ),
                    if (details.isNotEmpty) Text(details, style: muted),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class CustomerAvatar extends StatelessWidget {
  const CustomerAvatar({super.key, required this.customer, this.radius = 20});
  final Customer customer;
  final double radius;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final name = customer.displayName.trim();
    return ExcludeSemantics(
      child: CircleAvatar(
        radius: radius,
        backgroundColor: scheme.primaryContainer,
        foregroundColor: scheme.onPrimaryContainer,
        child: Text(
          name.isEmpty ? '?' : name.characters.first.toUpperCase(),
          style: TextStyle(
            fontFamily: 'PlayfairDisplay',
            fontSize: radius * 0.9,
            height: 1,
          ),
        ),
      ),
    );
  }
}
