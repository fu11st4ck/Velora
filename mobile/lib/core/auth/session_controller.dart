import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../features/auth/data/auth_api.dart';
import '../api/api_client.dart';
import '../api/failure.dart';
import 'session.dart';

/// How this device is named in the user's list of signed-in devices.
final deviceNameProvider = Provider<String>(
  (ref) => switch (defaultTargetPlatform) {
    TargetPlatform.android => 'Android device',
    TargetPlatform.iOS => 'iPhone or iPad',
    _ => 'Other device',
  },
);

final sessionControllerProvider =
    NotifierProvider<SessionController, SessionState>(SessionController.new);

/// The signed-in user, or null. Rebuilds only when the user changes.
final currentUserProvider = Provider<Me?>((ref) {
  final state = ref.watch(sessionControllerProvider);
  return state is SignedIn ? state.me : null;
});

/// Owns the authentication state of the app.
class SessionController extends Notifier<SessionState> {
  @override
  SessionState build() => const SessionLoading();

  AuthApi get _api => ref.read(authApiProvider);

  /// Restores a session from stored tokens at start-up.
  Future<void> restore() async {
    state = const SessionLoading();
    final tokens = await ref.read(tokenStoreProvider).read();
    if (tokens == null) {
      state = const SignedOut();
      return;
    }
    await _loadProfile();
  }

  /// Throws [Failure] so the sign-in form can show it next to the fields.
  Future<void> signIn({required String email, required String password}) async {
    final tokens = await _api.login(
      email: email.trim(),
      password: password,
      deviceName: ref.read(deviceNameProvider),
    );
    await ref.read(tokenStoreProvider).write(tokens);
    await _loadProfile(rethrowFailure: true);
  }

  Future<void> signOut() async {
    final store = ref.read(tokenStoreProvider);
    final tokens = await store.read();
    if (tokens != null) {
      try {
        await _api.logout(tokens.refreshToken);
      } on Failure {
        // Signing out must work offline; the refresh token then simply expires server-side.
      }
    }
    await store.clear();
    state = const SignedOut();
  }

  /// Reloads the profile after something it carries changed (business settings, default tax rate).
  /// A failure leaves the current profile in place.
  Future<void> refreshProfile() async {
    if (state is! SignedIn) return;
    try {
      state = SignedIn(await _api.me());
    } on Failure {
      // The next start-up or sign-in loads it again.
    }
  }

  /// Called by the HTTP layer when the server rejected the session and tokens were cleared.
  void onSessionEnded() {
    if (state is! SignedOut) state = const SignedOut(expired: true);
  }

  Future<void> _loadProfile({bool rethrowFailure = false}) async {
    try {
      state = SignedIn(await _api.me());
    } on Failure catch (failure) {
      if (failure is UnauthorizedFailure || failure is ForbiddenFailure) {
        await ref.read(tokenStoreProvider).clear();
        state = SignedOut(expired: !rethrowFailure);
      } else if (rethrowFailure) {
        await ref.read(tokenStoreProvider).clear();
        state = const SignedOut();
      } else {
        state = SessionUnavailable(failure);
      }
      if (rethrowFailure) rethrow;
    }
  }
}
