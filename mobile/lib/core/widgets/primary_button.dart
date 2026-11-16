import 'package:material_ui/material_ui.dart';

/// The single primary action of a screen. Shows progress and ignores taps while [busy],
/// so an action cannot be submitted twice.
class PrimaryButton extends StatelessWidget {
  const PrimaryButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.busy = false,
  });

  final String label;
  final VoidCallback? onPressed;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Semantics(
      button: true,
      enabled: onPressed != null && !busy,
      label: busy ? '$label, in progress' : label,
      excludeSemantics: true,
      child: FilledButton(
        onPressed: busy ? null : onPressed,
        child: busy
            ? SizedBox.square(
                dimension: 20,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color: scheme.onSurface,
                ),
              )
            : Text(label),
      ),
    );
  }
}
