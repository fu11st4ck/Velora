import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../../app/theme/tokens.dart';
import '../../../core/api/failure.dart';
import '../../../core/api/failure_messages.dart';
import '../../../core/api/idempotency.dart';
import '../../../core/widgets/labeled_field.dart';
import '../../../core/widgets/notice.dart';
import '../../../core/widgets/primary_button.dart';
import '../../../core/widgets/state_views.dart';
import '../data/product.dart';
import '../data/products_api.dart';
import 'form_helpers.dart';
import 'inventory_controllers.dart';
import 'product_widgets.dart';

enum _Direction { remove, add }

const _reasons = ['Count correction', 'Damaged', 'Lost', 'Other'];

/// C5 Adjust stock, with a mandatory reason and a confirmation before anything changes.
class AdjustStockScreen extends ConsumerWidget {
  const AdjustStockScreen({super.key, required this.productId});
  final String productId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final product = ref.watch(productProvider(productId));
    return product.hasValue
        ? _AdjustForm(product: product.value!)
        : Scaffold(
            appBar: AppBar(title: const Text('Adjust stock')),
            body: AsyncValueView<Product>(
              value: product,
              onRetry: () => ref.invalidate(productProvider(productId)),
              data: (_) => const SizedBox.shrink(),
            ),
          );
  }
}

class _AdjustForm extends ConsumerStatefulWidget {
  const _AdjustForm({required this.product});
  final Product product;

  @override
  ConsumerState<_AdjustForm> createState() => _AdjustFormState();
}

class _AdjustFormState extends ConsumerState<_AdjustForm> {
  final _form = GlobalKey<FormState>();
  final _quantity = TextEditingController();
  final _otherReason = TextEditingController();
  _Direction _direction = _Direction.remove;
  String? _reason;
  bool _reasonMissing = false;
  String _idempotencyKey = newIdempotencyKey();
  bool _busy = false;
  Failure? _failure;

  @override
  void dispose() {
    _quantity.dispose();
    _otherReason.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_busy) return;
    setState(() {
      _failure = null;
      _reasonMissing = _reason == null;
    });
    if (!_form.currentState!.validate() || _reason == null) return;

    final p = widget.product;
    final amount = int.parse(_quantity.text.trim());
    final delta = _direction == _Direction.remove ? -amount : amount;
    final reason = _reason == 'Other' ? _otherReason.text.trim() : _reason!;

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(
          _direction == _Direction.remove
              ? 'Remove $amount from stock?'
              : 'Add $amount to stock?',
        ),
        content: Text(
          '${p.name}\nStock: ${p.quantity} → ${p.quantity + delta} pcs\nReason: $reason',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          TextButton(
            key: const Key('confirm-adjust'),
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Adjust stock'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    setState(() => _busy = true);
    try {
      final updated = await ref
          .read(productsApiProvider)
          .adjust(
            productId: p.id,
            quantityDelta: delta,
            reason: reason,
            idempotencyKey: _idempotencyKey,
          );
      if (!mounted) return;
      refreshProductData(ref, updated.id);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Stock adjusted. Now ${updated.quantity} on hand.'),
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
      // Someone else may have changed the stock; show the current figure.
      if (failure is BusinessFailure && failure.code == 'INSUFFICIENT_STOCK') {
        ref.invalidate(productProvider(p.id));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final p = widget.product;
    final amount = int.tryParse(_quantity.text.trim());
    final removing = _direction == _Direction.remove;
    final after = amount == null
        ? null
        : p.quantity + (removing ? -amount : amount);

    return Scaffold(
      appBar: AppBar(title: const Text('Adjust stock')),
      bottomNavigationBar: PinnedBar(
        child: PrimaryButton(
          key: const Key('submit-adjustment'),
          label: 'Review adjustment',
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
              SegmentedButton<_Direction>(
                segments: const [
                  ButtonSegment(
                    value: _Direction.remove,
                    label: Text('Remove'),
                    icon: Icon(Icons.remove),
                  ),
                  ButtonSegment(
                    value: _Direction.add,
                    label: Text('Add'),
                    icon: Icon(Icons.add),
                  ),
                ],
                selected: {_direction},
                showSelectedIcon: false,
                onSelectionChanged: _busy
                    ? null
                    : (s) => setState(() => _direction = s.first),
              ),
              const SizedBox(height: Space.lg),
              LabeledField(
                key: const Key('field-quantity'),
                label: 'Quantity',
                controller: _quantity,
                keyboardType: TextInputType.number,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                enabled: !_busy,
                // Removing is capped at what is on hand, so the request cannot be refused for that.
                validator: (v) => StockValidators.wholeNumber(
                  v,
                  min: 1,
                  max: removing ? p.quantity : StockValidators.maxQuantity,
                  unit: removing ? 'on hand' : null,
                ),
              ),
              const SizedBox(height: Space.lg),
              Text(
                'Reason',
                style: theme.textTheme.labelMedium?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
              const SizedBox(height: Space.sm),
              Wrap(
                spacing: Space.sm,
                children: [
                  for (final r in _reasons)
                    ChoiceChip(
                      key: Key('reason-$r'),
                      label: Text(r),
                      selected: _reason == r,
                      showCheckmark: false,
                      materialTapTargetSize: MaterialTapTargetSize.padded,
                      onSelected: _busy
                          ? null
                          : (_) => setState(() {
                              _reason = r;
                              _reasonMissing = false;
                            }),
                    ),
                ],
              ),
              if (_reasonMissing)
                Padding(
                  padding: const EdgeInsets.only(top: Space.xs),
                  child: Text(
                    'Choose a reason.',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.error,
                    ),
                  ),
                ),
              if (_reason == 'Other') ...[
                const SizedBox(height: Space.lg),
                LabeledField(
                  key: const Key('field-other-reason'),
                  label: 'Describe the reason',
                  controller: _otherReason,
                  enabled: !_busy,
                  validator: (v) {
                    final text = (v ?? '').trim();
                    if (text.length < 3) {
                      return 'Describe the reason (at least 3 characters).';
                    }
                    return text.length > 240
                        ? 'Use at most 240 characters.'
                        : null;
                  },
                ),
              ],
              const SizedBox(height: Space.lg),
              SectionCard(
                title: 'After adjusting',
                children: [
                  FactRow(
                    label: 'Stock',
                    value: after == null || after < 0
                        ? '${p.quantity} pcs'
                        : '${p.quantity} → $after pcs',
                    emphasize: true,
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
