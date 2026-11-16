import 'package:flutter_test/flutter_test.dart';
import 'package:velora/core/money/money_format.dart';

void main() {
  final aed = MoneyFormatter(currencyCode: 'AED', exponent: 2);

  group('format', () {
    test('always shows the currency decimals, so documents visibly add up', () {
      expect(aed.format(298095), 'AED 2,980.95');
      expect(aed.format(14195), 'AED 141.95');
      expect(aed.format(364000), 'AED 3,640.00');
      expect(aed.format(5), 'AED 0.05');
      expect(aed.format(0), 'AED 0.00');
    });

    test('groups thousands and marks negatives with a minus sign', () {
      expect(aed.format(15085000000), 'AED 150,850,000.00');
      expect(aed.format(-15000), '−AED 150.00');
    });

    test('respects currencies with other minor units', () {
      expect(
        MoneyFormatter(currencyCode: 'JPY', exponent: 0).format(1234),
        'JPY 1,234',
      );
      expect(
        MoneyFormatter(currencyCode: 'KWD', exponent: 3).format(1234567),
        'KWD 1,234.567',
      );
    });

    test('can omit the currency code', () {
      expect(aed.format(298095, withCode: false), '2,980.95');
    });
  });

  group('parse', () {
    test('reads typed amounts into minor units without floating point', () {
      expect(aed.parse('2980.95'), 298095);
      expect(aed.parse('2,980.95'), 298095);
      expect(aed.parse(' 100 '), 10000);
      expect(aed.parse('0.1'), 10);
      expect(aed.parse('1000.55'), 100055);
      expect(
        aed.parse('19.99'),
        1999,
      ); // 19.99 * 100 is 1998.9999… in floating point
      expect(aed.parse('5.'), 500);
    });

    test('rejects negatives, text and too many decimal places', () {
      expect(aed.parse('-5'), isNull);
      expect(aed.parse('abc'), isNull);
      expect(aed.parse(''), isNull);
      expect(aed.parse('1.234'), isNull);
      expect(aed.parse('1.2.3'), isNull);
      expect(
        MoneyFormatter(currencyCode: 'JPY', exponent: 0).parse('1.5'),
        isNull,
      );
    });
  });

  test('formats basis points as a percentage', () {
    expect(formatBasisPoints(3000), '30%');
    expect(formatBasisPoints(500), '5%');
    expect(formatBasisPoints(1250), '12.5%');
    expect(formatBasisPoints(1667), '16.67%');
    expect(formatBasisPoints(5), '0.05%');
    expect(formatBasisPoints(0), '0%');
  });
}
