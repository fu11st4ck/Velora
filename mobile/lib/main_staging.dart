import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'app/app.dart';
import 'app/config/app_config.dart';
import 'core/storage/key_value_store.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final preferences = await SharedPreferences.getInstance();
  runApp(
    ProviderScope(
      overrides: [
        ...appOverrides(AppConfig.fromEnvironment(Flavor.staging)),
        keyValueStoreProvider.overrideWithValue(
          SharedPreferencesStore(preferences),
        ),
      ],
      child: const VeloraApp(),
    ),
  );
}
