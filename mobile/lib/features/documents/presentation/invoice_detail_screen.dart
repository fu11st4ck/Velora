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
import '../../../core/money/money_format.dart';
import '../../../core/money/money_providers.dart';
import '../../../core/widgets/labeled_field.dart';
import '../../../core/widgets/notice.dart';
import '../../../core/widgets/primary_button.dart';
import '../../../core/widgets/sections.dart';
import '../../../core/widgets/state_views.dart';
import '../../../core/widgets/status_pill.dart';
import '../../products/presentation/inventory_controllers.dart'
    show inventoryListProvider;
import '../../sell/presentation/sell_screen.dart' show sellableProductsProvider;
import '../data/document.dart';
import '../data/documents_api.dart';
import 'document_controllers.dart';
import 'document_widgets.dart';
import 'documents_screen.dart' show formatDateOnly;

enum _Action { whatsapp, returnItems, cancel }

final _dateTime = DateFormat('d MMM yyyy, HH:mm');

/// F2 Invoice detail.
class InvoiceDetailScreen extends ConsumerWidget {
  const InvoiceDetailScreen({super.key, required this.invoiceId});
  final String invoiceId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final invoice = ref.watch(invoiceProvider(invoiceId));
    final me = ref.watch(currentUserProvider);
    final i = invoice.value;
    final canReturn =
        (me?.can('invoice.return') ?? false) &&
        (i?.hasReturnableItems ?? false);
    final canCancel =
        (me?.can('invoice.cancel') ?? false) &&
        i != null &&
        !i.cancelled &&
        i.returns.isEmpty;
    final mobile = i?.customer.mobile;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Invoice'),
        actions: [
          if (i != null && (mobile != null || canReturn || canCancel))
            PopupMenuButton<_Action>(
              key: const Key('invoice-menu'),
              tooltip: 'More actions',
              onSelected: (action) => switch (action) {
                _Action.whatsapp => messageOnWhatsApp(
                  context,
                  ref,
                  isInvoice: true,
                  number: i.number,
                  customerName: i.customer.name ?? i.customer.displayName,
                  mobile: mobile!,
                  totalMinor: i.totalMinor,
                ),
                _Action.returnItems => context.push(
                  Routes.returnItems(invoiceId),
                ),
                _Action.cancel => _cancel(context, ref, i),
              },
              itemBuilder: (_) => [
                if (mobile != null)
                  const PopupMenuItem(
                    value: _Action.whatsapp,
                    child: Text('Message on WhatsApp'),
                  ),
                if (canReturn)
                  const PopupMenuItem(
                    value: _Action.returnItems,
                    child: Text('Return items'),
                  ),
                if (canCancel)
                  const PopupMenuItem(
                    value: _Action.cancel,
                    child: Text('Cancel invoice'),
                  ),
              ],
            ),
        ],
      ),
      bottomNavigationBar: i == null
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
                        isInvoice: true,
                        id: i.id,
                        number: i.number,
                        customerName: i.customer.name ?? i.customer.displayName,
                        totalMinor: i.totalMinor,
                      ),
                      icon: const Icon(Icons.ios_share),
                      label: const Text('Share PDF'),
                    ),
                  ),
                  if (i.canTakePayment) ...[
                    const SizedBox(width: Space.md),
                    Expanded(
                      child: FilledButton(
                        key: const Key('record-payment'),
                        onPressed: () => _recordPayment(context, ref, i),
                        child: const Text('Record payment'),
                      ),
                    ),
                  ],
                ],
              ),
            ),
      body: RefreshIndicator(
        onRefresh: () async {
          final _ = await ref.refresh(invoiceProvider(invoiceId).future);
        },
        child: AsyncValueView<Invoice>(
          value: invoice,
          onRetry: () => ref.invalidate(invoiceProvider(invoiceId)),
          data: (i) => _Body(invoice: i),
        ),
      ),
    );
  }

  Future<void> _recordPayment(
    BuildContext context,
    WidgetRef ref,
    Invoice invoice,
  ) async {
    final updated = await showModalBottomSheet<Invoice>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      showDragHandle: true,
      builder: (_) => _RecordPaymentSheet(invoice: invoice),
    );
    if (updated == null || !context.mounted) return;
    refreshDocuments(ref, invoiceId: invoice.id);
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(
            updated.balanceMinor == 0
                ? 'Payment recorded. Invoice is paid.'
                : 'Payment recorded.',
          ),
        ),
      );
  }

  Future<void> _cancel(
    BuildContext context,
    WidgetRef ref,
    Invoice invoice,
  ) async {
    final cancelled = await showDialog<bool>(
      context: context,
      builder: (_) => _CancelDialog(invoice: invoice),
    );
    if (cancelled != true || !context.mounted) return;
    refreshDocuments(ref, invoiceId: invoice.id);
    ref.invalidate(sellableProductsProvider);
    ref.invalidate(inventoryListProvider);
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        const SnackBar(content: Text('Invoice cancelled. Stock was restored.')),
      );
  }
}

class _Body extends ConsumerWidget {
  const _Body({required this.invoice});
  final Invoice invoice;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final tokens = VeloraTokens.of(context);
    final money = ref.watch(moneyFormatterProvider);
    final muted = theme.textTheme.bodyMedium?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    final i = invoice;
    final status = i.status;
    final profit = i.profit;

    return SingleChildScrollView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.all(Space.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(i.number, style: tokens.overline, textAlign: TextAlign.center),
          const SizedBox(height: Space.xs),
          Text(
            money.format(i.totalMinor),
            key: const Key('invoice-total'),
            style: tokens.displayMoney,
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: Space.sm),
          Center(
            child: StatusPill(
              key: const Key('invoice-status'),
              label: status.label,
              tone: status.tone,
            ),
          ),
          if (i.canTakePayment) ...[
            const SizedBox(height: Space.sm),
            Text(
              'Balance ${money.format(i.balanceMinor)}${i.dueDate == null ? '' : ' · due ${formatDateOnly(i.dueDate!)}'}',
              key: const Key('invoice-balance'),
              style: theme.textTheme.bodyLarge?.copyWith(
                color: i.isOverdue ? theme.colorScheme.error : null,
              ),
              textAlign: TextAlign.center,
            ),
          ],
          if (i.cancelled && i.cancelReason != null) ...[
            const SizedBox(height: Space.lg),
            Notice(
              message: 'Cancelled: ${i.cancelReason}',
              tone: StatusTone.danger,
            ),
          ],
          const SizedBox(height: Space.lg),
          PartyCard(title: 'Bill to', party: i.customer),
          const SizedBox(height: Space.lg),
          LinesCard(lines: i.lines, money: money),
          const SizedBox(height: Space.lg),
          SectionCard(
            title: 'Totals',
            children: [
              FactRow(label: 'Subtotal', value: money.format(i.subtotalMinor)),
              if (i.discountMinor > 0)
                FactRow(
                  label: 'Discount',
                  value: '− ${money.format(i.discountMinor)}',
                ),
              FactRow(
                label: i.tax.name,
                value: money.format(i.tax.amountMinor),
              ),
              FactRow(
                label: 'Total',
                value: money.format(i.totalMinor),
                emphasize: true,
              ),
              if (i.returnedMinor > 0)
                FactRow(
                  label: 'Returned',
                  value: '− ${money.format(i.returnedMinor)}',
                ),
              FactRow(label: 'Paid', value: money.format(i.paidMinor)),
              if (!i.cancelled)
                FactRow(
                  label: 'Balance',
                  value: money.format(i.balanceMinor),
                  emphasize: true,
                ),
            ],
          ),
          if (profit != null) ...[
            const SizedBox(height: Space.lg),
            SectionCard(
              title: 'Profit',
              trailing: const StatusPill(
                label: 'Managers only',
                tone: StatusTone.neutral,
                icon: Icons.lock_outline,
              ),
              children: [
                FactRow(
                  label: 'Cost of items',
                  value: money.format(profit.costMinor),
                ),
                FactRow(
                  label: 'Gross profit',
                  value: profit.marginBp == null
                      ? money.format(profit.grossProfitMinor)
                      : '${money.format(profit.grossProfitMinor)} · ${formatBasisPoints(profit.marginBp!)}',
                  emphasize: true,
                ),
              ],
            ),
          ],
          const SizedBox(height: Space.lg),
          SectionCard(
            title: 'Payments',
            children: [
              if (i.payments.isEmpty)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: Space.sm),
                  child: Text('No payments recorded.', style: muted),
                ),
              for (final (n, p) in i.payments.indexed) ...[
                if (n > 0) const Divider(),
                MergeSemantics(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: Space.sm),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                '${p.isRefund ? 'Refund' : 'Payment'} · ${p.method.label}',
                                style: theme.textTheme.titleSmall,
                              ),
                              if (p.reference != null)
                                Text('Ref ${p.reference}', style: muted),
                              if (p.note != null) Text(p.note!, style: muted),
                              Text(
                                '${p.recordedByName} · ${_dateTime.format(p.receivedAt.toLocal())}',
                                style: theme.textTheme.bodySmall?.copyWith(
                                  color: theme.colorScheme.onSurfaceVariant,
                                ),
                              ),
                            ],
                          ),
                        ),
                        Text(
                          '${p.isRefund ? '− ' : ''}${money.format(p.amountMinor)}',
                          style: tokens.moneyRow,
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ],
          ),
          if (i.returns.isNotEmpty) ...[
            const SizedBox(height: Space.lg),
            SectionCard(
              title: 'Returns',
              children: [
                for (final r in i.returns)
                  FactRow(
                    label:
                        '${r.number} · ${r.units} ${r.units == 1 ? 'item' : 'items'} · ${r.reason}',
                    value: '− ${money.format(r.totalMinor)}',
                  ),
              ],
            ),
          ],
          const SizedBox(height: Space.lg),
          SectionCard(
            title: 'Details',
            children: [
              FactRow(
                label: 'Issued',
                value: _dateTime.format(i.issuedAt.toLocal()),
              ),
              FactRow(label: 'Salesperson', value: i.salespersonName),
              if (i.quotationNumber != null)
                FactRow(label: 'From quotation', value: i.quotationNumber!),
              if (i.notes != null) FactRow(label: 'Notes', value: i.notes!),
            ],
          ),
        ],
      ),
    );
  }
}

/// F3 Record payment. Pops with the updated invoice.
class _RecordPaymentSheet extends ConsumerStatefulWidget {
  const _RecordPaymentSheet({required this.invoice});
  final Invoice invoice;

  @override
  ConsumerState<_RecordPaymentSheet> createState() =>
      _RecordPaymentSheetState();
}

class _RecordPaymentSheetState extends ConsumerState<_RecordPaymentSheet> {
  final _form = GlobalKey<FormState>();
  late final MoneyFormatter _money = ref.read(moneyFormatterProvider);
  late final _amount = TextEditingController(
    text: _money
        .format(widget.invoice.balanceMinor, withCode: false)
        .replaceAll(',', ''),
  );
  final _reference = TextEditingController();
  PaymentMethod _method = PaymentMethod.cash;
  String _idempotencyKey = newIdempotencyKey();
  bool _busy = false;
  Failure? _failure;

  @override
  void dispose() {
    _amount.dispose();
    _reference.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_busy) return;
    setState(() => _failure = null);
    if (!_form.currentState!.validate()) return;
    setState(() => _busy = true);
    try {
      final updated = await ref
          .read(documentsApiProvider)
          .recordPayment(
            widget.invoice.id,
            amountMinor: _money.parse(_amount.text)!,
            method: _method,
            reference:
                _method == PaymentMethod.bankTransfer &&
                    _reference.text.trim().isNotEmpty
                ? _reference.text.trim()
                : null,
            idempotencyKey: _idempotencyKey,
          );
      if (mounted) Navigator.of(context).pop(updated);
    } on Failure catch (failure) {
      if (!mounted) return;
      setState(() {
        if (failure is BusinessFailure || failure is ValidationFailure) {
          _idempotencyKey = newIdempotencyKey();
        }
        _failure = failure;
      });
      // Someone else may have recorded a payment meanwhile; the detail behind reloads.
      ref.invalidate(invoiceProvider(widget.invoice.id));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final balance = widget.invoice.balanceMinor;
    final entered = _money.parse(_amount.text);
    final remaining = entered != null && entered > 0 && entered <= balance
        ? balance - entered
        : null;

    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(Space.lg, 0, Space.lg, Space.lg),
        child: Form(
          key: _form,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Semantics(
                header: true,
                child: Text(
                  'Record payment',
                  style: theme.textTheme.titleLarge,
                ),
              ),
              Text(
                '${widget.invoice.number} · balance ${_money.format(balance)}',
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
                key: const Key('pay-amount'),
                label: 'Amount received (${_money.currencyCode})',
                controller: _amount,
                keyboardType: const TextInputType.numberWithOptions(
                  decimal: true,
                ),
                inputFormatters: [
                  FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]')),
                ],
                enabled: !_busy,
                onChanged: (_) => setState(() {}),
                validator: (v) {
                  final parsed = _money.parse(v ?? '');
                  if (parsed == null || parsed == 0) {
                    return 'Enter the amount received.';
                  }
                  if (parsed > balance) {
                    return 'Cannot be more than the balance of ${_money.format(balance)}.';
                  }
                  return null;
                },
              ),
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
                  key: const Key('pay-reference'),
                  label: 'Bank reference (optional)',
                  controller: _reference,
                  enabled: !_busy,
                  validator: (v) => (v ?? '').trim().length > 80
                      ? 'Use at most 80 characters.'
                      : null,
                ),
              ],
              const SizedBox(height: Space.lg),
              if (remaining != null)
                Text(
                  remaining == 0
                      ? 'The invoice will be marked Paid.'
                      : '${_money.format(remaining)} will remain due.',
                  key: const Key('pay-outcome'),
                  style: theme.textTheme.bodyMedium,
                ),
              const SizedBox(height: Space.md),
              PrimaryButton(
                key: const Key('pay-submit'),
                label: 'Record payment',
                busy: _busy,
                onPressed: _submit,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// F4 Cancel invoice: reason, refund method when money was received, and the consequences in numbers.
class _CancelDialog extends ConsumerStatefulWidget {
  const _CancelDialog({required this.invoice});
  final Invoice invoice;

  @override
  ConsumerState<_CancelDialog> createState() => _CancelDialogState();
}

class _CancelDialogState extends ConsumerState<_CancelDialog> {
  final _form = GlobalKey<FormState>();
  final _reason = TextEditingController();
  final _idempotencyKey = newIdempotencyKey();
  PaymentMethod _refundMethod = PaymentMethod.cash;
  bool _busy = false;
  Failure? _failure;

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_busy || !_form.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _failure = null;
    });
    try {
      await ref
          .read(documentsApiProvider)
          .cancelInvoice(
            widget.invoice.id,
            reason: _reason.text.trim(),
            refundMethod: widget.invoice.paidMinor > 0 ? _refundMethod : null,
            idempotencyKey: _idempotencyKey,
          );
      if (mounted) Navigator.of(context).pop(true);
    } on Failure catch (failure) {
      if (mounted) setState(() => _failure = failure);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final money = ref.watch(moneyFormatterProvider);
    final i = widget.invoice;
    final units = i.lines.fold(0, (sum, l) => sum + l.quantity);
    return AlertDialog(
      title: Text('Cancel ${i.number}?'),
      scrollable: true,
      content: Form(
        key: _form,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              [
                'Stock is restored for $units ${units == 1 ? 'item' : 'items'}.',
                if (i.paidMinor > 0)
                  '${money.format(i.paidMinor)} received is recorded as refunded.',
                'The invoice keeps its number and stays in the list as cancelled.',
              ].join('\n'),
            ),
            const SizedBox(height: Space.lg),
            if (_failure != null) ...[
              Notice(message: describeFailure(_failure!)),
              const SizedBox(height: Space.lg),
            ],
            LabeledField(
              key: const Key('cancel-reason'),
              label: 'Reason',
              controller: _reason,
              enabled: !_busy,
              validator: (v) => (v ?? '').trim().length < 3
                  ? 'Say why the invoice is cancelled.'
                  : null,
            ),
            if (i.paidMinor > 0) ...[
              const SizedBox(height: Space.lg),
              Text('Refund by', style: Theme.of(context).textTheme.labelMedium),
              const SizedBox(height: Space.sm),
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
      actions: [
        TextButton(
          onPressed: _busy ? null : () => Navigator.of(context).pop(false),
          child: const Text('Keep invoice'),
        ),
        TextButton(
          key: const Key('confirm-cancel-invoice'),
          onPressed: _busy ? null : _submit,
          child: const Text('Cancel invoice'),
        ),
      ],
    );
  }
}
