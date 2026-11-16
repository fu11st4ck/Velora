import 'package:flutter/foundation.dart';
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
import '../../features/home/presentation/home_screen.dart';
import '../../features/more/presentation/more_screen.dart';
import '../../features/products/presentation/adjust_stock_screen.dart';
import '../../features/products/presentation/inventory_screen.dart';
import '../../features/products/presentation/product_detail_screen.dart';
import '../../features/products/presentation/product_form_screen.dart';
import '../../features/products/presentation/receive_stock_screen.dart';
import '../../features/products/presentation/stock_history_screen.dart';
import '../../features/shell/presentation/app_shell.dart';
import '../../features/shell/presentation/not_built_yet_screen.dart';
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
      StatefulShellRoute.indexedStack(
        builder: (_, _, shell) => AppShell(shell: shell),
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
                builder: (_, _) =>
                    const NotBuiltYetScreen(title: 'New sale', sprint: 4),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: Routes.documents,
                builder: (_, _) =>
                    const NotBuiltYetScreen(title: 'Documents', sprint: 4),
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
