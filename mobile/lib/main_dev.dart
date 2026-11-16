import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import 'app/app.dart';
import 'app/config/app_config.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(
    ProviderScope(
      overrides: appOverrides(AppConfig.fromEnvironment(Flavor.dev)),
      child: const VeloraApp(),
    ),
  );
}
