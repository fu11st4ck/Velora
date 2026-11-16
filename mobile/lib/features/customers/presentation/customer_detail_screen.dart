import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:material_ui/material_ui.dart';

import '../../../app/router/routes.dart';
import '../../../app/theme/tokens.dart';
import '../../../core/api/failure.dart';
import '../../../core/api/failure_messages.dart';
import '../../../core/auth/session_controller.dart';
import '../../../core/money/money_providers.dart';
import '../../../core/platform/link_opener.dart';
import '../../../core/widgets/sections.dart';
import '../../../core/widgets/state_views.dart';
import '../../../core/widgets/status_pill.dart';
import '../data/customer.dart';
import '../data/customers_api.dart';
import 'customer_controllers.dart';
import 'customer_list_view.dart';

enum _Action { edit, archive }

/// E2 Customer detail. The list of this customer's documents is added with the documents
/// feature in sprint 4; until then the summary card carries the totals.
class CustomerDetailScreen extends ConsumerWidget {
  const CustomerDetailScreen({super.key, required this.customerId});
  final String customerId;

  Future<void> _archive(
    BuildContext context,
    WidgetRef ref,
    Customer customer,
  ) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Archive this customer?'),
        content: Text(
          '${customer.displayName} will be hidden from the customer list. Their past documents are kept unchanged.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          TextButton(
            key: const Key('confirm-archive'),
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Archive'),
          ),
        ],
      ),
    );
    if (confirmed != true || !context.mounted) return;
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref.read(customersApiProvider).archive(customer.id);
      refreshCustomerData(ref);
      messenger.showSnackBar(
        SnackBar(content: Text('${customer.displayName} archived')),
      );
      if (context.mounted) context.pop();
    } on Failure catch (failure) {
      messenger.showSnackBar(SnackBar(content: Text(describeFailure(failure))));
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final customer = ref.watch(customerProvider(customerId));
    final me = ref.watch(currentUserProvider);
    final loaded = customer.value;
    final editable = loaded != null && !loaded.isArchived;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Customer'),
        actions: [
          if (editable)
            PopupMenuButton<_Action>(
              key: const Key('customer-menu'),
              tooltip: 'More actions',
              onSelected: (action) => switch (action) {
                _Action.edit => context.push(Routes.editCustomer(customerId)),
                _Action.archive => _archive(context, ref, loaded),
              },
              itemBuilder: (_) => [
                const PopupMenuItem(
                  value: _Action.edit,
                  child: Text('Edit customer'),
                ),
                if (me?.can('customer.archive') ?? false)
                  const PopupMenuItem(
                    value: _Action.archive,
                    child: Text('Archive customer'),
                  ),
              ],
            ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          final _ = await ref.refresh(customerProvider(customerId).future);
        },
        child: AsyncValueView<Customer>(
          value: customer,
          onRetry: () => ref.invalidate(customerProvider(customerId)),
          data: (c) => _Body(
            customer: c,
            ownOnly: !(me?.can('document.read_all') ?? false),
          ),
        ),
      ),
    );
  }
}

class _Body extends ConsumerWidget {
  const _Body({required this.customer, required this.ownOnly});
  final Customer customer;

  /// True when the totals cover only the viewer's own invoices.
  final bool ownOnly;

  Future<void> _open(
    BuildContext context,
    WidgetRef ref,
    Uri uri,
    String what,
  ) async {
    final messenger = ScaffoldMessenger.of(context);
    if (!await ref.read(linkOpenerProvider)(uri)) {
      messenger.showSnackBar(
        SnackBar(content: Text('Could not open $what on this device.')),
      );
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final money = ref.watch(moneyFormatterProvider);
    final muted = theme.textTheme.bodyMedium?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    final summary = customer.summary;
    final mobile = customer.mobile;
    final email = customer.email;

    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.all(Space.lg),
      children: [
        Row(
          children: [
            CustomerAvatar(customer: customer, radius: 32),
            const SizedBox(width: Space.lg),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Semantics(
                    header: true,
                    child: Text(
                      customer.displayName,
                      style: theme.textTheme.headlineMedium,
                    ),
                  ),
                  if (customer.secondaryName != null)
                    Text(customer.secondaryName!, style: muted),
                  if (customer.isArchived) ...[
                    const SizedBox(height: Space.xs),
                    const StatusPill(
                      label: 'Archived',
                      tone: StatusTone.neutral,
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
        if (mobile != null || email != null) ...[
          const SizedBox(height: Space.lg),
          Wrap(
            spacing: Space.sm,
            runSpacing: Space.sm,
            children: [
              if (mobile != null) ...[
                OutlinedButton.icon(
                  key: const Key('call-customer'),
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size(0, Space.touchTarget),
                  ),
                  onPressed: () => _open(
                    context,
                    ref,
                    Uri(scheme: 'tel', path: mobile),
                    'the phone',
                  ),
                  icon: const Icon(Icons.call_outlined),
                  label: const Text('Call'),
                ),
                OutlinedButton.icon(
                  key: const Key('whatsapp-customer'),
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size(0, Space.touchTarget),
                  ),
                  // wa.me takes the number in international format without the plus sign.
                  onPressed: () => _open(
                    context,
                    ref,
                    Uri.parse('https://wa.me/${mobile.replaceAll('+', '')}'),
                    'WhatsApp',
                  ),
                  icon: const Icon(Icons.chat_outlined),
                  label: const Text('WhatsApp'),
                ),
              ],
              if (email != null)
                OutlinedButton.icon(
                  key: const Key('email-customer'),
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size(0, Space.touchTarget),
                  ),
                  onPressed: () => _open(
                    context,
                    ref,
                    Uri(scheme: 'mailto', path: email),
                    'email',
                  ),
                  icon: const Icon(Icons.mail_outline),
                  label: const Text('Email'),
                ),
            ],
          ),
        ],
        const SizedBox(height: Space.lg),
        if (summary != null) ...[
          SectionCard(
            title: ownOnly ? 'Your sales to this customer' : 'Account',
            children: [
              FactRow(
                label: 'Outstanding',
                value: money.format(summary.outstandingMinor),
                emphasize: true,
              ),
              if (summary.overdueMinor > 0)
                Padding(
                  padding: const EdgeInsets.only(bottom: Space.sm),
                  child: Align(
                    alignment: Alignment.centerRight,
                    child: StatusPill(
                      label: '${money.format(summary.overdueMinor)} overdue',
                      tone: StatusTone.danger,
                      icon: Icons.schedule,
                    ),
                  ),
                ),
              FactRow(
                label: 'Invoiced in total',
                value: money.format(summary.invoicedMinor),
              ),
              FactRow(
                label: 'Invoices',
                value: summary.lastInvoiceAt == null
                    ? '${summary.invoiceCount}'
                    : '${summary.invoiceCount} · last ${DateFormat('d MMM yyyy').format(summary.lastInvoiceAt!.toLocal())}',
              ),
            ],
          ),
          const SizedBox(height: Space.lg),
        ],
        SectionCard(
          title: 'Details',
          children: [
            if (customer.name != null)
              FactRow(label: 'Name', value: customer.name!),
            if (customer.company != null)
              FactRow(label: 'Company', value: customer.company!),
            FactRow(label: 'Mobile', value: mobile ?? '—'),
            FactRow(label: 'Email', value: email ?? '—'),
            FactRow(label: 'Address', value: customer.address ?? '—'),
            FactRow(
              label: 'Tax registration no.',
              value: customer.taxRegistrationNumber ?? '—',
            ),
            if (customer.notes != null)
              FactRow(label: 'Notes', value: customer.notes!),
          ],
        ),
      ],
    );
  }
}
