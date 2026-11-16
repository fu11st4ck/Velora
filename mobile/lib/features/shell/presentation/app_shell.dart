import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:material_ui/material_ui.dart';

import '../../../app/theme/tokens.dart';
import '../../../core/offline/connection_status.dart';
import '../../../core/offline/sync_engine.dart';

import '../../sell/presentation/cart_controller.dart';

/// Width at which the bottom bar becomes a navigation rail (design system: tablets ≥ 840 dp).
const railBreakpoint = 840.0;

const _destinations = <({String label, IconData icon, IconData selectedIcon})>[
  (label: 'Home', icon: Icons.home_outlined, selectedIcon: Icons.home),
  (
    label: 'Inventory',
    icon: Icons.inventory_2_outlined,
    selectedIcon: Icons.inventory_2,
  ),
  (
    label: 'Sell',
    icon: Icons.point_of_sale_outlined,
    selectedIcon: Icons.point_of_sale,
  ),
  (
    label: 'Documents',
    icon: Icons.receipt_long_outlined,
    selectedIcon: Icons.receipt_long,
  ),
  (label: 'More', icon: Icons.menu, selectedIcon: Icons.menu_open),
];

/// Primary navigation: five destinations, each keeping its own stack.
class AppShell extends ConsumerWidget {
  const AppShell({super.key, required this.shell});
  final StatefulNavigationShell shell;

  // Tapping the current tab returns it to its root.
  void _go(int index) =>
      shell.goBranch(index, initialLocation: index == shell.currentIndex);

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // The Sell tab shows how many units are in the cart, wherever the user is.
    final cartUnits = ref.watch(cartProvider.select((c) => c.units));
    // More shows how many changes made offline are still waiting to be sent.
    final unsent = ref.watch(syncProvider.select((s) => s.unsent));
    Widget badge(int index, Widget icon) => index == 2 && cartUnits > 0
        ? Badge(label: Text('$cartUnits'), child: icon)
        : index == 4 && unsent > 0
        ? Badge(label: Text('$unsent'), child: icon)
        : icon;
    final content = Column(
      children: [
        const OfflineBanner(),
        Expanded(child: shell),
      ],
    );
    final wide = MediaQuery.sizeOf(context).width >= railBreakpoint;
    if (wide) {
      return Scaffold(
        body: SafeArea(
          child: Row(
            children: [
              NavigationRail(
                selectedIndex: shell.currentIndex,
                onDestinationSelected: _go,
                labelType: NavigationRailLabelType.all,
                destinations: [
                  for (final (i, d) in _destinations.indexed)
                    NavigationRailDestination(
                      icon: badge(i, Icon(d.icon)),
                      selectedIcon: badge(i, Icon(d.selectedIcon)),
                      label: Text(d.label),
                    ),
                ],
              ),
              const VerticalDivider(width: 1),
              Expanded(child: content),
            ],
          ),
        ),
      );
    }
    return Scaffold(
      body: content,
      bottomNavigationBar: DecoratedBox(
        decoration: BoxDecoration(
          border: Border(
            top: BorderSide(
              color: Theme.of(context).colorScheme.outlineVariant,
            ),
          ),
        ),
        // Five labels share the width. They grow with the system text size only as far as the
        // width allows without wrapping; the icons and the screen title carry the meaning beyond that.
        child: MediaQuery.withClampedTextScaling(
          maxScaleFactor: MediaQuery.sizeOf(context).width >= 480 ? 1.3 : 1.0,
          child: NavigationBar(
            selectedIndex: shell.currentIndex,
            onDestinationSelected: _go,
            destinations: [
              for (final (i, d) in _destinations.indexed)
                NavigationDestination(
                  icon: badge(i, Icon(d.icon)),
                  selectedIcon: badge(i, Icon(d.selectedIcon)),
                  label: d.label,
                ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Shown across the top while the server cannot be reached, with the age of the saved data.
class OfflineBanner extends ConsumerWidget {
  const OfflineBanner({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (!ref.watch(offlineProvider)) return const SizedBox.shrink();
    final synced = ref.watch(syncProvider.select((s) => s.lastSyncedAt));
    final colors = VeloraTokens.of(context).status(StatusTone.warning);
    return Material(
      color: colors.background,
      child: SafeArea(
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: Space.lg,
            vertical: Space.sm,
          ),
          child: Row(
            children: [
              Icon(
                Icons.cloud_off_outlined,
                size: 18,
                color: colors.foreground,
              ),
              const SizedBox(width: Space.sm),
              Expanded(
                child: Text(
                  synced == null
                      ? 'No connection.'
                      : 'No connection. Showing data saved ${DateFormat('d MMM, HH:mm').format(synced.toLocal())}.',
                  key: const Key('offline-banner'),
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: colors.foreground,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
