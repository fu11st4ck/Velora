import 'package:material_ui/material_ui.dart';

import '../data/customer.dart';
import 'customer_form_screen.dart';
import 'customer_list_view.dart';

/// D4 Customer picker. Opens full-screen over the current page and returns the chosen customer —
/// an existing one, or one created on the spot — or null when dismissed.
Future<Customer?> showCustomerPicker(BuildContext context) =>
    Navigator.of(context, rootNavigator: true).push<Customer>(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => const _CustomerPickerScreen(),
      ),
    );

class _CustomerPickerScreen extends StatelessWidget {
  const _CustomerPickerScreen();

  Future<void> _create(BuildContext context, String search) async {
    final navigator = Navigator.of(context);
    final created = await navigator.push<Customer>(
      MaterialPageRoute(
        builder: (_) =>
            CustomerFormScreen(initialText: search.isEmpty ? null : search),
      ),
    );
    if (created != null) navigator.pop(created);
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: const Text('Choose customer'),
      actions: [
        TextButton.icon(
          key: const Key('picker-new-customer'),
          onPressed: () => _create(context, ''),
          icon: const Icon(Icons.person_add_alt),
          label: const Text('New'),
        ),
      ],
    ),
    body: CustomerListView(
      onSelected: (customer) => Navigator.of(context).pop(customer),
      onCreate: (search) => _create(context, search),
    ),
  );
}
