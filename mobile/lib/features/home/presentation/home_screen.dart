import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../../../app/theme/tokens.dart';
import '../../../core/time/clock.dart';
import '../../../core/auth/session.dart';
import '../../../core/auth/session_controller.dart';
import '../../../core/money/money_format.dart';
import '../../../core/widgets/status_pill.dart';

/// B1 Home. Sprint 1 shows the signed-in context only; the KPI grid, attention list and
/// recent documents arrive with the dashboard API in sprint 5 (TASKS.md S5-01).
class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  static String greeting(DateTime now) {
    if (now.hour < 12) return 'Good morning';
    if (now.hour < 18) return 'Good afternoon';
    return 'Good evening';
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final me = ref.watch(currentUserProvider);
    if (me == null) return const SizedBox.shrink();
    final theme = Theme.of(context);
    final tokens = VeloraTokens.of(context);
    final settings = me.settings;
    final tax = settings.defaultTaxRate;

    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(Space.lg),
          children: [
            const SizedBox(height: Space.sm),
            Text(me.organizationName.toUpperCase(), style: tokens.overline),
            const SizedBox(height: Space.xs),
            Semantics(
              header: true,
              child: Text(
                '${greeting(ref.watch(clockProvider)())}, ${me.firstName}',
                style: theme.textTheme.headlineMedium,
              ),
            ),
            const SizedBox(height: Space.md),
            Align(
              alignment: Alignment.centerLeft,
              child: StatusPill(
                label: me.role.label,
                tone: StatusTone.neutral,
                icon: me.role == Role.sales
                    ? Icons.badge_outlined
                    : Icons.verified_user_outlined,
              ),
            ),
            const SizedBox(height: Space.xxl),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(Space.lg),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Business settings',
                      style: theme.textTheme.titleLarge,
                    ),
                    const SizedBox(height: Space.md),
                    _Fact(label: 'Currency', value: settings.currencyCode),
                    _Fact(label: 'Time zone', value: settings.timezone),
                    if (tax != null)
                      _Fact(
                        label: 'Default tax',
                        value: '${tax.name} (${formatBasisPoints(tax.rateBp)})',
                      ),
                    _Fact(
                      label: 'Low-stock threshold',
                      value: '${settings.lowStockThreshold} pcs',
                    ),
                    _Fact(
                      label: 'Credit period',
                      value: '${settings.defaultCreditDays} days',
                    ),
                    if (settings.maxMarkupBp != null)
                      _Fact(
                        label: 'Maximum markup',
                        value: formatBasisPoints(settings.maxMarkupBp!),
                      ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Fact extends StatelessWidget {
  const _Fact({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return MergeSemantics(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: Space.sm),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Text(
                label,
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ),
            const SizedBox(width: Space.lg),
            Expanded(
              child: Text(
                value,
                style: theme.textTheme.titleSmall,
                textAlign: TextAlign.end,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
