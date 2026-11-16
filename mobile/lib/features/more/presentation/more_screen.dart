import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../../app/router/routes.dart';
import '../../../app/theme/tokens.dart';
import '../../../core/auth/session_controller.dart';

/// H1 More. Sprint 1: profile and sign out. Customers, reports, settings, team and the sync
/// queue are added to this list as their sprints land.
class MoreScreen extends ConsumerWidget {
  const MoreScreen({super.key});

  Future<void> _confirmSignOut(BuildContext context, WidgetRef ref) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Sign out?'),
        content: const Text(
          'You will need your email and password to sign in again.',
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

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final me = ref.watch(currentUserProvider);
    if (me == null) return const SizedBox.shrink();
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('More')),
      body: ListView(
        padding: const EdgeInsets.all(Space.lg),
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
                          Text(me.fullName, style: theme.textTheme.titleMedium),
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
            child: ListTile(
              key: const Key('open-customers'),
              leading: const Icon(Icons.people_outline),
              title: const Text('Customers'),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => context.push(Routes.customers),
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
    );
  }
}
