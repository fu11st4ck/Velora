import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../../app/theme/tokens.dart';
import '../../../core/api/failure.dart';
import '../../../core/api/failure_messages.dart';
import '../../../core/api/idempotency.dart';
import '../../../core/money/money_math.dart';
import '../../../core/money/money_providers.dart';
import '../../../core/widgets/labeled_field.dart';
import '../../../core/widgets/notice.dart';
import '../../../core/widgets/primary_button.dart';
import '../../../core/widgets/state_views.dart';
import '../data/product.dart';
import '../data/products_api.dart';
import 'form_helpers.dart';
import 'inventory_controllers.dart';
import 'product_widgets.dart';

/// C4 Receive stock for an existing product.
class ReceiveStockScreen extends ConsumerWidget {
  const ReceiveStockScreen({super.key, required this.productId});
  final String productId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final product = ref.watch(productProvider(productId));
    return product.hasValue
        ? _ReceiveForm(product: product.value!)
        : Scaffold(
            appBar: AppBar(title: const Text('Receive stock')),
            body: AsyncValueView<Product>(
              value: product,
              onRetry: () => ref.invalidate(productProvider(productId)),
              data: (_) => const SizedBox.shrink(),
            ),
          );
  }
}

class _ReceiveForm extends ConsumerStatefulWidget {
  const _ReceiveForm({required this.product});
  final Product product;

  @override
  ConsumerState<_ReceiveForm> createState() => _ReceiveFormState();
}

class _ReceiveFormState extends ConsumerState<_ReceiveForm> {
  final _form = GlobalKey<FormState>();
  final _quantity = TextEditingController();
  late final _cost = TextEditingController(
    text: ref
        .read(moneyFormatterProvider)
        .format(widget.product.costMinor ?? 0, withCode: false)
        .replaceAll(',', ''),
  );
  final _supplier = TextEditingController();
  final _note = TextEditingController();
  String _idempotencyKey = newIdempotencyKey();
  bool _busy = false;
  Failure? _failure;

  @override
  void dispose() {
    for (final c in [_quantity, _cost, _supplier, _note]) {
      c.dispose();
    }
    super.dispose();
  }

  String? _nullIfBlank(TextEditingController c) =>
      c.text.trim().isEmpty ? null : c.text.trim();

  Future<void> _submit() async {
    if (_busy) return;
    setState(() => _failure = null);
    if (!_form.currentState!.validate()) return;
    final money = ref.read(moneyFormatterProvider);
    setState(() => _busy = true);
    try {
      final updated = await ref
          .read(productsApiProvider)
          .receive(
            productId: widget.product.id,
            quantity: int.parse(_quantity.text.trim()),
            unitCostMinor: money.parse(_cost.text)!,
            supplierName: _nullIfBlank(_supplier),
            referenceNote: _nullIfBlank(_note),
            idempotencyKey: _idempotencyKey,
          );
      if (!mounted) return;
      refreshProductData(ref, updated.id);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Stock received. Now ${updated.quantity} on hand.'),
        ),
      );
      context.pop();
    } on Failure catch (failure) {
      if (!mounted) return;
      setState(() {
        if (failure is BusinessFailure || failure is ValidationFailure) {
          _idempotencyKey = newIdempotencyKey();
        }
        _failure = failure;
      });
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final money = ref.watch(moneyFormatterProvider);
    final p = widget.product;
    final quantity = int.tryParse(_quantity.text.trim());
    final unitCost = money.parse(_cost.text);
    final valid = quantity != null && quantity > 0 && unitCost != null;
    final currentCost = p.costMinor ?? 0;
    final newCost = valid
        ? weightedAverageCost(
            onHand: p.quantity,
            currentCostMinor: currentCost,
            received: quantity,
            receivedUnitCostMinor: unitCost,
          )
        : null;

    return Scaffold(
      appBar: AppBar(title: const Text('Receive stock')),
      bottomNavigationBar: PinnedBar(
        child: PrimaryButton(
          key: const Key('submit-receipt'),
          label: 'Receive stock',
          busy: _busy,
          onPressed: _submit,
        ),
      ),
      body: Form(
        key: _form,
        onChanged: () => setState(() {}),
        child: SingleChildScrollView(
          // Not a lazy list: every field must stay built so the whole form is validated.
          padding: const EdgeInsets.all(Space.lg),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(p.name, style: theme.textTheme.titleLarge),
              Text(
                '${p.sku} · ${p.quantity} on hand',
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
              const SizedBox(height: Space.lg),
              if (_failure != null) ...[
                Notice(message: describeFailure(_failure!)),
                const SizedBox(height: Space.lg),
              ],
              LabeledField(
                key: const Key('field-quantity'),
                label: 'Quantity received',
                controller: _quantity,
                keyboardType: TextInputType.number,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                textInputAction: TextInputAction.next,
                enabled: !_busy,
                validator: (v) => StockValidators.wholeNumber(v, min: 1),
              ),
              const SizedBox(height: Space.lg),
              LabeledField(
                key: const Key('field-cost'),
                label: 'Cost per item (${money.currencyCode})',
                controller: _cost,
                keyboardType: const TextInputType.numberWithOptions(
                  decimal: true,
                ),
                inputFormatters: [decimalInput],
                textInputAction: TextInputAction.next,
                enabled: !_busy,
                validator: (v) => StockValidators.money(v, money),
              ),
              const SizedBox(height: Space.lg),
              LabeledField(
                key: const Key('field-supplier'),
                label: 'Supplier (optional)',
                controller: _supplier,
                textInputAction: TextInputAction.next,
                enabled: !_busy,
                validator: (v) => (v ?? '').trim().length > 120
                    ? 'Use at most 120 characters.'
                    : null,
              ),
              const SizedBox(height: Space.lg),
              LabeledField(
                key: const Key('field-note'),
                label: 'Reference or note (optional)',
                controller: _note,
                textInputAction: TextInputAction.done,
                enabled: !_busy,
                validator: (v) => (v ?? '').trim().length > 240
                    ? 'Use at most 240 characters.'
                    : null,
              ),
              const SizedBox(height: Space.lg),
              SectionCard(
                title: 'After receiving',
                children: [
                  FactRow(
                    label: 'Total purchase value',
                    value: valid ? money.format(quantity * unitCost) : '—',
                    emphasize: true,
                  ),
                  FactRow(
                    label: 'Stock',
                    value: valid
                        ? '${p.quantity} → ${p.quantity + quantity} pcs'
                        : '${p.quantity} pcs',
                  ),
                  FactRow(
                    label: 'Average cost',
                    value: newCost == null || newCost == currentCost
                        ? money.format(currentCost)
                        : '${money.format(currentCost)} → ${money.format(newCost)}',
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
