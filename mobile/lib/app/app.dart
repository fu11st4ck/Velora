import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:material_ui/material_ui.dart';

import '../core/api/api_client.dart';
import '../core/auth/session_controller.dart';
import 'config/app_config.dart';
import 'router/app_router.dart';
import 'theme/app_theme.dart';
import 'theme/appearance.dart';

/// Provider overrides every entry point needs.
List<Override> appOverrides(AppConfig config) => [
  appConfigProvider.overrideWithValue(config),
  sessionEndedCallbackProvider.overrideWith(
    (ref) =>
        () => ref.read(sessionControllerProvider.notifier).onSessionEnded(),
  ),
];

class VeloraApp extends ConsumerStatefulWidget {
  const VeloraApp({super.key});

  @override
  ConsumerState<VeloraApp> createState() => _VeloraAppState();
}

class _VeloraAppState extends ConsumerState<VeloraApp> {
  @override
  void initState() {
    super.initState();
    Future.microtask(
      () => ref.read(sessionControllerProvider.notifier).restore(),
    );
  }

  @override
  Widget build(BuildContext context) {
    final flavor = ref.watch(appConfigProvider).flavor;
    return MaterialApp.router(
      title: 'Velora',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light(),
      darkTheme: AppTheme.dark(),
      themeMode: ref.watch(appearanceProvider),
      routerConfig: ref.watch(routerProvider),
      builder: (context, child) => flavor == Flavor.prod
          ? child!
          : Banner(
              message: flavor.name.toUpperCase(),
              location: BannerLocation.topEnd,
              child: child,
            ),
    );
  }
}

/// Riverpod would otherwise re-run a failed load on its own, with growing delays. Every screen
/// here shows the failure with a "Try again" action instead, so a load runs when the user asks.
Duration? noAutomaticRetry(int retryCount, Object error) => null;
