import 'package:material_ui/material_ui.dart';

import '../../app/theme/tokens.dart';

/// Inline banner: icon + message in a semantic colour. Used for errors, session notices and offline state.
class Notice extends StatelessWidget {
  const Notice({
    super.key,
    required this.message,
    this.tone = StatusTone.danger,
    this.icon,
  });

  final String message;
  final StatusTone tone;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final colors = VeloraTokens.of(context).status(tone);
    final defaultIcon = switch (tone) {
      StatusTone.success => Icons.check_circle_outline,
      StatusTone.warning => Icons.info_outline,
      StatusTone.danger => Icons.error_outline,
      StatusTone.neutral => Icons.info_outline,
    };
    return Semantics(
      liveRegion: true,
      container: true,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(Space.md),
        decoration: BoxDecoration(
          color: colors.background,
          borderRadius: BorderRadius.circular(Radii.control),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon ?? defaultIcon, color: colors.foreground, size: 20),
            const SizedBox(width: Space.sm),
            Expanded(
              child: Text(
                message,
                style: Theme.of(context).textTheme.bodyMedium
                    ?.copyWith(color: colors.foreground),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
