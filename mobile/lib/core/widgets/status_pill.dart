import 'package:material_ui/material_ui.dart';

import '../../app/theme/tokens.dart';

/// Status as colour **and** text — never colour alone (design system §1).
class StatusPill extends StatelessWidget {
  const StatusPill({
    super.key,
    required this.label,
    required this.tone,
    this.icon,
  });

  final String label;
  final StatusTone tone;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final colors = VeloraTokens.of(context).status(tone);
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: Space.md,
        vertical: Space.xs,
      ),
      decoration: BoxDecoration(
        color: colors.background,
        borderRadius: BorderRadius.circular(100),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, size: 16, color: colors.foreground),
            const SizedBox(width: Space.xs),
          ],
          Text(
            label,
            style: Theme.of(context).textTheme.labelMedium
                ?.copyWith(color: colors.foreground),
          ),
        ],
      ),
    );
  }
}
