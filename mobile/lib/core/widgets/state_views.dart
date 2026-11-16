import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../../app/theme/tokens.dart';
import '../api/failure.dart';
import '../api/failure_messages.dart';
import 'velora_mark.dart';

/// Centered message with an optional action: the shared layout for empty and error states.
class MessageView extends StatelessWidget {
  const MessageView({
    super.key,
    required this.title,
    this.body,
    this.actionLabel,
    this.onAction,
    this.icon,
  });

  final String title;
  final String? body;
  final String? actionLabel;
  final VoidCallback? onAction;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(Space.xxl),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 360),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (icon == null)
                const VeloraMark(size: 56)
              else
                Icon(icon, size: 40, color: theme.colorScheme.onSurfaceVariant),
              const SizedBox(height: Space.lg),
              Text(
                title,
                style: theme.textTheme.titleLarge,
                textAlign: TextAlign.center,
              ),
              if (body != null) ...[
                const SizedBox(height: Space.sm),
                Text(
                  body!,
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                  textAlign: TextAlign.center,
                ),
              ],
              if (actionLabel != null && onAction != null) ...[
                const SizedBox(height: Space.xl),
                OutlinedButton(onPressed: onAction, child: Text(actionLabel!)),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// Renders the four standard states of a data screen (design system §6) from one [AsyncValue].
class AsyncValueView<T> extends StatelessWidget {
  const AsyncValueView({
    super.key,
    required this.value,
    required this.data,
    required this.onRetry,
    this.isEmpty,
    this.empty,
    this.loading,
  });

  final AsyncValue<T> value;
  final Widget Function(T data) data;
  final VoidCallback onRetry;
  final bool Function(T data)? isEmpty;
  final Widget? empty;
  final Widget? loading;

  @override
  Widget build(BuildContext context) => switch (value) {
    AsyncData(:final value) =>
      (isEmpty?.call(value) ?? false) && empty != null ? empty! : data(value),
    AsyncError(:final error) => MessageView(
      icon: Icons.cloud_off_outlined,
      title: 'Could not load',
      body: describeFailure(Failure.from(error)),
      actionLabel: 'Try again',
      onAction: onRetry,
    ),
    _ => loading ?? const Center(child: CircularProgressIndicator()),
  };
}
