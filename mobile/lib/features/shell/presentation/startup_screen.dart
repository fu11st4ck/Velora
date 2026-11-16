import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../../../app/theme/tokens.dart';
import '../../../core/api/failure_messages.dart';
import '../../../core/auth/session.dart';
import '../../../core/auth/session_controller.dart';
import '../../../core/widgets/state_views.dart';
import '../../../core/widgets/velora_mark.dart';

/// Shown while a stored session is being restored, and when that could not be completed
/// (for example, no connection at launch).
class StartupScreen extends ConsumerWidget {
  const StartupScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionControllerProvider);
    final controller = ref.read(sessionControllerProvider.notifier);
    return Scaffold(
      body: SafeArea(
        child: switch (session) {
          SessionUnavailable(:final failure) => Column(
            children: [
              Expanded(
                child: MessageView(
                  icon: Icons.cloud_off_outlined,
                  title: 'Could not reach Velora',
                  body: describeFailure(failure),
                  actionLabel: 'Try again',
                  onAction: controller.restore,
                ),
              ),
              Padding(
                padding: const EdgeInsets.all(Space.lg),
                child: TextButton(
                  onPressed: controller.signOut,
                  child: const Text('Sign out'),
                ),
              ),
            ],
          ),
          _ => Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const VeloraMark(size: 88),
                const SizedBox(height: Space.xxl),
                Semantics(
                  label: 'Loading',
                  child: const CircularProgressIndicator(),
                ),
              ],
            ),
          ),
        },
      ),
    );
  }
}
