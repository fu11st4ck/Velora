import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../../app/router/routes.dart';

/// Ends the sale in progress: the Sell tab returns to its product list, then [location] (the
/// document just created, under the Documents tab) is shown.
///
/// Two steps because each tab keeps its own stack: going straight to the document would leave the
/// finished cart and payment screens waiting on the Sell tab.
void finishSaleAt(BuildContext context, String location) {
  final router = GoRouter.of(context);
  router.go(Routes.sell);
  WidgetsBinding.instance.addPostFrameCallback((_) => router.go(location));
}
