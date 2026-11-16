import 'package:intl/intl.dart';

/// Formats integer minor units for display. Amounts are never held as floating point:
/// the whole and fractional parts are separated with integer arithmetic (business rule N1).
class MoneyFormatter {
  MoneyFormatter({
    required this.currencyCode,
    required this.exponent,
    String locale = 'en',
  }) : assert(exponent >= 0 && exponent <= 4),
       _whole = NumberFormat.decimalPattern(locale),
       _decimalSeparator = NumberFormat.decimalPattern(locale)
           .symbols
           .DECIMAL_SEP;

  final String currencyCode;
  final int exponent;
  final NumberFormat _whole;
  final String _decimalSeparator;

  /// e.g. `298095` → `AED 2,980.95`.
  String format(int minor, {bool withCode = true}) {
    final scale = _pow10(exponent);
    final abs = minor.abs();
    final whole = _whole.format(abs ~/ scale);
    final fraction = exponent == 0
        ? ''
        : '$_decimalSeparator${(abs % scale).toString().padLeft(exponent, '0')}';
    final sign = minor < 0 ? '−' : '';
    return withCode
        ? '$sign$currencyCode $whole$fraction'
        : '$sign$whole$fraction';
  }

  /// Parses user input such as `2,980.95` into minor units. Returns null when it is not a valid
  /// non-negative amount or has more decimal places than the currency allows.
  int? parse(String input) {
    final cleaned = input.trim().replaceAll(RegExp(r'[\s,]'), '');
    final match = RegExp(r'^(\d{1,12})(?:\.(\d*))?$').firstMatch(cleaned);
    if (match == null) return null;
    final fraction = match.group(2) ?? '';
    if (fraction.length > exponent) return null;
    return int.parse(match.group(1)!) * _pow10(exponent) +
        (fraction.isEmpty ? 0 : int.parse(fraction.padRight(exponent, '0')));
  }

  static int _pow10(int n) {
    var result = 1;
    for (var i = 0; i < n; i++) {
      result *= 10;
    }
    return result;
  }
}

/// `3000` → `30%`, `1250` → `12.5%`.
String formatBasisPoints(int bp) {
  final whole = bp ~/ 100;
  final fraction = bp % 100;
  if (fraction == 0) return '$whole%';
  final text = fraction
      .toString()
      .padLeft(2, '0')
      .replaceFirst(RegExp(r'0$'), '');
  return '$whole.$text%';
}
