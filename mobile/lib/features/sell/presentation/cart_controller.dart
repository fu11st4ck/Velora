import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/auth/session_controller.dart';
import '../../../core/storage/key_value_store.dart';
import '../../customers/data/customer.dart';
import '../../products/data/product.dart';
import '../data/cart.dart';
import '../data/sales_api.dart';

final cartProvider = NotifierProvider<CartController, Cart>(CartController.new);

/// The sale in progress for the signed-in user.
class CartController extends Notifier<Cart> {
  String? _key;

  @override
  Cart build() {
    // One cart per user: signing in as someone else never shows the previous user's sale.
    final userId = ref.watch(currentUserProvider.select((me) => me?.userId));
    _key = userId == null ? null : 'velora.cart.$userId';
    return _key == null
        ? const Cart()
        : Cart.decode(ref.read(keyValueStoreProvider).read(_key!));
  }

  void _set(Cart cart) {
    state = cart;
    final key = _key;
    if (key == null) return;
    final store = ref.read(keyValueStoreProvider);
    unawaited(
      cart.isEmpty && cart.customer == null
          ? store.remove(key)
          : store.write(key, cart.encode()),
    );
  }

  /// Adds a product. The same product at the same price joins its existing line.
  void add(
    Product product, {
    required int quantity,
    required int unitPriceMinor,
    String? belowMinimumReason,
  }) {
    final index = state.lines.indexWhere(
      (l) => l.productId == product.id && l.unitPriceMinor == unitPriceMinor,
    );
    if (index >= 0) {
      final lines = [...state.lines];
      lines[index] = lines[index].copyWith(
        quantity: lines[index].quantity + quantity,
      );
      _set(state.copyWith(lines: lines));
    } else {
      _set(
        state.copyWith(
          lines: [
            ...state.lines,
            CartLine.of(
              product,
              quantity: quantity,
              unitPriceMinor: unitPriceMinor,
              belowMinimumReason: belowMinimumReason,
            ),
          ],
        ),
      );
    }
  }

  void updateLine(
    int index, {
    required int quantity,
    required int unitPriceMinor,
    String? belowMinimumReason,
  }) {
    final lines = [...state.lines];
    lines[index] = lines[index].copyWith(
      quantity: quantity,
      unitPriceMinor: unitPriceMinor,
      belowMinimumReason: () => belowMinimumReason,
    );
    _set(state.copyWith(lines: lines));
  }

  /// Removes a line and returns it, so the removal can be undone.
  CartLine removeLine(int index) {
    final lines = [...state.lines];
    final removed = lines.removeAt(index);
    _set(state.copyWith(lines: lines));
    return removed;
  }

  void insertLine(int index, CartLine line) {
    final lines = [...state.lines]
      ..insert(index.clamp(0, state.lines.length), line);
    _set(state.copyWith(lines: lines));
  }

  void setCustomer(Customer? customer) => _set(
    state.copyWith(
      customer: () => customer == null ? null : CartCustomer.of(customer),
    ),
  );
  void setDiscount(int minor) => _set(state.copyWith(discountMinor: minor));
  void setTaxRate(String? id) => _set(state.copyWith(taxRateId: () => id));
  void setNotes(String? notes) => _set(state.copyWith(notes: () => notes));

  /// Replaces the cart, for example with the contents of a quotation being converted.
  void replace(Cart cart) => _set(cart);

  void clear() => _set(const Cart());
}

/// The server's totals and per-line problems for the current cart. Null while the cart is empty.
/// The server is the authority; the app's own sums are shown only until this arrives.
final cartPreviewProvider = FutureProvider.autoDispose<PricePreview?>((
  ref,
) async {
  final cart = ref.watch(cartProvider);
  if (cart.isEmpty) return null;
  // A discount above the subtotal is rejected outright by the server; the cart shows that itself.
  if (cart.discountMinor > cart.subtotalMinor) return null;
  return ref
      .watch(salesApiProvider)
      .preview(
        lines: cart.lines.map((l) => l.toSaleLine()).toList(),
        discountMinor: cart.discountMinor,
        taxRateId: cart.taxRateId,
      );
});
