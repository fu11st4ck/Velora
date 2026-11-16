/// Build-time configuration. Values come from `--dart-define` (see ENVIRONMENT.md).
/// Nothing here is secret: the app binary must never contain credentials.
enum Flavor { dev, staging, prod }

class AppConfig {
  const AppConfig({required this.flavor, required this.apiBaseUrl});

  factory AppConfig.fromEnvironment(Flavor flavor) {
    const url = String.fromEnvironment('API_BASE_URL');
    if (url.isEmpty) {
      if (flavor != Flavor.dev) {
        throw StateError(
          'API_BASE_URL must be provided with --dart-define for $flavor builds.',
        );
      }
      // Android emulators reach the host machine at 10.0.2.2; override for simulators and devices.
      return AppConfig(
        flavor: flavor,
        apiBaseUrl: 'http://10.0.2.2:3000/api/v1',
      );
    }
    if (flavor != Flavor.dev && !url.startsWith('https://')) {
      throw StateError('API_BASE_URL must use https for $flavor builds.');
    }
    return AppConfig(flavor: flavor, apiBaseUrl: url);
  }

  final Flavor flavor;
  final String apiBaseUrl;
}
