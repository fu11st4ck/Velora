import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../auth/session_controller.dart';
import 'money_format.dart';

/// Formats amounts in the signed-in organization's currency. The currency comes from the
/// server's settings — it is never assumed by the app.
final moneyFormatterProvider = Provider<MoneyFormatter>((ref) {
  final settings = ref.watch(currentUserProvider.select((me) => me?.settings));
  if (settings == null) throw StateError('No signed-in user');
  return MoneyFormatter(
    currencyCode: settings.currencyCode,
    exponent: settings.currencyExponent,
  );
});
