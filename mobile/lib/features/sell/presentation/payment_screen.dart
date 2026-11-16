import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:material_ui/material_ui.dart';

import '../../../app/router/routes.dart';
import '../../../app/theme/tokens.dart';
import '../../../core/api/failure.dart';
import '../../../core/api/failure_messages.dart';
import '../../../core/api/idempotency.dart';
import '../../../core/auth/session_controller.dart';
import '../../../core/money/money_providers.dart';
import '../../../core/time/clock.dart';
import '../../../core/widgets/labeled_field.dart';
import '../../../core/widgets/notice.dart';
import '../../../core/widgets/primary_button.dart';
import '../../../core/widgets/sections.dart';
import '../../../core/widgets/state_views.dart';
import '../../documents/data/document.dart';
import '../../documents/presentation/document_controllers.dart';
import '../../products/presentation/inventory_controllers.dart'
    show inventoryListProvider;
import '../data/sales_api.dart';
import 'cart_controller.dart';
import 'sale_navigation.dart';
import 'sell_screen.dart' show sellableProductsProvider;

/// D5 Payment: how much is received now, how, and when the rest is due.
///
/// "Credit" and "Partial" are outcomes of the amount entered, not payment methods — the screen
/// states the outcome in words before anything is saved.
class PaymentScreen extends ConsumerStatefulWidget {
  const PaymentScreen({super.key});

  @override
  ConsumerState<PaymentScreen> createState() => _PaymentScreenState();
}

class _PaymentScreenState extends ConsumerState<PaymentScreen> {
  final _form = GlobalKey<FormState>();
  final _amount = TextEditingController();
  final _reference = TextEditingController();
  late final _creditDays = TextEditingController(
    text: '${ref.read(currentUserProvider)?.settings.defaultCreditDays ?? 30}',
  );
  PaymentMethod _method = PaymentMethod.cash;
  String _idempotencyKey = newIdempotencyKey();
  bool _amountEdited = false;
  bool _busy = false;
  Failure? _failure;

  @override
  void dispose() {
    _amount.dispose();
    _reference.dispose();
    _creditDays.dispose();
    super.dispose();
  }

  String _plain(int minor) => ref
      .read(moneyFormatterProvider)
      .format(minor, withCode: false)
      .replaceAll(',', '');

  void _setAmount(int minor) => setState(() {
    _amountEdited = true;
    _amount.text = _plain(minor);
  });

  Future<void> _submit(int total) async {
    if (_busy) return;
    setState(() => _failure = null);
    if (!_form.currentState!.validate()) return;
    final money = ref.read(moneyFormatterProvider);
    final cart = ref.read(cartProvider);
    final received = money.parse(_amount.text)!;
    final balance = total - received;
    final days = int.tryParse(_creditDays.text.trim());

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Create this invoice?'),
        content: Text(
          [
            cart.customer!.displayName,
            'Total ${money.format(total)}',
            received > 0
                ? 'Received now ${money.format(received)} (${_method.label.toLowerCase()})'
                : 'Nothing received now',
            if (balance > 0) 'Balance ${money.format(balance)}',
            'Stock is reduced for ${cart.units} ${cart.units == 1 ? 'item' : 'items'}.',
          ].join('\n'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Not yet'),
          ),
          TextButton(
            key: const Key('confirm-invoice'),
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Create invoice'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    setState(() => _busy = true);
    try {
      final invoice = await ref
          .read(salesApiProvider)
          .createInvoice(
            customerId: cart.customer!.id,
            quotationId: cart.quotationId,
            lines: cart.lines.map((l) => l.toSaleLine()).toList(),
            discountMinor: cart.discountMinor,
            taxRateId: cart.taxRateId,
            notes: cart.notes,
            receivedMinor: received,
            method: _method,
            reference:
                _method == PaymentMethod.bankTransfer &&
                    _reference.text.trim().isNotEmpty
                ? _reference.text.trim()
                : null,
            creditDays: balance > 0 ? days : null,
            idempotencyKey: _idempotencyKey,
          );
      if (!mounted) return;
      ref.read(cartProvider.notifier).clear();
      // Stock changed: lists that show it reload.
      ref.invalidate(sellableProductsProvider);
      ref.invalidate(inventoryListProvider);
      refreshDocuments(ref);
      finishSaleAt(context, Routes.invoice(invoice.id));
    } on Failure catch (failure) {
      if (!mounted) return;
      final cartProblem =
          failure is BusinessFailure &&
          const {
            'INSUFFICIENT_STOCK',
            'PRICE_BELOW_MINIMUM',
            'PRICE_ABOVE_MAXIMUM',
            'PRODUCT_UNAVAILABLE',
            'DISCOUNT_EXCEEDS_SUBTOTAL',
          }.contains(failure.code);
      if (failure is BusinessFailure || failure is ValidationFailure) {
        _idempotencyKey = newIdempotencyKey();
      }
      if (cartProblem) {
        // Something changed since the cart was reviewed (for example another sale took the stock).
        // Nothing was saved; go back to the cart, which shows what to fix.
        ref.invalidate(cartPreviewProvider);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              '${describeFailure(failure)} Review the cart — nothing was saved.',
            ),
          ),
        );
        context.pop();
        return;
      }
      setState(() => _failure = failure);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final tokens = VeloraTokens.of(context);
    final money = ref.watch(moneyFormatterProvider);
    final cart = ref.watch(cartProvider);
    final preview = ref.watch(cartPreviewProvider);
    final loaded = preview.value;

    if (cart.isEmpty || cart.customer == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Payment')),
        body: MessageView(
          icon: Icons.shopping_bag_outlined,
          title: 'Nothing to pay for yet',
          actionLabel: 'Back',
          onAction: () => context.pop(),
        ),
      );
    }
    if (loaded == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Payment')),
        body: AsyncValueView<PricePreview?>(
          value: preview,
          onRetry: () => ref.invalidate(cartPreviewProvider),
          data: (_) => const SizedBox.shrink(),
        ),
      );
    }

    final total = loaded.totalMinor;
    // Full payment is the default; once the user types, their amount is kept.
    if (!_amountEdited && _amount.text != _plain(total)) {
      _amount.text = _plain(total);
    }
    final received = money.parse(_amount.text);
    final valid = received != null && received <= total;
    final balance = valid ? total - received : null;
    final days = int.tryParse(_creditDays.text.trim());
    final due =
        balance != null &&
            balance > 0 &&
            days != null &&
            days >= 0 &&
            days <= 365
        ? DateFormat('d MMM yyyy')
              .format(ref.watch(clockProvider)().add(Duration(days: days)))
        : null;
    final (outcome, tone) = switch (balance) {
      null => ('Enter the amount received now.', StatusTone.neutral),
      0 => ('The invoice will be marked Paid.', StatusTone.success),
      _ when received == 0 => (
        'Credit sale — ${money.format(balance)} due${due == null ? '' : ' $due'}.',
        StatusTone.warning,
      ),
      _ => (
        'Partially paid — ${money.format(balance)} due${due == null ? '' : ' $due'}.',
        StatusTone.warning,
      ),
    };

    return Scaffold(
      appBar: AppBar(title: const Text('Payment')),
      bottomNavigationBar: PinnedBar(
        child: PrimaryButton(
          key: const Key('create-invoice'),
          label: 'Create invoice',
          busy: _busy,
          onPressed: () => _submit(total),
        ),
      ),
      body: Form(
        key: _form,
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(Space.lg),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                cart.customer!.displayName,
                style: theme.textTheme.titleMedium,
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: Space.xs),
              Text(
                'Invoice total',
                style: tokens.overline,
                textAlign: TextAlign.center,
              ),
              Text(
                money.format(total),
                key: const Key('payment-total'),
                style: tokens.displayMoney,
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: Space.xl),
              if (_failure != null) ...[
                Notice(message: describeFailure(_failure!)),
                const SizedBox(height: Space.lg),
              ],
              LabeledField(
                key: const Key('payment-amount'),
                label: 'Amount received now (${money.currencyCode})',
                controller: _amount,
                keyboardType: const TextInputType.numberWithOptions(
                  decimal: true,
                ),
                inputFormatters: [
                  FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]')),
                ],
                enabled: !_busy,
                onChanged: (_) => setState(() => _amountEdited = true),
                validator: (v) {
                  final parsed = money.parse(v ?? '');
                  if (parsed == null) {
                    return 'Enter a valid amount, or 0 for a credit sale.';
                  }
                  if (parsed > total) {
                    return 'Cannot be more than the total of ${money.format(total)}.';
                  }
                  return null;
                },
              ),
              const SizedBox(height: Space.sm),
              Wrap(
                spacing: Space.sm,
                children: [
                  ActionChip(
                    key: const Key('amount-full'),
                    label: const Text('Full'),
                    materialTapTargetSize: MaterialTapTargetSize.padded,
                    onPressed: _busy ? null : () => _setAmount(total),
                  ),
                  ActionChip(
                    key: const Key('amount-half'),
                    label: const Text('Half'),
                    materialTapTargetSize: MaterialTapTargetSize.padded,
                    onPressed: _busy ? null : () => _setAmount(total ~/ 2),
                  ),
                  ActionChip(
                    key: const Key('amount-none'),
                    label: const Text('None (credit)'),
                    materialTapTargetSize: MaterialTapTargetSize.padded,
                    onPressed: _busy ? null : () => _setAmount(0),
                  ),
                ],
              ),
              if (received != null && received > 0) ...[
                const SizedBox(height: Space.lg),
                SegmentedButton<PaymentMethod>(
                  segments: [
                    for (final m in PaymentMethod.values)
                      ButtonSegment(value: m, label: Text(m.label)),
                  ],
                  selected: {_method},
                  showSelectedIcon: false,
                  onSelectionChanged: _busy
                      ? null
                      : (s) => setState(() => _method = s.first),
                ),
                if (_method == PaymentMethod.bankTransfer) ...[
                  const SizedBox(height: Space.lg),
                  LabeledField(
                    key: const Key('payment-reference'),
                    label: 'Bank reference (optional)',
                    controller: _reference,
                    enabled: !_busy,
                    validator: (v) => (v ?? '').trim().length > 80
                        ? 'Use at most 80 characters.'
                        : null,
                  ),
                ],
              ],
              if (balance != null && balance > 0) ...[
                const SizedBox(height: Space.lg),
                LabeledField(
                  key: const Key('payment-credit-days'),
                  label: 'Balance due in (days)',
                  controller: _creditDays,
                  keyboardType: TextInputType.number,
                  inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                  enabled: !_busy,
                  onChanged: (_) => setState(() {}),
                  validator: (v) {
                    final n = int.tryParse((v ?? '').trim());
                    return n == null || n > 365
                        ? 'Enter a number of days from 0 to 365.'
                        : null;
                  },
                ),
              ],
              const SizedBox(height: Space.lg),
              Notice(
                key: const Key('payment-outcome'),
                message: outcome,
                tone: tone,
                icon: Icons.info_outline,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
