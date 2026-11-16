import 'package:intl/intl.dart';
import 'package:material_ui/material_ui.dart';

import '../../../app/theme/tokens.dart';
import '../../../core/widgets/status_pill.dart';
import '../data/product.dart';

StatusTone stockTone(StockStatus status) => switch (status) {
  StockStatus.inStock => StatusTone.success,
  StockStatus.low => StatusTone.warning,
  StockStatus.out => StatusTone.danger,
};

class StockPill extends StatelessWidget {
  const StockPill(this.status, {super.key});
  final StockStatus status;

  @override
  Widget build(BuildContext context) =>
      StatusPill(label: status.label, tone: stockTone(status));
}

/// Square product image; the brand monogram stands in when there is no photo.
class ProductThumb extends StatelessWidget {
  const ProductThumb({super.key, this.size = 56});
  final double size;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return ExcludeSemantics(
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          color: scheme.secondaryContainer,
          borderRadius: BorderRadius.circular(Radii.chip),
        ),
        alignment: Alignment.center,
        child: Text(
          'V',
          style: TextStyle(
            fontFamily: 'PlayfairDisplay',
            fontSize: size * 0.45,
            height: 1,
            color: scheme.onSecondaryContainer,
          ),
        ),
      ),
    );
  }
}

/// Label on the left, value on the right; read as one item by screen readers.
class FactRow extends StatelessWidget {
  const FactRow({
    super.key,
    required this.label,
    required this.value,
    this.emphasize = false,
  });
  final String label;
  final String value;
  final bool emphasize;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final tokens = VeloraTokens.of(context);
    return MergeSemantics(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: Space.sm),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Text(
                label,
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ),
            const SizedBox(width: Space.lg),
            Expanded(
              child: Text(
                value,
                style: emphasize ? tokens.moneyRow : theme.textTheme.titleSmall,
                textAlign: TextAlign.end,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// A titled card section.
class SectionCard extends StatelessWidget {
  const SectionCard({
    super.key,
    required this.title,
    required this.children,
    this.trailing,
  });
  final String title;
  final List<Widget> children;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) => Card(
    child: Padding(
      padding: const EdgeInsets.all(Space.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Semantics(
                  header: true,
                  child: Text(
                    title,
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                ),
              ),
              ?trailing,
            ],
          ),
          const SizedBox(height: Space.sm),
          ...children,
        ],
      ),
    ),
  );
}

final _dateTime = DateFormat('d MMM yyyy, HH:mm');

/// One ledger entry: what happened, the signed quantity, the resulting balance, who and when.
class MovementTile extends StatelessWidget {
  const MovementTile({super.key, required this.movement, this.costText});
  final StockMovement movement;

  /// Formatted unit cost, when the viewer may see it.
  final String? costText;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final tokens = VeloraTokens.of(context);
    final added = movement.quantityDelta > 0;
    final colors = tokens.status(
      added ? StatusTone.success : StatusTone.neutral,
    );
    final details = [
      ?movement.documentNumber,
      ?movement.reason,
      if (movement.supplierName != null) 'From ${movement.supplierName}',
      ?movement.referenceNote,
      if (costText != null) 'Unit cost $costText',
    ].join(' · ');
    final signed = '${added ? '+' : '−'}${movement.quantityDelta.abs()}';

    return MergeSemantics(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: Space.md),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 36,
              height: 36,
              decoration: BoxDecoration(
                color: colors.background,
                shape: BoxShape.circle,
              ),
              child: Icon(
                added ? Icons.add : Icons.remove,
                size: 18,
                color: colors.foreground,
              ),
            ),
            const SizedBox(width: Space.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(movement.type.label, style: theme.textTheme.titleSmall),
                  if (details.isNotEmpty)
                    Text(
                      details,
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  Text(
                    '${movement.createdByName} · ${_dateTime.format(movement.createdAt.toLocal())}',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: Space.md),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(
                  signed,
                  style: tokens.moneyRow,
                  semanticsLabel:
                      '${added ? 'plus' : 'minus'} ${movement.quantityDelta.abs()}',
                ),
                Text(
                  'Balance ${movement.balanceAfter}',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
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

/// Bottom action area that stays above the keyboard and the system inset.
class PinnedBar extends StatelessWidget {
  const PinnedBar({super.key, required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: scheme.surfaceContainer,
        border: Border(top: BorderSide(color: scheme.outlineVariant)),
      ),
      child: SafeArea(
        top: false,
        child: Padding(padding: const EdgeInsets.all(Space.lg), child: child),
      ),
    );
  }
}
