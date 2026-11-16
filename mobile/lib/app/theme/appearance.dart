import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../../core/storage/key_value_store.dart';

const _key = 'appearance';

/// Light, dark, or whatever the device uses. Remembered on the device.
final appearanceProvider = NotifierProvider<AppearanceController, ThemeMode>(
  AppearanceController.new,
);

class AppearanceController extends Notifier<ThemeMode> {
  @override
  ThemeMode build() {
    final stored = ref.watch(keyValueStoreProvider).read(_key);
    return ThemeMode.values.firstWhere(
      (m) => m.name == stored,
      orElse: () => ThemeMode.system,
    );
  }

  Future<void> set(ThemeMode mode) async {
    state = mode;
    await ref.read(keyValueStoreProvider).write(_key, mode.name);
  }
}

extension ThemeModeLabel on ThemeMode {
  String get label => switch (this) {
    ThemeMode.system => 'Same as device',
    ThemeMode.light => 'Light',
    ThemeMode.dark => 'Dark',
  };
}
