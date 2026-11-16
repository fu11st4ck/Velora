import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../core/auth/session.dart';
import '../../core/auth/session_controller.dart';
import '../../features/auth/presentation/forgot_password_screen.dart';
import '../../features/auth/presentation/login_screen.dart';
import '../../features/auth/presentation/reset_password_screen.dart';
import '../../features/customers/presentation/customer_detail_screen.dart';
import '../../features/customers/presentation/customer_form_screen.dart';
import '../../features/customers/presentation/customers_screen.dart';
import '../../features/documents/presentation/documents_screen.dart';
import '../../features/documents/presentation/invoice_detail_screen.dart';
import '../../features/documents/presentation/quotation_detail_screen.dart';
import '../../features/documents/presentation/return_screen.dart';
import '../../features/home/presentation/home_screen.dart';
import '../../features/more/presentation/more_screen.dart';
import '../../features/products/presentation/adjust_stock_screen.dart';
import '../../features/products/presentation/inventory_screen.dart';
import '../../features/products/presentation/product_detail_screen.dart';
import '../../features/products/presentation/product_form_screen.dart';
import '../../features/products/presentation/receive_stock_screen.dart';
import '../../features/products/presentation/stock_history_screen.dart';
import '../../features/reports/presentation/reports_screen.dart';
import '../../features/settings/presentation/business_settings_screen.dart';
import '../../features/settings/presentation/devices_screen.dart';
import '../../features/settings/presentation/tax_rates_screen.dart';
import '../../features/settings/presentation/team_screen.dart';
import '../../features/shell/presentation/app_shell.dart';
import '../../features/sell/presentation/cart_screen.dart';
import '../../features/sell/presentation/payment_screen.dart';
import '../../features/sell/presentation/sell_screen.dart';
import '../../features/shell/presentation/startup_screen.dart';
import 'routes.dart';

/// Where a given session state may be, given where it is trying to go. Pure, so it is unit-tested.
String? redirectFor(SessionState session, String location) {
  final path = Uri.parse(location).path;
  switch (session) {
    case SessionLoading() || SessionUnavailable():
      // A password-reset link must work even while the stored session is being checked.
      if (path == Routes.resetPassword) return null;
      return path == Routes.startup ? null : Routes.startup;
    case SignedOut():
      return Routes.public.contains(path) ? null : Routes.login;
    case SignedIn():
      return (Routes.public.contains(path) ||
              path == Routes.startup ||
              path == '/')
          ? Routes.home
          : null;
  }
}

/// Keeps roles without stock-management rights out of the manager-only forms. This only tidies
/// navigation — the server refuses the underlying requests regardless.
GoRouterRedirect _managersOnly(Ref ref) =>
    (context, state) =>
        (ref.read(currentUserProvider)?.can('product.manage') ?? false)
        ? null
        : Routes.inventory;

final routerProvider = Provider<GoRouter>((ref) {
  final refresh = ValueNotifier<int>(0);
  ref.listen(sessionControllerProvider, (_, _) => refresh.value++);
  ref.onDispose(refresh.dispose);

  final router = GoRouter(
    initialLocation: Routes.startup,
    refreshListenable: refresh,
    redirect: (context, state) =>
        redirectFor(ref.read(sessionControllerProvider), state.uri.toString()),
    routes: [
      GoRoute(path: Routes.startup, builder: (_, _) => const StartupScreen()),
      GoRoute(path: Routes.login, builder: (_, _) => const LoginScreen()),
      GoRoute(
        path: Routes.forgotPassword,
        builder: (_, _) => const ForgotPasswordScreen(),
      ),
      GoRoute(
        path: Routes.resetPassword,
        builder: (_, state) =>
            ResetPasswordScreen(token: state.uri.queryParameters['token']),
      ),
      // Five tabs, each with its own navigation stack.
      StatefulShellRoute(
        builder: (_, _, shell) => AppShell(shell: shell),
        // Each tab gets its own messenger: a snackbar belongs to the tab that raised it and sits
        // above that screen's pinned action bar, instead of covering it from the shell.
        navigatorContainerBuilder: (_, shell, children) => IndexedStack(
          index: shell.currentIndex,
          children: [
            for (final (i, child) in children.indexed)
              TickerMode(
                enabled: i == shell.currentIndex,
                child: ScaffoldMessenger(child: child),
              ),
          ],
        ),
        branches: [
          StatefulShellBranch(
            routes: [
              GoRoute(path: Routes.home, builder: (_, _) => const HomeScreen()),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: Routes.inventory,
                builder: (_, _) => const InventoryScreen(),
                routes: [
                  // Declared before ':productId' so "new" is not read as an id.
                  GoRoute(
                    path: 'new',
                    redirect: _managersOnly(ref),
                    builder: (_, _) => const ProductFormScreen(),
                  ),
                  GoRoute(
                    path: ':productId',
                    builder: (_, state) => ProductDetailScreen(
                      productId: state.pathParameters['productId']!,
                    ),
                    routes: [
                      GoRoute(
                        path: 'edit',
                        redirect: _managersOnly(ref),
                        builder: (_, state) => ProductFormScreen(
                          productId: state.pathParameters['productId'],
                        ),
                      ),
                      GoRoute(
                        path: 'receive',
                        redirect: _managersOnly(ref),
                        builder: (_, state) => ReceiveStockScreen(
                          productId: state.pathParameters['productId']!,
                        ),
                      ),
                      GoRoute(
                        path: 'adjust',
                        redirect: _managersOnly(ref),
                        builder: (_, state) => AdjustStockScreen(
                          productId: state.pathParameters['productId']!,
                        ),
                      ),
                      GoRoute(
                        path: 'movements',
                        builder: (_, state) => StockHistoryScreen(
                          productId: state.pathParameters['productId']!,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: Routes.sell,
                builder: (_, _) => const SellScreen(),
                routes: [
                  GoRoute(path: 'cart', builder: (_, _) => const CartScreen()),
                  GoRoute(
                    path: 'payment',
                    builder: (_, _) => const PaymentScreen(),
                  ),
                ],
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: Routes.documents,
                builder: (_, _) => const DocumentsScreen(),
                routes: [
                  GoRoute(
                    path: 'invoices/:invoiceId',
                    builder: (_, state) => InvoiceDetailScreen(
                      invoiceId: state.pathParameters['invoiceId']!,
                    ),
                    routes: [
                      GoRoute(
                        path: 'return',
                        redirect: (context, state) =>
                            (ref
                                    .read(currentUserProvider)
                                    ?.can('invoice.return') ??
                                false)
                            ? null
                            : Routes.invoice(
                                state.pathParameters['invoiceId']!,
                              ),
                        builder: (_, state) => ReturnScreen(
                          invoiceId: state.pathParameters['invoiceId']!,
                        ),
                      ),
                    ],
                  ),
                  GoRoute(
                    path: 'quotations/:quotationId',
                    builder: (_, state) => QuotationDetailScreen(
                      quotationId: state.pathParameters['quotationId']!,
                    ),
                  ),
                ],
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: Routes.more,
                builder: (_, _) => const MoreScreen(),
                routes: [
                  GoRoute(
                    path: 'reports',
                    builder: (_, _) => const ReportsScreen(),
                  ),
                  GoRoute(
                    path: 'settings',
                    redirect: _needs(ref, 'settings.read'),
                    builder: (_, _) => const BusinessSettingsScreen(),
                    routes: [
                      GoRoute(
                        path: 'tax-rates',
                        builder: (_, _) => const TaxRatesScreen(),
                      ),
                    ],
                  ),
                  GoRoute(
                    path: 'team',
                    redirect: _needs(ref, 'team.read'),
                    builder: (_, _) => const TeamScreen(),
                  ),
                  GoRoute(
                    path: 'devices',
                    builder: (_, _) => const DevicesScreen(),
                  ),
                  GoRoute(
                    path: 'customers',
                    builder: (_, _) => const CustomersScreen(),
                    routes: [
                      GoRoute(
                        path: 'new',
                        builder: (_, state) => CustomerFormScreen(
                          initialText: state.extra as String?,
                        ),
                      ),
                      GoRoute(
                        path: ':customerId',
                        builder: (_, state) => CustomerDetailScreen(
                          customerId: state.pathParameters['customerId']!,
                        ),
                        routes: [
                          GoRoute(
                            path: 'edit',
                            builder: (_, state) => CustomerFormScreen(
                              customerId: state.pathParameters['customerId'],
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ],
              ),
            ],
          ),
        ],
      ),
    ],
  );
  ref.onDispose(router.dispose);
  return router;
});

/// Sends a user without [permission] back to More. The server enforces the permission too;
/// this only keeps a screen that would show an error out of reach.
GoRouterRedirect _needs(Ref ref, String permission) =>
    (context, state) =>
        (ref.read(currentUserProvider)?.can(permission) ?? false)
        ? null
        : Routes.more;
