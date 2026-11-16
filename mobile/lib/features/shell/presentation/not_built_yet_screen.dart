import 'package:material_ui/material_ui.dart';

import '../../../core/widgets/state_views.dart';

/// Stands in for a tab whose feature is scheduled for a later sprint (see TASKS.md).
/// It shows no data and performs no action. Each use is removed when its feature lands;
/// the release checklist requires zero remaining uses.
class NotBuiltYetScreen extends StatelessWidget {
  const NotBuiltYetScreen({
    super.key,
    required this.title,
    required this.sprint,
  });

  final String title;
  final int sprint;

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(title)),
    body: MessageView(
      icon: Icons.construction_outlined,
      title: '$title is not built yet',
      body: 'This part of the app is scheduled for sprint $sprint.',
    ),
  );
}
