import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

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
class AppShell extends StatelessWidget {
  const AppShell({super.key, required this.shell});
  final StatefulNavigationShell shell;

  // Tapping the current tab returns it to its root.
  void _go(int index) =>
      shell.goBranch(index, initialLocation: index == shell.currentIndex);

  @override
  Widget build(BuildContext context) {
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
                  for (final d in _destinations)
                    NavigationRailDestination(
                      icon: Icon(d.icon),
                      selectedIcon: Icon(d.selectedIcon),
                      label: Text(d.label),
                    ),
                ],
              ),
              const VerticalDivider(width: 1),
              Expanded(child: shell),
            ],
          ),
        ),
      );
    }
    return Scaffold(
      body: shell,
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
              for (final d in _destinations)
                NavigationDestination(
                  icon: Icon(d.icon),
                  selectedIcon: Icon(d.selectedIcon),
                  label: d.label,
                ),
            ],
          ),
        ),
      ),
    );
  }
}
