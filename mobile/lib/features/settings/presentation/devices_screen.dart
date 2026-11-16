import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:material_ui/material_ui.dart';

import '../../../app/theme/tokens.dart';
import '../../../core/api/failure.dart';
import '../../../core/api/failure_messages.dart';
import '../../../core/widgets/state_views.dart';
import '../../../core/widgets/status_pill.dart';
import '../data/organization.dart';
import '../data/settings_api.dart';

/// Where the user is signed in, with a way to sign another device out.
class DevicesScreen extends ConsumerWidget {
  const DevicesScreen({super.key});

  Future<void> _signOut(
    BuildContext context,
    WidgetRef ref,
    DeviceSession session,
  ) async {
    final messenger = ScaffoldMessenger.of(context);
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Sign this device out?'),
        content: const Text(
          'It may keep working for up to 15 minutes, then it must sign in again.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          TextButton(
            key: const Key('confirm-device-sign-out'),
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Sign out'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await ref.read(settingsApiProvider).revokeSession(session.id);
      ref.invalidate(deviceSessionsProvider);
      messenger
        ..hideCurrentSnackBar()
        ..showSnackBar(const SnackBar(content: Text('Device signed out.')));
    } on Failure catch (failure) {
      ref.invalidate(deviceSessionsProvider);
      messenger
        ..hideCurrentSnackBar()
        ..showSnackBar(SnackBar(content: Text(describeFailure(failure))));
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final sessions = ref.watch(deviceSessionsProvider);
    final format = DateFormat('d MMM yyyy, HH:mm');
    return Scaffold(
      appBar: AppBar(title: const Text('Signed-in devices')),
      body: RefreshIndicator(
        onRefresh: () => ref.refresh(deviceSessionsProvider.future),
        child: AsyncValueView<List<DeviceSession>>(
          value: sessions,
          onRetry: () => ref.invalidate(deviceSessionsProvider),
          data: (list) => ListView.separated(
            physics: const AlwaysScrollableScrollPhysics(),
            itemCount: list.length,
            separatorBuilder: (_, _) =>
                const Divider(indent: Space.lg, endIndent: Space.lg),
            itemBuilder: (context, i) {
              final s = list[i];
              return ListTile(
                key: Key('device-$i'),
                leading: const Icon(Icons.devices_other_outlined),
                title: Text(s.deviceName ?? 'Unnamed device'),
                subtitle: Text(
                  'Last used ${format.format(s.lastActiveAt.toLocal())}\nSigned in ${format.format(s.signedInAt.toLocal())}',
                ),
                isThreeLine: true,
                trailing: s.isCurrent
                    ? const StatusPill(
                        label: 'This device',
                        tone: StatusTone.success,
                      )
                    : TextButton(
                        key: Key('device-sign-out-$i'),
                        onPressed: () => _signOut(context, ref, s),
                        child: const Text('Sign out'),
                      ),
              );
            },
          ),
        ),
      ),
    );
  }
}
