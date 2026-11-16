import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class StoredTokens {
  const StoredTokens({required this.accessToken, required this.refreshToken});
  final String accessToken;
  final String refreshToken;
}

/// Where session tokens live on the device.
abstract interface class TokenStore {
  Future<StoredTokens?> read();
  Future<void> write(StoredTokens tokens);
  Future<void> clear();
}

/// Keychain (iOS) / Keystore-backed storage (Android). Tokens are never written anywhere else.
class SecureTokenStore implements TokenStore {
  SecureTokenStore([FlutterSecureStorage? storage])
    : _storage =
          storage ??
          const FlutterSecureStorage(
            iOptions: IOSOptions(
              accessibility: KeychainAccessibility.first_unlock_this_device,
            ),
          );

  static const _access = 'velora.access_token';
  static const _refresh = 'velora.refresh_token';
  final FlutterSecureStorage _storage;

  @override
  Future<StoredTokens?> read() async {
    final access = await _storage.read(key: _access);
    final refresh = await _storage.read(key: _refresh);
    if (access == null || refresh == null) return null;
    return StoredTokens(accessToken: access, refreshToken: refresh);
  }

  @override
  Future<void> write(StoredTokens tokens) async {
    await _storage.write(key: _access, value: tokens.accessToken);
    await _storage.write(key: _refresh, value: tokens.refreshToken);
  }

  @override
  Future<void> clear() async {
    await _storage.delete(key: _access);
    await _storage.delete(key: _refresh);
  }
}

/// For tests.
class InMemoryTokenStore implements TokenStore {
  InMemoryTokenStore([this.tokens]);
  StoredTokens? tokens;

  @override
  Future<StoredTokens?> read() async => tokens;

  @override
  Future<void> write(StoredTokens tokens) async => this.tokens = tokens;

  @override
  Future<void> clear() async => tokens = null;
}
