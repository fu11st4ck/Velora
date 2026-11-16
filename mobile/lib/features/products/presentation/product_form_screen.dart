import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../../app/theme/tokens.dart';
import '../../../core/api/failure.dart';
import '../../../core/api/failure_messages.dart';
import '../../../core/api/idempotency.dart';
import '../../../core/auth/session_controller.dart';
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

/// C3 New / Edit product. With [productId] the form edits that product; otherwise it creates one.
class ProductFormScreen extends ConsumerWidget {
  const ProductFormScreen({super.key, this.productId});
  final String? productId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final id = productId;
    if (id == null) return const _ProductForm();
    final product = ref.watch(productProvider(id));
    return product.hasValue
        ? _ProductForm(existing: product.value)
        : Scaffold(
            appBar: AppBar(title: const Text('Edit product')),
            body: AsyncValueView<Product>(
              value: product,
              onRetry: () => ref.invalidate(productProvider(id)),
              data: (_) => const SizedBox.shrink(),
            ),
          );
  }
}

class _ProductForm extends ConsumerStatefulWidget {
  const _ProductForm({this.existing});
  final Product? existing;

  @override
  ConsumerState<_ProductForm> createState() => _ProductFormState();
}

class _ProductFormState extends ConsumerState<_ProductForm> {
  final _form = GlobalKey<FormState>();
  late final Product? _existing = widget.existing;
  late final _name = TextEditingController(text: _existing?.name);
  late final _sku = TextEditingController(text: _existing?.sku);
  late final _barcode = TextEditingController(text: _existing?.barcode);
  late final _description = TextEditingController(text: _existing?.description);
  late final _weight = TextEditingController(text: _existing?.weight?.value);
  late WeightUnit _weightUnit = _existing?.weight?.unit ?? WeightUnit.g;
  final _cost = TextEditingController();
  late final _defaultMarkup = TextEditingController(
    text: bpToPercentInput(_existing?.defaultMarkupBp ?? 3000),
  );
  late final _minMarkup = TextEditingController(
    text: bpToPercentInput(_existing?.minMarkupBp ?? 1500),
  );
  final _quantity = TextEditingController();
  late final _reorder = TextEditingController(
    text: _existing?.reorderLevel?.toString(),
  );
  final _supplier = TextEditingController();

  String _idempotencyKey = newIdempotencyKey();
  bool _busy = false;
  bool _dirty = false;
  Failure? _failure;
  String? _skuError;
  String? _barcodeError;

  bool get _isEdit => _existing != null;

  @override
  void dispose() {
    for (final c in [
      _name,
      _sku,
      _barcode,
      _description,
      _weight,
      _cost,
      _defaultMarkup,
      _minMarkup,
      _quantity,
      _reorder,
      _supplier,
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  String? _nullIfBlank(TextEditingController c) =>
      c.text.trim().isEmpty ? null : c.text.trim();

  String? _validateMinMarkup(String? value) {
    final base = StockValidators.percent(value);
    if (base != null) return base;
    final min = parsePercentToBp(value!)!;
    final def = parsePercentToBp(_defaultMarkup.text);
    return def != null && min > def
        ? 'Must not exceed the default markup.'
        : null;
  }

  String? _validateDefaultMarkup(String? value) {
    final base = StockValidators.percent(value);
    if (base != null) return base;
    final max = ref.read(currentUserProvider)?.settings.maxMarkupBp;
    return max != null && parsePercentToBp(value!)! > max
        ? 'Must not exceed ${bpToPercentInput(max)}%.'
        : null;
  }

  Future<void> _submit() async {
    if (_busy) return;
    setState(() {
      _failure = null;
      _skuError = null;
      _barcodeError = null;
    });
    if (!_form.currentState!.validate()) return;

    final money = ref.read(moneyFormatterProvider);
    final api = ref.read(productsApiProvider);
    final weightText = _nullIfBlank(_weight);
    final weight = weightText == null
        ? null
        : Weight(value: weightText, unit: _weightUnit);
    final defaultBp = parsePercentToBp(_defaultMarkup.text)!;
    final minBp = parsePercentToBp(_minMarkup.text)!;
    final reorder = _nullIfBlank(_reorder);

    setState(() => _busy = true);
    try {
      final Product saved;
      if (_isEdit) {
        saved = await api.update(
          _existing!.id,
          version: _existing.version,
          changes: {
            'name': _name.text.trim(),
            'sku': _sku.text.trim(),
            'barcode': _nullIfBlank(_barcode),
            'description': _nullIfBlank(_description),
            'weight': weight?.toJson(),
            'defaultMarkupBp': defaultBp,
            'minMarkupBp': minBp,
            'reorderLevel': reorder == null ? null : int.parse(reorder),
          },
        );
      } else {
        saved = await api.create(
          NewProduct(
            name: _name.text.trim(),
            sku: _nullIfBlank(_sku),
            barcode: _nullIfBlank(_barcode),
            description: _nullIfBlank(_description),
            weight: weight,
            costMinor: money.parse(_cost.text)!,
            defaultMarkupBp: defaultBp,
            minMarkupBp: minBp,
            openingQuantity: int.parse(_quantity.text.trim()),
            reorderLevel: reorder == null ? null : int.parse(reorder),
            supplierName: _nullIfBlank(_supplier),
          ),
          idempotencyKey: _idempotencyKey,
        );
      }
      if (!mounted) return;
      refreshProductData(ref, saved.id);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            _isEdit
                ? '${saved.name} updated'
                : '${saved.name} added to inventory',
          ),
        ),
      );
      _dirty = false;
      context.pop();
    } on Failure catch (failure) {
      if (!mounted) return;
      setState(() {
        // After a rejection the input will change, so the next attempt is a new request.
        if (failure is BusinessFailure || failure is ValidationFailure) {
          _idempotencyKey = newIdempotencyKey();
        }
        if (failure is BusinessFailure && failure.code == 'SKU_TAKEN') {
          _skuError = describeFailure(failure);
        } else if (failure is BusinessFailure &&
            failure.code == 'BARCODE_TAKEN') {
          _barcodeError = describeFailure(failure);
        } else {
          _failure = failure;
        }
      });
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<bool> _confirmDiscard() async {
    if (!_dirty) return true;
    final discard = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Discard changes?'),
        content: const Text('What you entered will not be saved.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Keep editing'),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Discard'),
          ),
        ],
      ),
    );
    return discard ?? false;
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final money = ref.watch(moneyFormatterProvider);
    final settings = ref.watch(currentUserProvider)?.settings;

    // Live previews. The server recalculates everything on save.
    final cost = _isEdit ? _existing!.costMinor : money.parse(_cost.text);
    final defaultBp = parsePercentToBp(_defaultMarkup.text);
    final minBp = parsePercentToBp(_minMarkup.text);
    final quantity = int.tryParse(_quantity.text.trim());
    final listPrice = cost != null && defaultBp != null
        ? money.format(priceFromMarkup(cost, defaultBp))
        : '—';
    final floorPrice = cost != null && minBp != null
        ? money.format(priceFromMarkup(cost, minBp))
        : '—';
    final total = !_isEdit && cost != null && quantity != null
        ? money.format(cost * quantity)
        : null;

    return PopScope(
      canPop: !_dirty,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
        final navigator = Navigator.of(context);
        if (await _confirmDiscard()) {
          _dirty = false;
          navigator.pop();
        }
      },
      child: Scaffold(
        appBar: AppBar(title: Text(_isEdit ? 'Edit product' : 'New product')),
        bottomNavigationBar: PinnedBar(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (total != null) ...[
                MergeSemantics(
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(
                          'Total purchase value',
                          style: theme.textTheme.bodyMedium,
                        ),
                      ),
                      Text(
                        total,
                        key: const Key('purchase-total'),
                        style: VeloraTokens.of(context).moneyRow,
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: Space.md),
              ],
              PrimaryButton(
                key: const Key('save-product'),
                label: _isEdit ? 'Save changes' : 'Save product',
                busy: _busy,
                onPressed: _submit,
              ),
            ],
          ),
        ),
        body: Form(
          key: _form,
          onChanged: () => setState(() => _dirty = true),
          child: SingleChildScrollView(
            // Not a lazy list: every field must stay built so the whole form is validated.
            padding: const EdgeInsets.all(Space.lg),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (_failure != null) ...[
                  Notice(message: describeFailure(_failure!)),
                  const SizedBox(height: Space.lg),
                ],
                SectionCard(
                  title: 'Details',
                  children: [
                    LabeledField(
                      key: const Key('field-name'),
                      label: 'Name',
                      controller: _name,
                      hint: 'e.g. Alhambra Gold Bracelet',
                      textInputAction: TextInputAction.next,
                      enabled: !_busy,
                      validator: (v) => (v ?? '').trim().isEmpty
                          ? 'Enter the product name.'
                          : (v!.trim().length > 120
                                ? 'Use at most 120 characters.'
                                : null),
                    ),
                    const SizedBox(height: Space.lg),
                    LabeledField(
                      key: const Key('field-sku'),
                      label: 'SKU',
                      controller: _sku,
                      hint: _isEdit ? null : 'Generated if left empty',
                      errorText: _skuError,
                      textInputAction: TextInputAction.next,
                      enabled: !_busy,
                      validator: (v) =>
                          StockValidators.sku(v, required: _isEdit),
                    ),
                    const SizedBox(height: Space.lg),
                    LabeledField(
                      key: const Key('field-barcode'),
                      label: 'Barcode (optional)',
                      controller: _barcode,
                      errorText: _barcodeError,
                      textInputAction: TextInputAction.next,
                      enabled: !_busy,
                      validator: (v) => (v ?? '').trim().length > 64
                          ? 'Use at most 64 characters.'
                          : null,
                    ),
                    const SizedBox(height: Space.lg),
                    LabeledField(
                      key: const Key('field-description'),
                      label: 'Description (optional)',
                      controller: _description,
                      textInputAction: TextInputAction.next,
                      enabled: !_busy,
                      validator: (v) => (v ?? '').length > 1000
                          ? 'Use at most 1000 characters.'
                          : null,
                    ),
                    const SizedBox(height: Space.lg),
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: LabeledField(
                            key: const Key('field-weight'),
                            label: 'Weight (optional)',
                            controller: _weight,
                            hint: '12.8',
                            keyboardType: const TextInputType.numberWithOptions(
                              decimal: true,
                            ),
                            inputFormatters: [
                              FilteringTextInputFormatter.allow(
                                RegExp(r'[0-9.]'),
                              ),
                            ],
                            textInputAction: TextInputAction.next,
                            enabled: !_busy,
                            validator: StockValidators.weight,
                          ),
                        ),
                        const SizedBox(width: Space.md),
                        Padding(
                          padding: const EdgeInsets.only(top: 24),
                          child: SegmentedButton<WeightUnit>(
                            segments: [
                              for (final u in WeightUnit.values)
                                ButtonSegment(value: u, label: Text(u.label)),
                            ],
                            selected: {_weightUnit},
                            showSelectedIcon: false,
                            onSelectionChanged: _busy
                                ? null
                                : (s) => setState(() {
                                    _weightUnit = s.first;
                                    _dirty = true;
                                  }),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
                const SizedBox(height: Space.lg),
                SectionCard(
                  title: 'Pricing',
                  children: [
                    if (_isEdit)
                      FactRow(
                        label: 'Cost (changes only when stock is received)',
                        value: money.format(_existing!.costMinor!),
                      )
                    else
                      LabeledField(
                        key: const Key('field-cost'),
                        label: 'Cost per item (${money.currencyCode})',
                        controller: _cost,
                        hint: '0.00',
                        keyboardType: const TextInputType.numberWithOptions(
                          decimal: true,
                        ),
                        inputFormatters: [decimalInput],
                        textInputAction: TextInputAction.next,
                        enabled: !_busy,
                        validator: (v) => StockValidators.money(v, money),
                      ),
                    const SizedBox(height: Space.lg),
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: LabeledField(
                            key: const Key('field-default-markup'),
                            label: 'Default markup %',
                            controller: _defaultMarkup,
                            keyboardType: const TextInputType.numberWithOptions(
                              decimal: true,
                            ),
                            inputFormatters: [
                              FilteringTextInputFormatter.allow(
                                RegExp(r'[0-9.]'),
                              ),
                            ],
                            textInputAction: TextInputAction.next,
                            enabled: !_busy,
                            validator: _validateDefaultMarkup,
                          ),
                        ),
                        const SizedBox(width: Space.md),
                        Expanded(
                          child: LabeledField(
                            key: const Key('field-min-markup'),
                            label: 'Minimum markup %',
                            controller: _minMarkup,
                            keyboardType: const TextInputType.numberWithOptions(
                              decimal: true,
                            ),
                            inputFormatters: [
                              FilteringTextInputFormatter.allow(
                                RegExp(r'[0-9.]'),
                              ),
                            ],
                            textInputAction: TextInputAction.next,
                            enabled: !_busy,
                            validator: _validateMinMarkup,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: Space.md),
                    FactRow(
                      label: 'List price',
                      value: listPrice,
                      emphasize: true,
                    ),
                    FactRow(label: 'Lowest price', value: floorPrice),
                  ],
                ),
                const SizedBox(height: Space.lg),
                SectionCard(
                  title: 'Stock',
                  children: [
                    if (!_isEdit) ...[
                      LabeledField(
                        key: const Key('field-quantity'),
                        label: 'Opening quantity',
                        controller: _quantity,
                        hint: '0',
                        keyboardType: TextInputType.number,
                        inputFormatters: [
                          FilteringTextInputFormatter.digitsOnly,
                        ],
                        textInputAction: TextInputAction.next,
                        enabled: !_busy,
                        validator: (v) =>
                            StockValidators.wholeNumber(v, min: 0),
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
                    ],
                    LabeledField(
                      key: const Key('field-reorder'),
                      label: 'Low-stock level (optional)',
                      controller: _reorder,
                      hint: settings == null
                          ? null
                          : 'Business default: ${settings.lowStockThreshold}',
                      keyboardType: TextInputType.number,
                      inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                      textInputAction: TextInputAction.done,
                      enabled: !_busy,
                      validator: StockValidators.optionalWholeNumber,
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
