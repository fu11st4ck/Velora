import 'package:material_ui/material_ui.dart';

/// Raw brand palette (docs/design-system.md §1). Feature code never uses these directly —
/// it reads [ColorScheme] and [VeloraTokens] from the theme.
abstract final class Palette {
  static const wine900 = Color(0xFF251417);
  static const wine800 = Color(0xFF3D151E);
  static const wine700 = Color(0xFF45151F);
  static const wine600 = Color(0xFF602433);
  static const wine100 = Color(0xFFF1E3E6);
  static const gold500 = Color(0xFFB28A50);
  static const gold700 = Color(0xFF7A5A28);
  static const gold300 = Color(0xFFD4B27B);
  static const gold100 = Color(0xFFF6EBD8);
  static const paper = Color(0xFFFBFAF8);
  static const cream = Color(0xFFF3EFE9);
  static const line = Color(0xFFE7E0DB);
  static const ink = Color(0xFF211B1C);
  static const muted = Color(0xFF655D5E);
}

/// Foreground/background pair for a semantic status.
@immutable
class StatusColors {
  const StatusColors(this.foreground, this.background);
  final Color foreground;
  final Color background;
}

enum StatusTone { success, warning, danger, neutral }

/// Spacing scale in logical pixels.
abstract final class Space {
  static const double xxs = 2;
  static const double xs = 4;
  static const double sm = 8;
  static const double md = 12;
  static const double lg = 16;
  static const double xl = 20;
  static const double xxl = 24;
  static const double xxxl = 32;
  static const double huge = 48;

  /// Minimum interactive target (design system §3).
  static const double touchTarget = 48;
}

abstract final class Radii {
  static const double chip = 8;
  static const double control = 12;
  static const double card = 16;
  static const double sheet = 24;
}

/// Values Material has no slot for. Read with `VeloraTokens.of(context)`.
@immutable
class VeloraTokens extends ThemeExtension<VeloraTokens> {
  const VeloraTokens({
    required this.success,
    required this.warning,
    required this.danger,
    required this.neutral,
    required this.accentText,
    required this.displayMoney,
    required this.moneyRow,
    required this.overline,
  });

  final StatusColors success;
  final StatusColors warning;
  final StatusColors danger;
  final StatusColors neutral;

  /// Gold that is legible as text on the page surface.
  final Color accentText;
  final TextStyle displayMoney;
  final TextStyle moneyRow;
  final TextStyle overline;

  StatusColors status(StatusTone tone) => switch (tone) {
    StatusTone.success => success,
    StatusTone.warning => warning,
    StatusTone.danger => danger,
    StatusTone.neutral => neutral,
  };

  static VeloraTokens of(BuildContext context) =>
      Theme.of(context).extension<VeloraTokens>()!;

  @override
  VeloraTokens copyWith() => this;

  @override
  VeloraTokens lerp(ThemeExtension<VeloraTokens>? other, double t) =>
      t < 0.5 || other is! VeloraTokens ? this : other;
}
