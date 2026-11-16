import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../../../app/theme/tokens.dart';
import '../../../core/api/failure.dart';
import '../../../core/api/failure_messages.dart';
import '../../../core/money/money_format.dart';
import '../../../core/money/money_providers.dart';
import '../../../core/platform/link_opener.dart';
import '../../../core/widgets/sections.dart';
import '../data/document.dart';
import '../data/documents_api.dart';
import 'document_controllers.dart';

/// Customer block shared by invoice and quotation detail.
class PartyCard extends StatelessWidget {
  const PartyCard({super.key, required this.title, required this.party});
  final String title;
  final DocumentParty party;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodyMedium?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    return SectionCard(
      title: title,
      children: [
        Text(party.displayName, style: theme.textTheme.titleMedium),
        for (final line in [
          party.secondaryName,
          party.mobile,
          party.email,
          party.address,
          if (party.taxRegistrationNumber != null)
            'TRN ${party.taxRegistrationNumber}',
        ])
          if (line != null) Text(line, style: muted),
      ],
    );
  }
}

/// The items of a document. Cost and markup appear only when the server sent them (managers).
class LinesCard extends StatelessWidget {
  const LinesCard({super.key, required this.lines, required this.money});
  final List<DocumentLine> lines;
  final MoneyFormatter money;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodyMedium?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    return SectionCard(
      title: 'Items',
      children: [
        for (final (i, l) in lines.indexed) ...[
          if (i > 0) const Divider(),
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
                        Text(l.name, style: theme.textTheme.titleSmall),
                        Text(
                          '${l.sku} · ${l.quantity} × ${money.format(l.unitPriceMinor)}',
                          style: muted,
                        ),
                        if (l.returnedQuantity > 0)
                          Text('${l.returnedQuantity} returned', style: muted),
                        if (l.unitCostMinor != null && l.markupBp != null)
                          Text(
                            'Cost ${money.format(l.unitCostMinor!)} · markup ${formatBasisPoints(l.markupBp!)}',
                            style: theme.textTheme.bodySmall?.copyWith(
                              color: theme.colorScheme.onSurfaceVariant,
                            ),
                          ),
                      ],
                    ),
                  ),
                  const SizedBox(width: Space.md),
                  Text(
                    money.format(l.lineTotalMinor),
                    style: VeloraTokens.of(context).moneyRow,
                  ),
                ],
              ),
            ),
          ),
        ],
      ],
    );
  }
}

/// Fetches the PDF and hands it to the system share sheet.
Future<void> shareDocument(
  BuildContext context,
  WidgetRef ref, {
  required bool isInvoice,
  required String id,
  required String number,
  required String customerName,
  required int totalMinor,
}) async {
  final messenger = ScaffoldMessenger.of(context);
  final money = ref.read(moneyFormatterProvider);
  try {
    final pdf = await ref
        .read(documentsApiProvider)
        .pdf(isInvoice: isInvoice, id: id);
    final shared = await ref.read(documentSharerProvider)(
      pdf: pdf,
      filename: '$number.pdf',
      text: _message(
        isInvoice: isInvoice,
        number: number,
        customerName: customerName,
        total: money.format(totalMinor),
      ),
    );
    if (!shared) {
      messenger.showSnackBar(
        const SnackBar(
          content: Text('Sharing is not available on this device.'),
        ),
      );
    }
  } on Failure catch (failure) {
    messenger.showSnackBar(SnackBar(content: Text(describeFailure(failure))));
  }
}

/// Opens WhatsApp to the customer's number with a short message. WhatsApp links cannot carry an
/// attachment, so the PDF itself goes through [shareDocument].
Future<void> messageOnWhatsApp(
  BuildContext context,
  WidgetRef ref, {
  required bool isInvoice,
  required String number,
  required String customerName,
  required String mobile,
  required int totalMinor,
}) async {
  final messenger = ScaffoldMessenger.of(context);
  final text = _message(
    isInvoice: isInvoice,
    number: number,
    customerName: customerName,
    total: ref.read(moneyFormatterProvider).format(totalMinor),
  );
  final uri = Uri.https('wa.me', '/${mobile.replaceAll('+', '')}', {
    'text': text,
  });
  if (!await ref.read(linkOpenerProvider)(uri)) {
    messenger.showSnackBar(
      const SnackBar(content: Text('Could not open WhatsApp on this device.')),
    );
  }
}

String _message({
  required bool isInvoice,
  required String number,
  required String customerName,
  required String total,
}) =>
    'Hello $customerName, your ${isInvoice ? 'invoice' : 'quotation'} $number is ready. Total: $total. Thank you.';
