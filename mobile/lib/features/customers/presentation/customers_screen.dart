import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../../app/router/routes.dart';
import 'customer_list_view.dart';

/// E1 Customers: the directory.
class CustomersScreen extends StatelessWidget {
  const CustomersScreen({super.key});

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Customers')),
    floatingActionButton: MediaQuery.withClampedTextScaling(
      maxScaleFactor: 1.3,
      child: FloatingActionButton.extended(
        key: const Key('new-customer'),
        onPressed: () => context.push(Routes.newCustomer),
        icon: const Icon(Icons.person_add_alt),
        label: const Text('New customer'),
      ),
    ),
    body: CustomerListView(
      bottomPadding: 96,
      onSelected: (customer) => context.push(Routes.customer(customer.id)),
      onCreate: (search) => context.push(Routes.newCustomer, extra: search),
    ),
  );
}
