import 'package:flutter/services.dart';

import '../../../core/money/money_format.dart';
import '../../../core/money/money_math.dart';

/// Digits with an optional decimal part.
final decimalInput = FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]'));

/// Field validators for the stock and product forms. Each mirrors a server rule so that most
/// mistakes are caught before a request is made; the server remains the authority.
abstract final class StockValidators {
  static const maxQuantity = 1000000;

  static String? required(String? value, String message) =>
      (value == null || value.trim().isEmpty) ? message : null;

  static String? wholeNumber(
    String? value, {
    required int min,
    int max = maxQuantity,
    String? unit,
  }) {
    final text = value?.trim() ?? '';
    final n = int.tryParse(text);
    if (text.isEmpty || n == null) return 'Enter a whole number.';
    if (n < min) return min == 1 ? 'Enter at least 1.' : 'Enter $min or more.';
    if (n > max) {
      return unit == null ? 'Enter $max or less.' : 'Only $max $unit.';
    }
    return null;
  }

  static String? optionalWholeNumber(String? value) =>
      (value == null || value.trim().isEmpty)
      ? null
      : wholeNumber(value, min: 0);

  static String? money(String? value, MoneyFormatter format) {
    if (value == null || value.trim().isEmpty) return 'Enter an amount.';
    return format.parse(value) == null
        ? 'Enter a valid amount with up to ${format.exponent} decimals.'
        : null;
  }

  static String? percent(String? value) {
    if (value == null || value.trim().isEmpty) return 'Enter a percentage.';
    return parsePercentToBp(value) == null
        ? 'Enter a percentage such as 30 or 12.5.'
        : null;
  }

  static final _sku = RegExp(r'^[A-Za-z0-9._-]+$');

  static String? sku(String? value, {bool required = false}) {
    final text = value?.trim() ?? '';
    if (text.isEmpty) return required ? 'Enter a SKU.' : null;
    if (text.length > 40) return 'Use at most 40 characters.';
    return _sku.hasMatch(text)
        ? null
        : 'Use letters, numbers, dots, dashes and underscores only.';
  }

  static final _weight = RegExp(r'^\d{1,9}(\.\d{1,3})?$');

  static String? weight(String? value) {
    final text = value?.trim() ?? '';
    if (text.isEmpty) return null;
    if (!_weight.hasMatch(text) || double.parse(text) <= 0) {
      return 'Enter a weight with up to 3 decimals.';
    }
    return null;
  }
}
