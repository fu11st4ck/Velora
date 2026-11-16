/// Route paths (docs/mobile-screen-specifications.md).
abstract final class Routes {
  static const startup = '/startup';
  static const login = '/login';
  static const forgotPassword = '/forgot-password';
  static const resetPassword = '/reset-password';
  static const home = '/home';
  static const inventory = '/inventory';
  static const sell = '/sell';
  static const documents = '/documents';
  static const more = '/more';

  static const newProduct = '/inventory/new';
  static String product(String id) => '/inventory/$id';
  static String editProduct(String id) => '/inventory/$id/edit';
  static String receiveStock(String id) => '/inventory/$id/receive';
  static String adjustStock(String id) => '/inventory/$id/adjust';
  static String stockHistory(String id) => '/inventory/$id/movements';

  static const customers = '/more/customers';
  static const newCustomer = '/more/customers/new';
  static String customer(String id) => '/more/customers/$id';
  static String editCustomer(String id) => '/more/customers/$id/edit';

  static const reports = '/more/reports';
  static const settings = '/more/settings';
  static const taxRates = '/more/settings/tax-rates';
  static const team = '/more/team';
  static const devices = '/more/devices';

  static const cart = '/sell/cart';
  static const payment = '/sell/payment';
  static String invoice(String id) => '/documents/invoices/$id';
  static String returnItems(String id) => '/documents/invoices/$id/return';
  static String quotation(String id) => '/documents/quotations/$id';

  /// Reachable without a session.
  static const public = {login, forgotPassword, resetPassword};
}
