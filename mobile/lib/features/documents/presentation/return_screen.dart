import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../../app/theme/tokens.dart';
import '../../../core/api/failure.dart';
import '../../../core/api/failure_messages.dart';
import '../../../core/api/idempotency.dart';
import '../../../core/money/money_providers.dart';
import '../../../core/widgets/labeled_field.dart';
import '../../../core/widgets/notice.dart';
import '../../../core/widgets/primary_button.dart';
import '../../../core/widgets/sections.dart';
import '../../../core/widgets/state_views.dart';
import '../../products/presentation/inventory_controllers.dart'
    show inventoryListProvider;
import '../../sell/presentation/price_sheet.dart' show QuantityStepper;
import '../../sell/presentation/sell_screen.dart' show sellableProductsProvider;
import '../data/document.dart';
import '../data/documents_api.dart';
import 'document_controllers.dart';

/// F5 Return items against an invoice.
class ReturnScreen extends ConsumerWidget {
  const ReturnScreen({super.key, required this.invoiceId});
  final String invoiceId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final invoice = ref.watch(invoiceProvider(invoiceId));
    return invoice.hasValue
        ? _ReturnForm(invoice: invoice.value!)
        : Scaffold(
            appBar: AppBar(title: const Text('Return items')),
            body: AsyncValueView<Invoice>(
              value: invoice,
              onRetry: () => ref.invalidate(invoiceProvider(invoiceId)),
              data: (_) => const SizedBox.shrink(),
            ),
          );
  }
}

class _ReturnForm extends ConsumerStatefulWidget {
  const _ReturnForm({required this.invoice});
  final Invoice invoice;

  @override
  ConsumerState<_ReturnForm> createState() => _ReturnFormState();
}

class _ReturnFormState extends ConsumerState<_ReturnForm> {
  final _form = GlobalKey<FormState>();
  final _reason = TextEditingController();
  final Map<int, int> _quantity = {};
  final Map<int, bool> _restock = {};
  PaymentMethod _refundMethod = PaymentMethod.cash;
  String _idempotencyKey = newIdempotencyKey();
  bool _busy = false;
  bool _nothingChosen = false;
  Failure? _failure;

  /// The refund the server asked a method for, once it has said one is due.
  int? _refundDueMinor;

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  int get _units => _quantity.values.fold(0, (a, b) => a + b);

  Future<void> _submit() async {
    if (_busy) return;
    setState(() {
      _failure = null;
      _nothingChosen = _units == 0;
    });
    if (!_form.currentState!.validate() || _units == 0) return;
    final messenger = ScaffoldMessenger.of(context);
    final money = ref.read(moneyFormatterProvider);
    setState(() => _busy = true);
    try {
      final updated = await ref
          .read(documentsApiProvider)
          .createReturn(
            widget.invoice.id,
            reason: _reason.text.trim(),
            lines: [
              for (final e in _quantity.entries)
                if (e.value > 0)
                  (
                    lineNo: e.key,
                    quantity: e.value,
                    restock: _restock[e.key] ?? true,
                  ),
            ],
            refundMethod: _refundDueMinor != null ? _refundMethod : null,
            idempotencyKey: _idempotencyKey,
          );
      if (!mounted) return;
      refreshDocuments(ref, invoiceId: widget.invoice.id);
      ref.invalidate(sellableProductsProvider);
      ref.invalidate(inventoryListProvider);
      final credit = updated.returns.last;
      messenger.showSnackBar(
        SnackBar(
          content: Text(
            credit.refundMinor > 0
                ? '${credit.number} created. Refund ${money.format(credit.refundMinor)} to the customer.'
                : '${credit.number} created.',
          ),
        ),
      );
      context.pop();
    } on Failure catch (failure) {
      if (!mounted) return;
      setState(() {
        if (failure is BusinessFailure || failure is ValidationFailure) {
          _idempotencyKey = newIdempotencyKey();
        }
        if (failure is BusinessFailure &&
            failure.code == 'REFUND_METHOD_REQUIRED') {
          // The server worked out that the credit exceeds what is still owed. Ask how to refund it.
          _refundDueMinor = failure.details.firstOrNull?['refundMinor'] as int?;
        } else {
          _failure = failure;
        }
      });
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final money = ref.watch(moneyFormatterProvider);
    final muted = theme.textTheme.bodyMedium?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    final lines = widget.invoice.lines.where((l) => l.returnable > 0).toList();
    final refundDue = _refundDueMinor;

    return Scaffold(
      appBar: AppBar(title: const Text('Return items')),
      bottomNavigationBar: PinnedBar(
        child: PrimaryButton(
          key: const Key('submit-return'),
          label: refundDue == null
              ? 'Create credit note'
              : 'Refund and create credit note',
          busy: _busy,
          onPressed: _submit,
        ),
      ),
      body: Form(
        key: _form,
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(Space.lg),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(widget.invoice.number, style: theme.textTheme.titleLarge),
              Text(widget.invoice.customer.displayName, style: muted),
              const SizedBox(height: Space.lg),
              if (_failure != null) ...[
                Notice(message: describeFailure(_failure!)),
                const SizedBox(height: Space.lg),
              ],
              SectionCard(
                title: 'Items to return',
                children: [
                  if (_nothingChosen)
                    Padding(
                      padding: const EdgeInsets.only(bottom: Space.sm),
                      child: Text(
                        'Choose at least one item to return.',
                        style: theme.textTheme.bodyMedium?.copyWith(
                          color: theme.colorScheme.error,
                        ),
                      ),
                    ),
                  for (final (i, l) in lines.indexed) ...[
                    if (i > 0) const Divider(),
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: Space.sm),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      l.name,
                                      style: theme.textTheme.titleSmall,
                                    ),
                                    Text(
                                      '${l.returnable} of ${l.quantity} can be returned · ${money.format(l.unitPriceMinor)} each',
                                      style: muted,
                                    ),
                                  ],
                                ),
                              ),
                              KeyedSubtree(
                                key: Key('return-line-${l.lineNo}'),
                                child: QuantityStepper(
                                  value: _quantity[l.lineNo] ?? 0,
                                  min: 0,
                                  max: l.returnable,
                                  onChanged: _busy
                                      ? (_) {}
                                      : (v) => setState(() {
                                          _quantity[l.lineNo] = v;
                                          _nothingChosen = false;
                                          // A different selection means a different credit and refund.
                                          _refundDueMinor = null;
                                        }),
                                ),
                              ),
                            ],
                          ),
                          if ((_quantity[l.lineNo] ?? 0) > 0)
                            SwitchListTile(
                              key: Key('restock-${l.lineNo}'),
                              contentPadding: EdgeInsets.zero,
                              title: const Text('Return to stock'),
                              subtitle: const Text(
                                'Turn off for damaged items',
                              ),
                              value: _restock[l.lineNo] ?? true,
                              onChanged: _busy
                                  ? null
                                  : (v) =>
                                        setState(() => _restock[l.lineNo] = v),
                            ),
                        ],
                      ),
                    ),
                  ],
                ],
              ),
              const SizedBox(height: Space.lg),
              LabeledField(
                key: const Key('return-reason'),
                label: 'Reason',
                controller: _reason,
                enabled: !_busy,
                validator: (v) => (v ?? '').trim().length < 3
                    ? 'Say why the items are returned.'
                    : null,
              ),
              const SizedBox(height: Space.lg),
              if (refundDue == null)
                const Notice(
                  message: 'The credit first reduces what the customer still owes. If it is more than that, you will be asked how to refund the difference.',
                  tone: StatusTone.neutral,
                )
              else ...[
                Notice(
                  key: const Key('refund-due'),
                  message:
                      'Refund ${money.format(refundDue)} to the customer. Choose how it is paid back.',
                  tone: StatusTone.warning,
                ),
                const SizedBox(height: Space.md),
                SegmentedButton<PaymentMethod>(
                  segments: [
                    for (final m in PaymentMethod.values)
                      ButtonSegment(value: m, label: Text(m.label)),
                  ],
                  selected: {_refundMethod},
                  showSelectedIcon: false,
                  onSelectionChanged: _busy
                      ? null
                      : (s) => setState(() => _refundMethod = s.first),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
