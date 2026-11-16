import 'package:material_ui/material_ui.dart';

import 'tokens.dart';

const _serif = 'PlayfairDisplay';
const _sans = 'Inter';
const _tabular = [FontFeature.tabularFigures()];

/// Colour roles for both themes (docs/design-system.md §1). Exposed for the contrast test.
abstract final class VeloraColors {
  static const light = ColorScheme(
    brightness: Brightness.light,
    primary: Palette.wine700,
    onPrimary: Color(0xFFFFFFFF),
    primaryContainer: Palette.wine100,
    onPrimaryContainer: Palette.wine800,
    secondary: Palette.gold700,
    onSecondary: Color(0xFFFFFFFF),
    secondaryContainer: Palette.gold100,
    onSecondaryContainer: Color(0xFF4A3510),
    surface: Palette.paper,
    onSurface: Palette.ink,
    onSurfaceVariant: Palette.muted,
    surfaceContainerLowest: Color(0xFFFFFFFF),
    surfaceContainerLow: Color(0xFFFFFFFF),
    surfaceContainer: Color(0xFFFFFFFF),
    surfaceContainerHigh: Palette.cream,
    surfaceContainerHighest: Palette.cream,
    outline: Color(0xFF8F8486),
    outlineVariant: Palette.line,
    error: Color(0xFFB3261E),
    onError: Color(0xFFFFFFFF),
    errorContainer: Color(0xFFFBE9E7),
    onErrorContainer: Color(0xFF7A1A14),
  );

  static const dark = ColorScheme(
    brightness: Brightness.dark,
    primary: Color(0xFFE8B4BF),
    onPrimary: Color(0xFF3A0F19),
    primaryContainer: Palette.wine600,
    onPrimaryContainer: Color(0xFFFBE3E8),
    secondary: Palette.gold300,
    onSecondary: Color(0xFF3A2A0C),
    secondaryContainer: Color(0xFF55401C),
    onSecondaryContainer: Palette.gold100,
    surface: Color(0xFF171112),
    onSurface: Color(0xFFEDE6E3),
    onSurfaceVariant: Color(0xFFB8ACAE),
    surfaceContainerLowest: Color(0xFF120D0E),
    surfaceContainerLow: Color(0xFF211819),
    surfaceContainer: Color(0xFF211819),
    surfaceContainerHigh: Color(0xFF2B2022),
    surfaceContainerHighest: Color(0xFF34282A),
    outline: Color(0xFF8C7F81),
    outlineVariant: Color(0xFF3A2E30),
    error: Color(0xFFF2B8B5),
    onError: Color(0xFF601410),
    errorContainer: Color(0xFF4A1512),
    onErrorContainer: Color(0xFFF9DEDC),
  );

  static const lightStatus = (
    success: StatusColors(Color(0xFF1F6846), Color(0xFFE6F2EB)),
    warning: StatusColors(Color(0xFF7F4F12), Color(0xFFF8EEDB)),
    danger: StatusColors(Color(0xFFA3261F), Color(0xFFFBE9E7)),
    neutral: StatusColors(Color(0xFF4E5468), Color(0xFFECEEF3)),
  );

  static const darkStatus = (
    success: StatusColors(Color(0xFF8FD3AE), Color(0xFF173326)),
    warning: StatusColors(Color(0xFFE9C083), Color(0xFF3B2A0E)),
    danger: StatusColors(Color(0xFFF2B8B5), Color(0xFF4A1512)),
    neutral: StatusColors(Color(0xFFC3C8D8), Color(0xFF2A2D38)),
  );
}

abstract final class AppTheme {
  static ThemeData light() =>
      _build(VeloraColors.light, VeloraColors.lightStatus, Palette.gold700);
  static ThemeData dark() =>
      _build(VeloraColors.dark, VeloraColors.darkStatus, Palette.gold300);

  static ThemeData _build(
    ColorScheme scheme,
    ({
      StatusColors success,
      StatusColors warning,
      StatusColors danger,
      StatusColors neutral,
    })
    status,
    Color accentText,
  ) {
    final text = _textTheme(scheme);
    final border = OutlineInputBorder(
      borderRadius: BorderRadius.circular(Radii.control),
      borderSide: BorderSide(color: scheme.outline),
    );
    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: scheme.surface,
      fontFamily: _sans,
      textTheme: text,
      extensions: [
        VeloraTokens(
          success: status.success,
          warning: status.warning,
          danger: status.danger,
          neutral: status.neutral,
          accentText: accentText,
          displayMoney: TextStyle(
            fontFamily: _serif,
            fontSize: 34,
            height: 40 / 34,
            fontWeight: FontWeight.w600,
            color: scheme.onSurface,
            fontFeatures: _tabular,
          ),
          moneyRow: TextStyle(
            fontFamily: _sans,
            fontSize: 16,
            height: 22 / 16,
            fontWeight: FontWeight.w600,
            color: scheme.onSurface,
            fontFeatures: _tabular,
          ),
          overline: TextStyle(
            fontFamily: _sans,
            fontSize: 12,
            height: 16 / 12,
            fontWeight: FontWeight.w600,
            letterSpacing: 0.8,
            color: accentText,
          ),
        ),
      ],
      appBarTheme: AppBarTheme(
        backgroundColor: scheme.surface,
        foregroundColor: scheme.onSurface,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: true,
        titleTextStyle: text.titleLarge,
      ),
      // Surfaces are separated by a hairline, not a shadow (design system §3).
      cardTheme: CardThemeData(
        color: scheme.surfaceContainer,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Radii.card),
          side: BorderSide(color: scheme.outlineVariant),
        ),
      ),
      dividerTheme: DividerThemeData(
        color: scheme.outlineVariant,
        thickness: 1,
        space: 1,
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size.fromHeight(52),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(Radii.control),
          ),
          textStyle: text.labelLarge,
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size.fromHeight(52),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(Radii.control),
          ),
          side: BorderSide(color: scheme.outline),
          textStyle: text.labelLarge,
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          minimumSize: const Size(Space.touchTarget, Space.touchTarget),
          textStyle: text.labelLarge,
        ),
      ),
      inputDecorationTheme: InputDecorationThemeData(
        filled: true,
        fillColor: scheme.surfaceContainer,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: Space.lg,
          vertical: Space.lg,
        ),
        border: border,
        enabledBorder: border,
        focusedBorder: border.copyWith(
          borderSide: BorderSide(color: scheme.primary, width: 2),
        ),
        errorBorder: border.copyWith(
          borderSide: BorderSide(color: scheme.error),
        ),
        focusedErrorBorder: border.copyWith(
          borderSide: BorderSide(color: scheme.error, width: 2),
        ),
        hintStyle: text.bodyLarge?.copyWith(color: scheme.onSurfaceVariant),
        errorMaxLines: 3,
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: scheme.surfaceContainer,
        indicatorColor: scheme.primaryContainer,
        elevation: 0,
        height: 68,
        labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
        labelTextStyle: WidgetStateProperty.resolveWith(
          (states) => text.labelMedium?.copyWith(
            color: states.contains(WidgetState.selected)
                ? scheme.primary
                : scheme.onSurfaceVariant,
          ),
        ),
        iconTheme: WidgetStateProperty.resolveWith(
          (states) => IconThemeData(
            color: states.contains(WidgetState.selected)
                ? scheme.onPrimaryContainer
                : scheme.onSurfaceVariant,
          ),
        ),
      ),
      navigationRailTheme: NavigationRailThemeData(
        backgroundColor: scheme.surfaceContainer,
        indicatorColor: scheme.primaryContainer,
        selectedLabelTextStyle: text.labelMedium?.copyWith(
          color: scheme.primary,
        ),
        unselectedLabelTextStyle: text.labelMedium?.copyWith(
          color: scheme.onSurfaceVariant,
        ),
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Radii.control),
        ),
      ),
      dialogTheme: DialogThemeData(
        backgroundColor: scheme.surfaceContainer,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Radii.sheet),
        ),
      ),
      listTileTheme: ListTileThemeData(
        minVerticalPadding: Space.md,
        iconColor: scheme.onSurfaceVariant,
        titleTextStyle: text.titleMedium,
        subtitleTextStyle: text.bodyMedium?.copyWith(
          color: scheme.onSurfaceVariant,
        ),
      ),
    );
  }

  static TextTheme _textTheme(ColorScheme scheme) {
    TextStyle sans(double size, double line, FontWeight weight) => TextStyle(
      fontFamily: _sans,
      fontSize: size,
      height: line / size,
      fontWeight: weight,
      color: scheme.onSurface,
    );
    TextStyle serif(double size, double line) => TextStyle(
      fontFamily: _serif,
      fontSize: size,
      height: line / size,
      fontWeight: FontWeight.w600,
      color: scheme.onSurface,
    );
    return TextTheme(
      displaySmall: serif(34, 40),
      headlineMedium: serif(26, 32),
      headlineSmall: serif(26, 32),
      titleLarge: serif(20, 26),
      titleMedium: sans(16, 22, FontWeight.w600),
      titleSmall: sans(14, 20, FontWeight.w600),
      bodyLarge: sans(16, 24, FontWeight.w400),
      bodyMedium: sans(14, 20, FontWeight.w400),
      bodySmall: sans(12, 16, FontWeight.w400),
      labelLarge: sans(14, 20, FontWeight.w600),
      labelMedium: sans(12, 16, FontWeight.w600),
      labelSmall: sans(12, 16, FontWeight.w600),
    );
  }
}
