import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../../app/router/routes.dart';
import '../../../app/theme/tokens.dart';
import '../../../core/api/failure.dart';
import '../../../core/api/failure_messages.dart';
import '../../../core/api/idempotency.dart';
import '../../../core/auth/session_controller.dart';
import '../../../core/money/money_format.dart';
import '../../../core/money/money_providers.dart';
import '../../../core/widgets/labeled_field.dart';
import '../../../core/widgets/notice.dart';
import '../../../core/widgets/sections.dart';
import '../../../core/widgets/state_views.dart';
import '../../customers/presentation/customer_picker.dart';
import '../../documents/presentation/document_controllers.dart';
import '../data/cart.dart';
import '../data/sales_api.dart';
import 'cart_controller.dart';
import 'sale_navigation.dart';
import 'price_sheet.dart';

/// Plain-language text for a problem the server found with a cart line.
String describeLineIssue(
  LineIssue issue,
  MoneyFormatter money,
) => switch (issue.code) {
  'INSUFFICIENT_STOCK' =>
    issue.available == 0
        ? 'Out of stock.'
        : 'Only ${issue.available} in stock.',
  'PRICE_BELOW_MINIMUM' =>
    'Lowest allowed price is ${money.format(issue.floorPriceMinor ?? 0)}.',
  'PRICE_ABOVE_MAXIMUM' =>
    'Highest allowed price is ${money.format(issue.ceilingPriceMinor ?? 0)}.',
  'PRODUCT_UNAVAILABLE' => 'No longer available. Remove this item.',
  _ => 'This item needs attention.',
};

/// D3 Cart: customer, lines, discount, tax and totals for the sale in progress.
class CartScreen extends ConsumerStatefulWidget {
  const CartScreen({super.key});

  @override
  ConsumerState<CartScreen> createState() => _CartScreenState();
}

class _CartScreenState extends ConsumerState<CartScreen> {
  late final _discount = TextEditingController();
  late final _notes = TextEditingController(text: ref.read(cartProvider).notes);
  String _quotationKey = newIdempotencyKey();
  bool _saving = false;
  bool _customerMissing = false;
  Failure? _failure;

  @override
  void initState() {
    super.initState();
    final cart = ref.read(cartProvider);
    if (cart.discountMinor > 0) {
      _discount.text = ref
          .read(moneyFormatterProvider)
          .format(cart.discountMinor, withCode: false)
          .replaceAll(',', '');
    }
  }

  @override
  void dispose() {
    _discount.dispose();
    _notes.dispose();
    super.dispose();
  }

  Future<void> _chooseCustomer() async {
    final customer = await showCustomerPicker(context);
    if (customer != null) {
      ref.read(cartProvider.notifier).setCustomer(customer);
      setState(() => _customerMissing = false);
    }
  }

  Future<void> _editLine(int index) async {
    final cart = ref.read(cartProvider);
    final line = cart.lines[index];
    final choice = await showPriceSheet(
      context,
      name: line.name,
      sku: line.sku,
      listPriceMinor: line.listPriceMinor,
      floorPriceMinor: line.floorPriceMinor,
      ceilingPriceMinor: line.ceilingPriceMinor,
      costMinor: line.costMinor,
      maxQuantity:
          line.available - cart.unitsOf(line.productId, exceptIndex: index),
      initialQuantity: line.quantity,
      initialPriceMinor: line.unitPriceMinor,
      initialReason: line.belowMinimumReason,
    );
    if (choice == null) return;
    ref
        .read(cartProvider.notifier)
        .updateLine(
          index,
          quantity: choice.quantity,
          unitPriceMinor: choice.unitPriceMinor,
          belowMinimumReason: choice.belowMinimumReason,
        );
  }

  void _removeLine(int index) {
    final controller = ref.read(cartProvider.notifier);
    final removed = controller.removeLine(index);
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text('${removed.name} removed'),
          action: SnackBarAction(
            label: 'Undo',
            onPressed: () => controller.insertLine(index, removed),
          ),
        ),
      );
  }

  void _onDiscountChanged(String text) {
    final money = ref.read(moneyFormatterProvider);
    final parsed = text.trim().isEmpty ? 0 : money.parse(text);
    if (parsed != null) ref.read(cartProvider.notifier).setDiscount(parsed);
    setState(() {});
  }

  /// Checks the cart can go forward; explains what is missing otherwise.
  bool _ready(Cart cart, PricePreview? preview) {
    if (cart.customer == null) {
      setState(() => _customerMissing = true);
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(
          const SnackBar(content: Text('Choose a customer first.')),
        );
      return false;
    }
    if (_discountError(cart) != null || preview == null || !preview.valid) {
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(
          const SnackBar(content: Text('Fix the highlighted items first.')),
        );
      return false;
    }
    return true;
  }

  String? _discountError(Cart cart) {
    final money = ref.read(moneyFormatterProvider);
    if (_discount.text.trim().isNotEmpty &&
        money.parse(_discount.text) == null) {
      return 'Enter a valid amount.';
    }
    if (cart.discountMinor > cart.subtotalMinor) {
      return 'The discount cannot be more than the subtotal.';
    }
    return null;
  }

  Future<void> _saveQuotation(Cart cart, PricePreview? preview) async {
    if (_saving || !_ready(cart, preview)) return;
    setState(() {
      _saving = true;
      _failure = null;
    });
    try {
      final quotation = await ref
          .read(salesApiProvider)
          .createQuotation(
            customerId: cart.customer!.id,
            lines: cart.lines.map((l) => l.toSaleLine()).toList(),
            discountMinor: cart.discountMinor,
            taxRateId: cart.taxRateId,
            notes: cart.notes,
            idempotencyKey: _quotationKey,
          );
      if (!mounted) return;
      ref.read(cartProvider.notifier).clear();
      refreshDocuments(ref);
      finishSaleAt(context, Routes.quotation(quotation.id));
    } on Failure catch (failure) {
      if (!mounted) return;
      setState(() {
        if (failure is BusinessFailure || failure is ValidationFailure) {
          _quotationKey = newIdempotencyKey();
        }
        _failure = failure;
      });
      ref.invalidate(cartPreviewProvider);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _clear() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Clear the cart?'),
        content: const Text('All items and the chosen customer are removed.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          TextButton(
            key: const Key('confirm-clear'),
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Clear cart'),
          ),
        ],
      ),
    );
    if (confirmed == true && mounted) {
      ref.read(cartProvider.notifier).clear();
      context.pop();
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final tokens = VeloraTokens.of(context);
    final money = ref.watch(moneyFormatterProvider);
    final cart = ref.watch(cartProvider);
    final previewAsync = ref.watch(cartPreviewProvider);
    final preview = previewAsync.value;
    final rates = ref.watch(taxRatesProvider).value ?? const [];
    final showCost =
        ref.watch(currentUserProvider)?.can('product.read_cost') ?? false;
    final muted = theme.textTheme.bodyMedium?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    final discountError = _discountError(cart);

    if (cart.isEmpty) {
      return Scaffold(
        appBar: AppBar(title: const Text('Cart')),
        body: MessageView(
          icon: Icons.shopping_bag_outlined,
          title: 'Your cart is empty',
          body: 'Choose a product to start a sale.',
          actionLabel: 'Browse products',
          onAction: () => context.pop(),
        ),
      );
    }

    return Scaffold(
      appBar: AppBar(
        title: const Text('Cart'),
        actions: [
          IconButton(
            key: const Key('clear-cart'),
            tooltip: 'Clear cart',
            icon: const Icon(Icons.delete_outline),
            onPressed: _clear,
          ),
        ],
      ),
      bottomNavigationBar: PinnedBar(
        child: Row(
          children: [
            Expanded(
              child: OutlinedButton(
                key: const Key('save-quotation'),
                onPressed: _saving ? null : () => _saveQuotation(cart, preview),
                child: const Text('Save quotation'),
              ),
            ),
            const SizedBox(width: Space.md),
            Expanded(
              child: FilledButton(
                key: const Key('take-payment'),
                onPressed: _saving
                    ? null
                    : () {
                        if (_ready(cart, preview)) context.push(Routes.payment);
                      },
                child: const Text('Take payment'),
              ),
            ),
          ],
        ),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(Space.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (_failure != null) ...[
              Notice(message: describeFailure(_failure!)),
              const SizedBox(height: Space.lg),
            ],
            if (cart.quotationNumber != null) ...[
              Notice(
                message:
                    'Converting ${cart.quotationNumber}. Check prices and stock before taking payment.',
                tone: StatusTone.neutral,
              ),
              const SizedBox(height: Space.lg),
            ],
            Card(
              clipBehavior: Clip.antiAlias,
              shape: _customerMissing
                  ? RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(Radii.card),
                      side: BorderSide(
                        color: theme.colorScheme.error,
                        width: 2,
                      ),
                    )
                  : null,
              child: ListTile(
                key: const Key('cart-customer'),
                leading: const Icon(Icons.person_outline),
                title: Text(cart.customer?.displayName ?? 'Add customer'),
                subtitle: cart.customer == null
                    ? Text(
                        _customerMissing
                            ? 'Required for a quotation or invoice.'
                            : 'Required',
                      )
                    : ((cart.customer!.details ?? '').isEmpty
                          ? null
                          : Text(cart.customer!.details!)),
                trailing: Text(
                  cart.customer == null ? 'Choose' : 'Change',
                  style: theme.textTheme.labelLarge?.copyWith(
                    color: theme.colorScheme.primary,
                  ),
                ),
                onTap: _chooseCustomer,
              ),
            ),
            const SizedBox(height: Space.lg),
            SectionCard(
              title: 'Items',
              trailing: Text(
                '${cart.units} ${cart.units == 1 ? 'unit' : 'units'}',
                style: muted,
              ),
              children: [
                for (final (i, line) in cart.lines.indexed) ...[
                  if (i > 0) const Divider(),
                  Dismissible(
                    key: ValueKey(
                      '${line.productId}-${line.unitPriceMinor}-$i-${cart.lines.length}',
                    ),
                    direction: DismissDirection.endToStart,
                    background: Container(
                      alignment: Alignment.centerRight,
                      padding: const EdgeInsets.only(right: Space.lg),
                      color: tokens.danger.background,
                      child: Icon(
                        Icons.delete_outline,
                        color: tokens.danger.foreground,
                      ),
                    ),
                    onDismissed: (_) => _removeLine(i),
                    child: InkWell(
                      key: Key('cart-line-$i'),
                      onTap: () => _editLine(i),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(vertical: Space.md),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    line.name,
                                    style: theme.textTheme.titleMedium,
                                  ),
                                  Text(
                                    '${line.quantity} × ${money.format(line.unitPriceMinor)}',
                                    style: muted,
                                  ),
                                  if (showCost &&
                                      line.costMinor != null &&
                                      line.costMinor! > 0)
                                    Text(
                                      'Markup ${formatBasisPoints(((line.unitPriceMinor - line.costMinor!) * 10000) ~/ line.costMinor!)}',
                                      style: theme.textTheme.bodySmall
                                          ?.copyWith(
                                            color: theme
                                                .colorScheme
                                                .onSurfaceVariant,
                                          ),
                                    ),
                                  for (final issue
                                      in (preview != null &&
                                              i < preview.issues.length)
                                          ? preview.issues[i]
                                          : const <LineIssue>[])
                                    Padding(
                                      padding: const EdgeInsets.only(
                                        top: Space.xs,
                                      ),
                                      child: Text(
                                        describeLineIssue(issue, money),
                                        style: theme.textTheme.bodyMedium
                                            ?.copyWith(
                                              color: theme.colorScheme.error,
                                            ),
                                      ),
                                    ),
                                ],
                              ),
                            ),
                            const SizedBox(width: Space.sm),
                            Text(
                              money.format(line.lineTotalMinor),
                              style: tokens.moneyRow,
                            ),
                            IconButton(
                              key: Key('remove-line-$i'),
                              tooltip: 'Remove ${line.name}',
                              icon: const Icon(Icons.close),
                              onPressed: () => _removeLine(i),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ],
              ],
            ),
            const SizedBox(height: Space.lg),
            SectionCard(
              title: 'Adjustments',
              children: [
                LabeledField(
                  key: const Key('cart-discount'),
                  label: 'Discount (${money.currencyCode})',
                  controller: _discount,
                  hint: '0.00',
                  errorText: discountError,
                  keyboardType: const TextInputType.numberWithOptions(
                    decimal: true,
                  ),
                  inputFormatters: [
                    FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]')),
                  ],
                  onChanged: _onDiscountChanged,
                ),
                if (rates.length > 1) ...[
                  const SizedBox(height: Space.lg),
                  Text(
                    'Tax',
                    style: theme.textTheme.labelMedium?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                  const SizedBox(height: Space.sm),
                  Wrap(
                    spacing: Space.sm,
                    children: [
                      for (final rate in rates)
                        ChoiceChip(
                          key: Key('tax-${rate.rateBp}'),
                          label: Text(rate.name),
                          showCheckmark: false,
                          materialTapTargetSize: MaterialTapTargetSize.padded,
                          // No explicit choice means the business default, which the server lists first.
                          selected: cart.taxRateId == null
                              ? rate.id == rates.first.id
                              : cart.taxRateId == rate.id,
                          onSelected: (_) => ref
                              .read(cartProvider.notifier)
                              .setTaxRate(rate.id),
                        ),
                    ],
                  ),
                ],
                const SizedBox(height: Space.lg),
                LabeledField(
                  key: const Key('cart-notes'),
                  label: 'Notes (printed on the document)',
                  controller: _notes,
                  onChanged: (v) => ref
                      .read(cartProvider.notifier)
                      .setNotes(v.trim().isEmpty ? null : v.trim()),
                ),
              ],
            ),
            const SizedBox(height: Space.lg),
            SectionCard(
              title: 'Totals',
              children: [
                if (previewAsync.hasError && preview == null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: Space.sm),
                    child: Notice(
                      message: describeFailure(
                        Failure.from(previewAsync.error!),
                      ),
                      tone: StatusTone.warning,
                    ),
                  ),
                FactRow(
                  label: 'Subtotal',
                  value: money.format(
                    preview?.subtotalMinor ?? cart.subtotalMinor,
                  ),
                ),
                if (cart.discountMinor > 0)
                  FactRow(
                    label: 'Discount',
                    value: '− ${money.format(cart.discountMinor)}',
                  ),
                FactRow(
                  label: preview?.tax.name ?? 'Tax',
                  value: preview == null
                      ? '…'
                      : money.format(preview.tax.amountMinor),
                ),
                const Divider(),
                MergeSemantics(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: Space.sm),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text(
                            'Total',
                            style: theme.textTheme.titleMedium,
                          ),
                        ),
                        Text(
                          preview == null
                              ? '…'
                              : money.format(preview.totalMinor),
                          key: const Key('cart-total'),
                          style: theme.textTheme.titleLarge,
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
