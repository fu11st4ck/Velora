import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:material_ui/material_ui.dart';

import '../../../app/router/routes.dart';
import '../../../app/theme/tokens.dart';
import '../../../core/api/failure.dart';
import '../../../core/api/failure_messages.dart';
import '../../../core/money/money_providers.dart';
import '../../../core/widgets/notice.dart';
import '../../../core/widgets/primary_button.dart';
import '../../../core/widgets/sections.dart';
import '../../../core/widgets/state_views.dart';
import '../../../core/widgets/status_pill.dart';
import '../../products/data/products_api.dart';
import '../../sell/data/cart.dart';
import '../../sell/presentation/cart_controller.dart';
import '../data/document.dart';
import '../data/documents_api.dart';
import 'document_controllers.dart';
import 'document_widgets.dart';
import 'documents_screen.dart' show formatDateOnly;

enum _Action { whatsapp, cancel }

final _dateTime = DateFormat('d MMM yyyy, HH:mm');

/// F2 Quotation detail.
class QuotationDetailScreen extends ConsumerStatefulWidget {
  const QuotationDetailScreen({super.key, required this.quotationId});
  final String quotationId;

  @override
  ConsumerState<QuotationDetailScreen> createState() =>
      _QuotationDetailScreenState();
}

class _QuotationDetailScreenState extends ConsumerState<QuotationDetailScreen> {
  bool _converting = false;

  /// Loads the quotation into the cart with today's product limits and stock, then opens the cart.
  /// Stock and prices are checked again by the server when the invoice is issued.
  Future<void> _convert(Quotation q) async {
    if (_converting) return;
    final messenger = ScaffoldMessenger.of(context);
    final cart = ref.read(cartProvider);
    if (!cart.isEmpty) {
      final replace = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('Replace the current cart?'),
          content: Text(
            'The cart holds ${cart.units} ${cart.units == 1 ? 'item' : 'items'}. Converting ${q.number} replaces them.',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: const Text('Keep cart'),
            ),
            TextButton(
              key: const Key('confirm-replace-cart'),
              onPressed: () => Navigator.of(context).pop(true),
              child: const Text('Replace'),
            ),
          ],
        ),
      );
      if (replace != true || !mounted) return;
    }
    setState(() => _converting = true);
    try {
      final api = ref.read(productsApiProvider);
      final lines = <CartLine>[];
      for (final line in q.lines) {
        final product = await api.get(line.productId);
        lines.add(
          CartLine.of(
            product,
            quantity: line.quantity,
            unitPriceMinor: line.unitPriceMinor,
          ),
        );
      }
      if (!mounted) return;
      ref
          .read(cartProvider.notifier)
          .replace(
            Cart(
              lines: lines,
              customer: CartCustomer(
                id: q.customer.id,
                displayName: q.customer.name ?? q.customer.displayName,
                details: [
                  if (q.customer.name != null) ?q.customer.company,
                  ?q.customer.mobile,
                ].join(' · '),
              ),
              discountMinor: q.discountMinor,
              taxRateId: q.tax.id,
              notes: q.notes,
              quotationId: q.id,
              quotationNumber: q.number,
            ),
          );
      context.go(Routes.cart);
    } on Failure catch (failure) {
      messenger.showSnackBar(SnackBar(content: Text(describeFailure(failure))));
    } finally {
      if (mounted) setState(() => _converting = false);
    }
  }

  Future<void> _cancel(Quotation q) async {
    final messenger = ScaffoldMessenger.of(context);
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('Cancel ${q.number}?'),
        content: const Text(
          'The quotation can no longer be converted to an invoice.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Keep quotation'),
          ),
          TextButton(
            key: const Key('confirm-cancel-quotation'),
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Cancel quotation'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await ref.read(documentsApiProvider).cancelQuotation(q.id);
      refreshDocuments(ref, quotationId: q.id);
      messenger.showSnackBar(
        const SnackBar(content: Text('Quotation cancelled.')),
      );
    } on Failure catch (failure) {
      messenger.showSnackBar(SnackBar(content: Text(describeFailure(failure))));
      ref.invalidate(quotationProvider(q.id));
    }
  }

  @override
  Widget build(BuildContext context) {
    final quotation = ref.watch(quotationProvider(widget.quotationId));
    final q = quotation.value;
    final open = q?.status == QuotationStatus.open;
    final mobile = q?.customer.mobile;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Quotation'),
        actions: [
          if (q != null && (mobile != null || open))
            PopupMenuButton<_Action>(
              key: const Key('quotation-menu'),
              tooltip: 'More actions',
              onSelected: (action) => switch (action) {
                _Action.whatsapp => messageOnWhatsApp(
                  context,
                  ref,
                  isInvoice: false,
                  number: q.number,
                  customerName: q.customer.name ?? q.customer.displayName,
                  mobile: mobile!,
                  totalMinor: q.totalMinor,
                ),
                _Action.cancel => _cancel(q),
              },
              itemBuilder: (_) => [
                if (mobile != null)
                  const PopupMenuItem(
                    value: _Action.whatsapp,
                    child: Text('Message on WhatsApp'),
                  ),
                if (open)
                  const PopupMenuItem(
                    value: _Action.cancel,
                    child: Text('Cancel quotation'),
                  ),
              ],
            ),
        ],
      ),
      bottomNavigationBar: q == null
          ? null
          : PinnedBar(
              child: Row(
                children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      key: const Key('share-document'),
                      onPressed: () => shareDocument(
                        context,
                        ref,
                        isInvoice: false,
                        id: q.id,
                        number: q.number,
                        customerName: q.customer.name ?? q.customer.displayName,
                        totalMinor: q.totalMinor,
                      ),
                      icon: const Icon(Icons.ios_share),
                      label: const Text('Share PDF'),
                    ),
                  ),
                  if (open) ...[
                    const SizedBox(width: Space.md),
                    Expanded(
                      child: PrimaryButton(
                        key: const Key('convert-quotation'),
                        label: 'Convert to invoice',
                        busy: _converting,
                        onPressed: () => _convert(q),
                      ),
                    ),
                  ],
                ],
              ),
            ),
      body: RefreshIndicator(
        onRefresh: () async {
          final _ = await ref.refresh(
            quotationProvider(widget.quotationId).future,
          );
        },
        child: AsyncValueView<Quotation>(
          value: quotation,
          onRetry: () => ref.invalidate(quotationProvider(widget.quotationId)),
          data: (q) => _Body(quotation: q),
        ),
      ),
    );
  }
}

class _Body extends ConsumerWidget {
  const _Body({required this.quotation});
  final Quotation quotation;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final tokens = VeloraTokens.of(context);
    final money = ref.watch(moneyFormatterProvider);
    final q = quotation;

    return SingleChildScrollView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.all(Space.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(q.number, style: tokens.overline, textAlign: TextAlign.center),
          const SizedBox(height: Space.xs),
          Text(
            money.format(q.totalMinor),
            key: const Key('quotation-total'),
            style: tokens.displayMoney,
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: Space.sm),
          Center(
            child: StatusPill(
              key: const Key('quotation-status'),
              label: q.status.label,
              tone: q.status.tone,
            ),
          ),
          if (q.status == QuotationStatus.open && q.validUntil != null) ...[
            const SizedBox(height: Space.sm),
            Text(
              'Valid until ${formatDateOnly(q.validUntil!)}',
              style: theme.textTheme.bodyLarge,
              textAlign: TextAlign.center,
            ),
          ],
          const SizedBox(height: Space.lg),
          if (q.status == QuotationStatus.open)
            const Notice(
              message: 'A quotation holds prices, not stock. Stock is checked when it becomes an invoice.',
              tone: StatusTone.neutral,
            ),
          if (q.status == QuotationStatus.expired)
            const Notice(
              message: 'This quotation has expired. Create a new sale to quote again.',
              tone: StatusTone.warning,
            ),
          if (q.invoiceId != null)
            Card(
              clipBehavior: Clip.antiAlias,
              child: ListTile(
                key: const Key('open-invoice'),
                leading: const Icon(Icons.receipt_long_outlined),
                title: Text('Invoice ${q.invoiceNumber}'),
                subtitle: const Text('Created from this quotation'),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => context.push(Routes.invoice(q.invoiceId!)),
              ),
            ),
          const SizedBox(height: Space.lg),
          PartyCard(title: 'Prepared for', party: q.customer),
          const SizedBox(height: Space.lg),
          LinesCard(lines: q.lines, money: money),
          const SizedBox(height: Space.lg),
          SectionCard(
            title: 'Totals',
            children: [
              FactRow(label: 'Subtotal', value: money.format(q.subtotalMinor)),
              if (q.discountMinor > 0)
                FactRow(
                  label: 'Discount',
                  value: '− ${money.format(q.discountMinor)}',
                ),
              FactRow(
                label: q.tax.name,
                value: money.format(q.tax.amountMinor),
              ),
              FactRow(
                label: 'Total',
                value: money.format(q.totalMinor),
                emphasize: true,
              ),
            ],
          ),
          const SizedBox(height: Space.lg),
          SectionCard(
            title: 'Details',
            children: [
              FactRow(
                label: 'Issued',
                value: _dateTime.format(q.issuedAt.toLocal()),
              ),
              FactRow(label: 'Salesperson', value: q.salespersonName),
              if (q.notes != null) FactRow(label: 'Notes', value: q.notes!),
            ],
          ),
        ],
      ),
    );
  }
}
