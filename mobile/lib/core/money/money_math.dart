/// Integer mirrors of the server's calculations (docs/business-rules.md), used only for instant
/// previews while typing. The server's result is always what gets stored and shown afterwards.
/// These must stay identical to `backend/src/common/money.ts`; both sides test the same examples.
library;

const _bp = 10000;

/// N3: round half up for non-negative operands.
int divRoundHalfUp(int numerator, int denominator) {
  assert(numerator >= 0 && denominator > 0);
  return (2 * numerator + denominator) ~/ (2 * denominator);
}

/// P1: selling price for a cost and a markup on cost.
int priceFromMarkup(int costMinor, int markupBp) =>
    divRoundHalfUp(costMinor * (_bp + markupBp), _bp);

/// S5: moving weighted average cost after a receipt.
int weightedAverageCost({
  required int onHand,
  required int currentCostMinor,
  required int received,
  required int receivedUnitCostMinor,
}) {
  if (onHand <= 0) return receivedUnitCostMinor;
  return divRoundHalfUp(
    onHand * currentCostMinor + received * receivedUnitCostMinor,
    onHand + received,
  );
}

/// Parses a typed percentage such as `30` or `12.5` into basis points. Null when invalid,
/// negative, or more precise than 0.01%.
int? parsePercentToBp(String input) {
  final match = RegExp(r'^(\d{1,4})(?:\.(\d{0,2}))?$').firstMatch(input.trim());
  if (match == null) return null;
  final fraction = (match.group(2) ?? '').padRight(2, '0');
  return int.parse(match.group(1)!) * 100 + int.parse(fraction);
}

/// `3000` → `30`, `1250` → `12.5` (for pre-filling a percent field).
String bpToPercentInput(int bp) {
  final whole = bp ~/ 100;
  final fraction = bp % 100;
  if (fraction == 0) return '$whole';
  return '$whole.${fraction.toString().padLeft(2, '0').replaceFirst(RegExp(r'0$'), '')}';
}
