import 'dart:math' as math;

import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:velora/app/theme/app_theme.dart';
import 'package:velora/app/theme/tokens.dart';

/// WCAG 2.x contrast ratio between two opaque colours.
double contrast(Color a, Color b) {
  double channel(double c) =>
      c <= 0.03928 ? c / 12.92 : math.pow((c + 0.055) / 1.055, 2.4).toDouble();
  double luminance(Color c) =>
      0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
  final la = luminance(a), lb = luminance(b);
  return (math.max(la, lb) + 0.05) / (math.min(la, lb) + 0.05);
}

void main() {
  // Body text must reach 4.5:1 (docs/design-system.md §1).
  const body = 4.5;

  for (final (name, scheme, status, accent) in [
    ('light', VeloraColors.light, VeloraColors.lightStatus, Palette.gold700),
    ('dark', VeloraColors.dark, VeloraColors.darkStatus, Palette.gold300),
  ]) {
    group('$name theme', () {
      final textPairs = <String, (Color, Color)>{
        'text on page': (scheme.onSurface, scheme.surface),
        'text on card': (scheme.onSurface, scheme.surfaceContainer),
        'text on sheet': (scheme.onSurface, scheme.surfaceContainerHigh),
        'secondary text on page': (scheme.onSurfaceVariant, scheme.surface),
        'secondary text on card': (
          scheme.onSurfaceVariant,
          scheme.surfaceContainer,
        ),
        'secondary text on sheet': (
          scheme.onSurfaceVariant,
          scheme.surfaceContainerHigh,
        ),
        'primary button label': (scheme.onPrimary, scheme.primary),
        'primary as text on page': (scheme.primary, scheme.surface),
        'primary as text on card': (scheme.primary, scheme.surfaceContainer),
        'primary container': (
          scheme.onPrimaryContainer,
          scheme.primaryContainer,
        ),
        'secondary container': (
          scheme.onSecondaryContainer,
          scheme.secondaryContainer,
        ),
        'accent text on page': (accent, scheme.surface),
        'accent text on card': (accent, scheme.surfaceContainer),
        'error text on page': (scheme.error, scheme.surface),
        'error button label': (scheme.onError, scheme.error),
        'error container': (scheme.onErrorContainer, scheme.errorContainer),
        'success pill': (status.success.foreground, status.success.background),
        'warning pill': (status.warning.foreground, status.warning.background),
        'danger pill': (status.danger.foreground, status.danger.background),
        'neutral pill': (status.neutral.foreground, status.neutral.background),
      };
      textPairs.forEach((label, pair) {
        test('$label is at least 4.5:1', () {
          final ratio = contrast(pair.$1, pair.$2);
          expect(
            ratio,
            greaterThanOrEqualTo(body),
            reason: '$label is ${ratio.toStringAsFixed(2)}:1',
          );
        });
      });

      test('input borders are at least 3:1 against the page and the field', () {
        expect(
          contrast(scheme.outline, scheme.surface),
          greaterThanOrEqualTo(3),
        );
        expect(
          contrast(scheme.outline, scheme.surfaceContainer),
          greaterThanOrEqualTo(3),
        );
      });
    });
  }

  test('no text style is smaller than 12', () {
    for (final theme in [AppTheme.light(), AppTheme.dark()]) {
      final t = theme.textTheme;
      for (final style in [
        t.displaySmall,
        t.headlineMedium,
        t.titleLarge,
        t.titleMedium,
        t.titleSmall,
        t.bodyLarge,
        t.bodyMedium,
        t.bodySmall,
        t.labelLarge,
        t.labelMedium,
        t.labelSmall,
      ]) {
        expect(style!.fontSize, greaterThanOrEqualTo(12));
      }
      final tokens = theme.extension<VeloraTokens>()!;
      expect(tokens.overline.fontSize, greaterThanOrEqualTo(12));
    }
  });
}
