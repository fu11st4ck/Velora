import 'package:flutter_test/flutter_test.dart';
import 'package:velora/core/money/money_math.dart';

/// These examples are the same ones asserted in backend/test/money.spec.ts — the two
/// implementations must agree to the minor unit.
void main() {
  test('rounds half up', () {
    expect(divRoundHalfUp(5, 10), 1);
    expect(divRoundHalfUp(4, 10), 0);
    expect(divRoundHalfUp(15, 10), 2);
    expect(divRoundHalfUp(0, 7), 0);
  });

  test('prices from cost and markup', () {
    expect(priceFromMarkup(280000, 3000), 364000);
    expect(priceFromMarkup(620000, 2000), 744000);
    expect(priceFromMarkup(245000, 2200), 298900);
    expect(priceFromMarkup(100055, 3000), 130072);
    expect(priceFromMarkup(100055, 1500), 115063);
    expect(priceFromMarkup(333, 3333), 444);
  });

  test('weighted average cost', () {
    expect(
      weightedAverageCost(
        onHand: 0,
        currentCostMinor: 999,
        received: 10,
        receivedUnitCostMinor: 280000,
      ),
      280000,
    );
    expect(
      weightedAverageCost(
        onHand: 24,
        currentCostMinor: 280000,
        received: 10,
        receivedUnitCostMinor: 290000,
      ),
      282941,
    );
    expect(
      weightedAverageCost(
        onHand: 1,
        currentCostMinor: 100,
        received: 1,
        receivedUnitCostMinor: 101,
      ),
      101,
    );
  });

  test('percent input to basis points and back', () {
    expect(parsePercentToBp('30'), 3000);
    expect(parsePercentToBp('12.5'), 1250);
    expect(parsePercentToBp('0.05'), 5);
    expect(parsePercentToBp(' 15 '), 1500);
    expect(parsePercentToBp('5.'), 500);
    for (final bad in ['', '-5', 'abc', '1.234', '1,5', '12345']) {
      expect(parsePercentToBp(bad), isNull, reason: bad);
    }
    expect(bpToPercentInput(3000), '30');
    expect(bpToPercentInput(1250), '12.5');
    expect(bpToPercentInput(1667), '16.67');
    expect(bpToPercentInput(5), '0.05');
  });
}
