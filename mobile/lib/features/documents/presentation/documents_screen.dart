import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:material_ui/material_ui.dart';

import '../../../app/router/routes.dart';
import '../../../app/theme/tokens.dart';
import '../../../core/money/money_providers.dart';
import '../../../core/widgets/state_views.dart';
import '../../../core/widgets/status_pill.dart';
import '../data/document.dart';
import 'document_controllers.dart';

final _day = DateFormat('d MMM yyyy');

/// `2026-12-16` → `16 Dec 2026`.
String formatDateOnly(String date) => _day.format(DateTime.parse(date));

/// F1 Documents: quotations and invoices in one list.
class DocumentsScreen extends ConsumerStatefulWidget {
  const DocumentsScreen({super.key});

  @override
  ConsumerState<DocumentsScreen> createState() => _DocumentsScreenState();
}

class _DocumentsScreenState extends ConsumerState<DocumentsScreen> {
  final _search = TextEditingController();
  final _scroll = ScrollController();
  Timer? _debounce;
  String _query = '';
  DocumentFilter _filter = DocumentFilter.all;

  DocumentQuery get _key => (search: _query, filter: _filter);

  @override
  void initState() {
    super.initState();
    _scroll.addListener(() {
      if (_scroll.position.extentAfter < 400) {
        unawaited(ref.read(documentListProvider(_key).notifier).loadMore());
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
    final list = ref.watch(documentListProvider(_key));
    final filtered = _query.isNotEmpty || _filter != DocumentFilter.all;

    return Scaffold(
      appBar: AppBar(title: const Text('Documents')),
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
              key: const Key('document-search'),
              controller: _search,
              onChanged: _onChanged,
              textInputAction: TextInputAction.search,
              decoration: InputDecoration(
                hintText: 'Search number or customer',
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
          SizedBox(
            height: 56,
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: Space.lg),
              child: Row(
                children: [
                  for (final f in DocumentFilter.values)
                    Padding(
                      padding: const EdgeInsets.only(right: Space.sm),
                      child: FilterChip(
                        key: Key('doc-filter-${f.name}'),
                        label: Text(f.label),
                        selected: _filter == f,
                        showCheckmark: false,
                        materialTapTargetSize: MaterialTapTargetSize.padded,
                        onSelected: (_) => setState(() => _filter = f),
                      ),
                    ),
                ],
              ),
            ),
          ),
          const Divider(),
          Expanded(
            child: RefreshIndicator(
              onRefresh: () => ref.refresh(documentListProvider(_key).future),
              child: AsyncValueView<DocumentList>(
                value: list,
                onRetry: () => ref.invalidate(documentListProvider(_key)),
                isEmpty: (d) => d.items.isEmpty,
                empty: filtered
                    ? MessageView(
                        icon: Icons.search_off,
                        title: 'No documents match',
                        actionLabel: 'Clear filters',
                        onAction: () {
                          _debounce?.cancel();
                          _search.clear();
                          setState(() {
                            _query = '';
                            _filter = DocumentFilter.all;
                          });
                        },
                      )
                    : MessageView(
                        icon: Icons.receipt_long_outlined,
                        title: 'No documents yet',
                        body: 'Quotations and invoices appear here once a sale is made.',
                        actionLabel: 'Start a sale',
                        onAction: () => context.go(Routes.sell),
                      ),
                data: (d) => ListView.separated(
                  controller: _scroll,
                  physics: const AlwaysScrollableScrollPhysics(),
                  itemCount: d.items.length + (d.nextCursor != null ? 1 : 0),
                  separatorBuilder: (_, _) =>
                      const Divider(indent: Space.lg, endIndent: Space.lg),
                  itemBuilder: (context, i) => i >= d.items.length
                      ? const Padding(
                          padding: EdgeInsets.all(Space.xl),
                          child: Center(child: CircularProgressIndicator()),
                        )
                      : DocumentTile(document: d.items[i]),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// One document in a list: number and status first, then who, then what is owed.
class DocumentTile extends ConsumerWidget {
  const DocumentTile({super.key, required this.document});
  final DocumentSummary document;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final money = ref.watch(moneyFormatterProvider);
    final muted = theme.textTheme.bodyMedium?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    final d = document;
    final status = d.status;
    final owes = d.isInvoice && !d.cancelled && d.balanceMinor > 0;
    final detail = owes
        ? 'Balance ${money.format(d.balanceMinor)}${d.dueDate == null ? '' : ' · due ${formatDateOnly(d.dueDate!)}'}'
        : (!d.isInvoice &&
              d.quotationStatus == QuotationStatus.open &&
              d.validUntil != null)
        ? 'Valid until ${formatDateOnly(d.validUntil!)}'
        : null;

    return InkWell(
      key: Key('doc-${d.number}'),
      onTap: () => context.push(
        d.isInvoice ? Routes.invoice(d.id) : Routes.quotation(d.id),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: Space.lg,
          vertical: Space.md,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Wrap(
              spacing: Space.sm,
              runSpacing: Space.xs,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Text(d.number, style: theme.textTheme.titleMedium),
                StatusPill(label: status.label, tone: status.tone),
              ],
            ),
            const SizedBox(height: Space.xs),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        d.customer.displayName,
                        style: theme.textTheme.bodyLarge,
                      ),
                      Text(
                        '${_day.format(d.issuedAt.toLocal())} · ${d.salespersonName}',
                        style: muted,
                      ),
                      if (detail != null)
                        Text(
                          detail,
                          style: theme.textTheme.bodyMedium?.copyWith(
                            color: d.isOverdue
                                ? theme.colorScheme.error
                                : theme.colorScheme.onSurfaceVariant,
                          ),
                        ),
                    ],
                  ),
                ),
                const SizedBox(width: Space.md),
                Text(
                  money.format(d.totalMinor),
                  style: VeloraTokens.of(context).moneyRow,
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
