import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../../../app/theme/tokens.dart';
import '../../../core/auth/session_controller.dart';
import '../../../core/money/money_format.dart';
import '../../../core/money/money_providers.dart';
import '../../../core/widgets/labeled_field.dart';
import '../../../core/widgets/primary_button.dart';
import '../../../core/widgets/sections.dart';

/// What the price sheet returns.
typedef PricedChoice = ({
  int quantity,
  int unitPriceMinor,
  String? belowMinimumReason,
});

/// D2 Price sheet: choose the selling price and quantity for one product.
///
/// Everyone chooses a price between the product's lowest and highest price. Managers also see
/// cost, markup and profit, and may go below the lowest price with a reason. Sales staff never
/// see a percentage or a cost here (decision D1) — the server does not send them either.
Future<PricedChoice?> showPriceSheet(
  BuildContext context, {
  required String name,
  required String sku,
  required int listPriceMinor,
  required int floorPriceMinor,
  required int ceilingPriceMinor,
  required int maxQuantity,
  int? costMinor,
  int? initialQuantity,
  int? initialPriceMinor,
  String? initialReason,
}) => showModalBottomSheet<PricedChoice>(
  context: context,
  isScrollControlled: true,
  useSafeArea: true,
  showDragHandle: true,
  builder: (_) => _PriceSheet(
    name: name,
    sku: sku,
    listPriceMinor: listPriceMinor,
    floorPriceMinor: floorPriceMinor,
    ceilingPriceMinor: ceilingPriceMinor,
    maxQuantity: maxQuantity,
    costMinor: costMinor,
    initialQuantity: initialQuantity,
    initialPriceMinor: initialPriceMinor,
    initialReason: initialReason,
  ),
);

class _PriceSheet extends ConsumerStatefulWidget {
  const _PriceSheet({
    required this.name,
    required this.sku,
    required this.listPriceMinor,
    required this.floorPriceMinor,
    required this.ceilingPriceMinor,
    required this.maxQuantity,
    this.costMinor,
    this.initialQuantity,
    this.initialPriceMinor,
    this.initialReason,
  });

  final String name;
  final String sku;
  final int listPriceMinor;
  final int floorPriceMinor;
  final int ceilingPriceMinor;
  final int maxQuantity;
  final int? costMinor;
  final int? initialQuantity;
  final int? initialPriceMinor;
  final String? initialReason;

  @override
  ConsumerState<_PriceSheet> createState() => _PriceSheetState();
}

class _PriceSheetState extends ConsumerState<_PriceSheet> {
  late final MoneyFormatter _money = ref.read(moneyFormatterProvider);
  late int _price = widget.initialPriceMinor ?? widget.listPriceMinor;
  late int _quantity = (widget.initialQuantity ?? 1).clamp(
    1,
    widget.maxQuantity < 1 ? 1 : widget.maxQuantity,
  );
  late final _priceField = TextEditingController(text: _plain(_price));
  late final _reason = TextEditingController(text: widget.initialReason);
  late bool _below = widget.initialReason != null;
  String? _priceError;
  String? _reasonError;

  bool get _isEdit => widget.initialPriceMinor != null;
  String _plain(int minor) =>
      _money.format(minor, withCode: false).replaceAll(',', '');

  @override
  void dispose() {
    _priceField.dispose();
    _reason.dispose();
    super.dispose();
  }

  void _setPrice(int minor) => setState(() {
    _price = minor;
    _priceField.text = _plain(minor);
    _priceError = null;
  });

  void _onTyped(String text) {
    final parsed = _money.parse(text);
    setState(() {
      _priceError = parsed == null ? 'Enter a valid amount.' : null;
      if (parsed != null) _price = parsed;
    });
  }

  void _submit() {
    final parsed = _money.parse(_priceField.text);
    final canGoBelow =
        ref.read(currentUserProvider)?.can('sale.below_minimum') ?? false;
    String? priceError;
    String? reasonError;
    if (parsed == null) {
      priceError = 'Enter a valid amount.';
    } else if (parsed > widget.ceilingPriceMinor) {
      priceError =
          'Highest allowed price is ${_money.format(widget.ceilingPriceMinor)}.';
    } else if (parsed < widget.floorPriceMinor) {
      if (!(canGoBelow && _below)) {
        priceError =
            'Lowest allowed price is ${_money.format(widget.floorPriceMinor)}.';
      } else if (_reason.text.trim().length < 3) {
        reasonError = 'Say why this is sold below the lowest price.';
      }
    }
    setState(() {
      _priceError = priceError;
      _reasonError = reasonError;
    });
    if (priceError != null || reasonError != null || parsed == null) return;
    final below = parsed < widget.floorPriceMinor;
    Navigator.of(context).pop((
      quantity: _quantity,
      unitPriceMinor: parsed,
      belowMinimumReason: below ? _reason.text.trim() : null,
    ));
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final tokens = VeloraTokens.of(context);
    final muted = theme.textTheme.bodyMedium?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    final canGoBelow =
        ref.watch(currentUserProvider)?.can('sale.below_minimum') ?? false;
    final cost = widget.costMinor;
    final floor = widget.floorPriceMinor;
    final ceiling = widget.ceilingPriceMinor;
    final sliderValue = _price.clamp(floor, ceiling).toDouble();
    final outOfStock = widget.maxQuantity < 1;

    return Padding(
      // Keeps the sheet above the keyboard.
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(Space.lg, 0, Space.lg, Space.lg),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Semantics(
              header: true,
              child: Text(widget.name, style: theme.textTheme.titleLarge),
            ),
            Text(
              outOfStock
                  ? '${widget.sku} · none left to add'
                  : '${widget.sku} · ${widget.maxQuantity} available',
              style: muted,
            ),
            const SizedBox(height: Space.lg),
            LabeledField(
              key: const Key('price-field'),
              label: 'Selling price per item (${_money.currencyCode})',
              controller: _priceField,
              errorText: _priceError,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              inputFormatters: [
                FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]')),
              ],
              onChanged: _onTyped,
              onSubmitted: (_) => _submit(),
            ),
            if (ceiling > floor)
              Slider(
                key: const Key('price-slider'),
                value: sliderValue,
                min: floor.toDouble(),
                max: ceiling.toDouble(),
                label: _money.format(sliderValue.round()),
                semanticFormatterCallback: (v) => _money.format(v.round()),
                onChanged: (v) => _setPrice(v.round()),
              ),
            Wrap(
              alignment: WrapAlignment.spaceBetween,
              spacing: Space.md,
              children: [
                Text(
                  'Lowest ${_money.format(floor)}',
                  style: theme.textTheme.bodySmall,
                ),
                TextButton(
                  key: const Key('use-list-price'),
                  onPressed: () => _setPrice(widget.listPriceMinor),
                  child: Text('List ${_money.format(widget.listPriceMinor)}'),
                ),
                Text(
                  'Highest ${_money.format(ceiling)}',
                  style: theme.textTheme.bodySmall,
                ),
              ],
            ),
            if (cost != null) ...[
              const Divider(height: Space.xxl),
              FactRow(label: 'Cost', value: _money.format(cost)),
              FactRow(
                label: 'Profit per item',
                value:
                    '${_money.format(_price - cost)}${cost > 0 ? ' · ${formatBasisPoints(((_price - cost) * 10000) ~/ cost)}' : ''}',
              ),
            ],
            if (canGoBelow) ...[
              SwitchListTile(
                key: const Key('below-switch'),
                contentPadding: EdgeInsets.zero,
                title: const Text('Sell below the lowest price'),
                value: _below,
                onChanged: (v) => setState(() {
                  _below = v;
                  _priceError = null;
                }),
              ),
              if (_below)
                LabeledField(
                  key: const Key('below-reason'),
                  label: 'Reason (recorded with the sale)',
                  controller: _reason,
                  errorText: _reasonError,
                ),
            ],
            const SizedBox(height: Space.lg),
            Row(
              children: [
                Expanded(
                  child: Text('Quantity', style: theme.textTheme.titleMedium),
                ),
                QuantityStepper(
                  value: _quantity,
                  min: 1,
                  max: outOfStock ? 1 : widget.maxQuantity,
                  onChanged: (v) => setState(() => _quantity = v),
                ),
              ],
            ),
            const SizedBox(height: Space.lg),
            MergeSemantics(
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      'Line total',
                      style: theme.textTheme.bodyMedium,
                    ),
                  ),
                  Text(
                    _money.format(_price * _quantity),
                    key: const Key('line-total'),
                    style: tokens.moneyRow,
                  ),
                ],
              ),
            ),
            const SizedBox(height: Space.md),
            PrimaryButton(
              key: const Key('price-submit'),
              label: _isEdit ? 'Update' : 'Add to cart',
              onPressed: outOfStock ? null : _submit,
            ),
          ],
        ),
      ),
    );
  }
}

/// − value + with full-size touch targets; the ends disable at the limits.
class QuantityStepper extends StatelessWidget {
  const QuantityStepper({
    super.key,
    required this.value,
    required this.min,
    required this.max,
    required this.onChanged,
  });
  final int value;
  final int min;
  final int max;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Semantics(
      label: 'Quantity',
      value: '$value',
      container: true,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          IconButton.outlined(
            key: const Key('qty-minus'),
            tooltip: 'One fewer',
            constraints: const BoxConstraints(
              minWidth: Space.touchTarget,
              minHeight: Space.touchTarget,
            ),
            onPressed: value > min ? () => onChanged(value - 1) : null,
            icon: const Icon(Icons.remove),
          ),
          ConstrainedBox(
            constraints: const BoxConstraints(minWidth: 48),
            child: ExcludeSemantics(
              child: Text(
                '$value',
                key: const Key('qty-value'),
                textAlign: TextAlign.center,
                style: theme.textTheme.titleLarge,
              ),
            ),
          ),
          IconButton.outlined(
            key: const Key('qty-plus'),
            tooltip: 'One more',
            constraints: const BoxConstraints(
              minWidth: Space.touchTarget,
              minHeight: Space.touchTarget,
            ),
            onPressed: value < max ? () => onChanged(value + 1) : null,
            icon: const Icon(Icons.add),
          ),
        ],
      ),
    );
  }
}
