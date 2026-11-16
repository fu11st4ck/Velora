/// `3000` → `30`, `1250` → `12.5` — the text shown in a percentage field.
String percentText(int bp) {
  final whole = bp ~/ 100;
  final fraction = bp % 100;
  if (fraction == 0) return '$whole';
  return '$whole.${fraction.toString().padLeft(2, '0').replaceFirst(RegExp(r'0$'), '')}';
}

/// A percentage with up to two decimals as basis points (`12.5` → `1250`), or null when the
/// text is not one. Integer arithmetic only.
int? parsePercent(String input) {
  final match = RegExp(r'^(\d{1,4})(?:[.,](\d{1,2}))?$')
      .firstMatch(input.trim());
  if (match == null) return null;
  final fraction = (match.group(2) ?? '').padRight(2, '0');
  return int.parse(match.group(1)!) * 100 + int.parse(fraction);
}
