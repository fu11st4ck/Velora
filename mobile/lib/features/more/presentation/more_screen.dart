import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../../app/router/routes.dart';
import '../../../app/theme/appearance.dart';
import '../../../app/theme/tokens.dart';
import '../../../core/auth/session_controller.dart';
import '../../../core/offline/sync_engine.dart';

/// H1 More: profile, the less-frequent destinations, device preferences and sign out.
/// Rows the role cannot use are left out.
class MoreScreen extends ConsumerWidget {
  const MoreScreen({super.key});

  Future<void> _confirmSignOut(BuildContext context, WidgetRef ref) async {
    final unsent = ref.read(syncProvider).unsent;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Sign out?'),
        content: Text(
          unsent == 0
              ? 'You will need your email and password to sign in again.'
              : '$unsent ${unsent == 1 ? 'change has' : 'changes have'} not been sent to the server yet. '
                    'They stay on this device and are sent when you sign in again here. '
                    'They are lost if the app is removed first.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          TextButton(
            key: const Key('confirm-sign-out'),
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Sign out'),
          ),
        ],
      ),
    );
    if (confirmed ?? false) {
      await ref.read(sessionControllerProvider.notifier).signOut();
    }
  }

  Future<void> _chooseAppearance(BuildContext context, WidgetRef ref) async {
    final current = ref.read(appearanceProvider);
    final chosen = await showDialog<ThemeMode>(
      context: context,
      builder: (context) => SimpleDialog(
        title: const Text('Appearance'),
        children: [
          for (final mode in ThemeMode.values)
            ListTile(
              key: Key('appearance-${mode.name}'),
              leading: Icon(
                mode == current
                    ? Icons.radio_button_checked
                    : Icons.radio_button_unchecked,
              ),
              title: Text(mode.label),
              selected: mode == current,
              onTap: () => Navigator.of(context).pop(mode),
            ),
        ],
      ),
    );
    if (chosen != null) await ref.read(appearanceProvider.notifier).set(chosen);
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final me = ref.watch(currentUserProvider);
    if (me == null) return const SizedBox.shrink();
    final theme = Theme.of(context);
    final sync = ref.watch(syncProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('More')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(Space.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Card(
              child: Padding(
                padding: const EdgeInsets.all(Space.lg),
                child: MergeSemantics(
                  child: Row(
                    children: [
                      CircleAvatar(
                        radius: 24,
                        backgroundColor: theme.colorScheme.primaryContainer,
                        foregroundColor: theme.colorScheme.onPrimaryContainer,
                        child: ExcludeSemantics(
                          child: Text(
                            me.firstName.characters.first.toUpperCase(),
                            style: theme.textTheme.titleLarge,
                          ),
                        ),
                      ),
                      const SizedBox(width: Space.lg),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              me.fullName,
                              style: theme.textTheme.titleMedium,
                            ),
                            Text(
                              '${me.role.label} · ${me.organizationName}',
                              style: theme.textTheme.bodyMedium?.copyWith(
                                color: theme.colorScheme.onSurfaceVariant,
                              ),
                            ),
                            Text(
                              me.email,
                              style: theme.textTheme.bodyMedium?.copyWith(
                                color: theme.colorScheme.onSurfaceVariant,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
            const SizedBox(height: Space.lg),
            Card(
              clipBehavior: Clip.antiAlias,
              child: Column(
                children: [
                  _Row(
                    id: 'open-customers',
                    icon: Icons.people_outline,
                    title: 'Customers',
                    onTap: () => context.push(Routes.customers),
                  ),
                  const Divider(indent: Space.lg, endIndent: Space.lg),
                  _Row(
                    id: 'open-reports',
                    icon: Icons.insights_outlined,
                    title: 'Reports',
                    onTap: () => context.push(Routes.reports),
                  ),
                ],
              ),
            ),
            if (me.can('settings.read') || me.can('team.read')) ...[
              const SizedBox(height: Space.lg),
              Card(
                clipBehavior: Clip.antiAlias,
                child: Column(
                  children: [
                    if (me.can('settings.read'))
                      _Row(
                        id: 'open-settings',
                        icon: Icons.storefront_outlined,
                        title: 'Business settings',
                        onTap: () => context.push(Routes.settings),
                      ),
                    if (me.can('settings.read') && me.can('team.read'))
                      const Divider(indent: Space.lg, endIndent: Space.lg),
                    if (me.can('team.read'))
                      _Row(
                        id: 'open-team',
                        icon: Icons.groups_outlined,
                        title: 'Team',
                        onTap: () => context.push(Routes.team),
                      ),
                  ],
                ),
              ),
            ],
            const SizedBox(height: Space.lg),
            Card(
              clipBehavior: Clip.antiAlias,
              child: Column(
                children: [
                  _Row(
                    id: 'open-appearance',
                    icon: Icons.brightness_6_outlined,
                    title: 'Appearance',
                    value: ref.watch(appearanceProvider).label,
                    onTap: () => _chooseAppearance(context, ref),
                  ),
                  const Divider(indent: Space.lg, endIndent: Space.lg),
                  _Row(
                    id: 'open-sync',
                    icon: Icons.sync,
                    title: 'Sync',
                    value: sync.needsAttention > 0
                        ? '${sync.needsAttention} ${sync.needsAttention == 1 ? 'item needs' : 'items need'} attention'
                        : sync.waiting > 0
                        ? '${sync.waiting} waiting to send'
                        : 'Nothing waiting',
                    onTap: () => context.push(Routes.syncQueue),
                  ),
                  const Divider(indent: Space.lg, endIndent: Space.lg),
                  _Row(
                    id: 'open-password',
                    icon: Icons.lock_outline,
                    title: 'Change password',
                    onTap: () => context.push(Routes.changePassword),
                  ),
                  const Divider(indent: Space.lg, endIndent: Space.lg),
                  _Row(
                    id: 'open-devices',
                    icon: Icons.devices_other_outlined,
                    title: 'Signed-in devices',
                    onTap: () => context.push(Routes.devices),
                  ),
                ],
              ),
            ),
            const SizedBox(height: Space.lg),
            Card(
              clipBehavior: Clip.antiAlias,
              child: ListTile(
                key: const Key('sign-out'),
                leading: const Icon(Icons.logout),
                title: const Text('Sign out'),
                onTap: () => _confirmSignOut(context, ref),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Row extends StatelessWidget {
  const _Row({
    required this.id,
    required this.icon,
    required this.title,
    required this.onTap,
    this.value,
  });
  final String id;
  final IconData icon;
  final String title;
  final String? value;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => ListTile(
    key: Key(id),
    leading: Icon(icon),
    title: Text(title),
    subtitle: value == null ? null : Text(value!),
    trailing: const Icon(Icons.chevron_right),
    onTap: onTap,
  );
}
