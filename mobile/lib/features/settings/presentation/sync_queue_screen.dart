import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:material_ui/material_ui.dart';

import '../../../app/theme/tokens.dart';
import '../../../core/offline/connection_status.dart';
import '../../../core/offline/local_db.dart';
import '../../../core/offline/sync_engine.dart';
import '../../../core/widgets/notice.dart';
import '../../../core/widgets/sections.dart';
import '../../../core/widgets/state_views.dart';
import '../../../core/widgets/status_pill.dart';

/// H2 Sync queue: what was done without a connection and has not reached the server yet.
/// Nothing leaves this list silently — it is sent, or a person retries or discards it.
class SyncQueueScreen extends ConsumerWidget {
  const SyncQueueScreen({super.key});

  Future<void> _discard(
    BuildContext context,
    WidgetRef ref,
    OutboxItem item,
    int dependants,
  ) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Discard this?'),
        content: Text(
          [
            item.summary,
            'It was never sent to the server and will be gone for good.',
            if (dependants > 0)
              dependants == 1
                  ? 'One item that depends on it is discarded too.'
                  : '$dependants items that depend on it are discarded too.',
          ].join('\n\n'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Keep'),
          ),
          TextButton(
            key: const Key('confirm-discard'),
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Discard'),
          ),
        ],
      ),
    );
    if (confirmed ?? false) ref.read(syncProvider.notifier).discard(item.id);
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final status = ref.watch(syncProvider);
    final items = ref.watch(outboxProvider);
    final offline = ref.watch(offlineProvider);
    final time = DateFormat('d MMM, HH:mm');
    final muted = theme.textTheme.bodyMedium?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );

    return Scaffold(
      appBar: AppBar(title: const Text('Sync')),
      bottomNavigationBar: PinnedBar(
        child: FilledButton.icon(
          key: const Key('sync-now'),
          style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)),
          icon: status.syncing
              ? const SizedBox.square(
                  dimension: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.sync),
          label: Text(status.syncing ? 'Syncing…' : 'Sync now'),
          onPressed: status.syncing
              ? null
              : () => unawaited(ref.read(syncProvider.notifier).syncNow()),
        ),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(Space.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              status.lastSyncedAt == null
                  ? 'Products and customers have not been saved on this device yet.'
                  : 'Products and customers saved on this device as of ${time.format(status.lastSyncedAt!.toLocal())}.',
              key: const Key('last-synced'),
              style: muted,
            ),
            if (offline) ...[
              const SizedBox(height: Space.md),
              const Notice(
                message: 'No connection. Waiting items are sent automatically when it returns.',
                tone: StatusTone.warning,
                icon: Icons.cloud_off_outlined,
              ),
            ],
            const SizedBox(height: Space.lg),
            if (items.isEmpty)
              const Padding(
                padding: EdgeInsets.only(top: Space.huge),
                child: MessageView(
                  icon: Icons.cloud_done_outlined,
                  title: 'Nothing waiting',
                  body:
                      'Everything done on this device has reached the server.',
                ),
              )
            else
              for (final (i, item) in items.indexed) ...[
                if (i > 0) const SizedBox(height: Space.md),
                Card(
                  key: Key('queue-$i'),
                  margin: EdgeInsets.zero,
                  child: Padding(
                    padding: const EdgeInsets.all(Space.lg),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(item.summary, style: theme.textTheme.titleMedium),
                        const SizedBox(height: Space.xs),
                        Text(
                          'Made ${time.format(item.createdAt.toLocal())}',
                          style: muted,
                        ),
                        const SizedBox(height: Space.sm),
                        if (item.state == OutboxState.waiting)
                          StatusPill(
                            label:
                                item.dependsOn != null &&
                                    items.any((o) => o.id == item.dependsOn)
                                ? 'Waiting for the item above'
                                : 'Waiting to send',
                            tone: StatusTone.neutral,
                          )
                        else ...[
                          const StatusPill(
                            label: 'Needs attention',
                            tone: StatusTone.danger,
                          ),
                          const SizedBox(height: Space.sm),
                          Text(
                            item.errorMessage ??
                                'The server did not accept this.',
                            style: theme.textTheme.bodyMedium,
                          ),
                        ],
                        const SizedBox(height: Space.sm),
                        Wrap(
                          spacing: Space.sm,
                          children: [
                            if (item.state == OutboxState.needsAttention)
                              OutlinedButton(
                                key: Key('queue-retry-$i'),
                                onPressed: () {
                                  ref
                                      .read(syncProvider.notifier)
                                      .retry(item.id);
                                  unawaited(
                                    ref.read(syncProvider.notifier).syncNow(),
                                  );
                                },
                                child: const Text('Try again'),
                              ),
                            TextButton(
                              key: Key('queue-discard-$i'),
                              onPressed: () => _discard(
                                context,
                                ref,
                                item,
                                items
                                    .where((o) => o.dependsOn == item.id)
                                    .length,
                              ),
                              child: const Text('Discard'),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
              ],
          ],
        ),
      ),
    );
  }
}
