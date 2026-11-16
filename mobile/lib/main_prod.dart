import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'app/app.dart';
import 'app/config/app_config.dart';
import 'core/offline/device_database.dart';
import 'core/offline/local_db.dart';
import 'core/storage/key_value_store.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final preferences = await SharedPreferences.getInstance();
  final database = await openDeviceDatabase();
  runApp(
    ProviderScope(
      retry: noAutomaticRetry,
      overrides: [
        ...appOverrides(AppConfig.fromEnvironment(Flavor.prod)),
        keyValueStoreProvider.overrideWithValue(
          SharedPreferencesStore(preferences),
        ),
        if (database != null) localDbProvider.overrideWithValue(database),
      ],
      child: const VeloraApp(),
    ),
  );
}
