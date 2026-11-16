@Tags(['live'])
library;

import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:velora/core/api/auth_interceptor.dart';
import 'package:velora/core/api/failure.dart';
import 'package:velora/core/auth/session.dart';
import 'package:velora/core/auth/token_store.dart';
import 'package:velora/core/api/idempotency.dart';
import 'package:velora/features/auth/data/auth_api.dart';
import 'package:velora/features/products/data/product.dart';
import 'package:velora/features/products/data/products_api.dart';

/// Runs the app's real API client against a running backend seeded with the demo data.
/// Skipped unless VELORA_LIVE_API is set, e.g.
///   VELORA_LIVE_API=http://localhost:3000/api/v1 VELORA_LIVE_PASSWORD=… flutter test test/live
void main() {
  final baseUrl = Platform.environment['VELORA_LIVE_API'];
  final password = Platform.environment['VELORA_LIVE_PASSWORD'] ?? '';
  final skip = baseUrl == null ? 'VELORA_LIVE_API not set' : null;

  late InMemoryTokenStore store;
  late AuthApi api;
  late ProductsApi products;
  var sessionEnded = 0;

  setUp(() {
    sessionEnded = 0;
    store = InMemoryTokenStore();
    final options = BaseOptions(
      baseUrl: baseUrl ?? 'http://unused',
      contentType: Headers.jsonContentType,
    );
    final dio = Dio(options)
      ..interceptors.add(
        AuthInterceptor(
          tokenStore: store,
          refreshDio: Dio(options),
          retryDio: Dio(options),
          onSessionEnded: () => sessionEnded++,
        ),
      );
    api = AuthApi(dio);
    products = ProductsApi(dio);
  });

  test('sign in as sales, load profile, sign out', () async {
    final tokens = await api.login(
      email: 'ahmed@velora.example',
      password: password,
      deviceName: 'contract-test',
    );
    await store.write(tokens);
    final me = await api.me();
    expect(me.role, Role.sales);
    expect(me.organizationName, 'Velora Fine Jewellery LLC');
    expect(me.settings.currencyCode, 'AED');
    expect(
      me.settings.maxMarkupBp,
      isNull,
      reason: 'pricing policy is not sent to the sales role',
    );
    expect(me.settings.defaultTaxRate?.rateBp, 500);
    expect(me.can('product.read_cost'), isFalse);

    await api.logout(tokens.refreshToken);
    await expectLater(
      Dio(BaseOptions(baseUrl: baseUrl!)).post<dynamic>(
        '/auth/refresh',
        data: {'refreshToken': tokens.refreshToken},
      ),
      throwsA(
        isA<DioException>().having(
          (e) => Failure.from(e),
          'failure',
          isA<UnauthorizedFailure>().having(
            (f) => f.code,
            'code',
            'SESSION_REVOKED',
          ),
        ),
      ),
    );
  }, skip: skip);

  test('manager profile includes the markup ceiling', () async {
    await store.write(
      await api.login(email: 'manager@velora.example', password: password),
    );
    final me = await api.me();
    expect(me.role, Role.manager);
    expect(me.settings.maxMarkupBp, 6000);
    expect(me.can('product.manage'), isTrue);
  }, skip: skip);

  test('a wrong password maps to INVALID_CREDENTIALS', () async {
    await expectLater(
      api.login(email: 'ahmed@velora.example', password: 'definitely-wrong'),
      throwsA(
        isA<UnauthorizedFailure>().having(
          (f) => f.code,
          'code',
          'INVALID_CREDENTIALS',
        ),
      ),
    );
  }, skip: skip);

  test(
    'an unusable access token ends the session instead of looping',
    () async {
      final tokens = await api.login(
        email: 'manager@velora.example',
        password: password,
      );
      // An unusable access token with a valid refresh token: the server answers TOKEN_INVALID,
      // which must end the session rather than loop.
      await store.write(
        StoredTokens(
          accessToken: 'not.a.token',
          refreshToken: tokens.refreshToken,
        ),
      );
      await expectLater(api.me(), throwsA(isA<UnauthorizedFailure>()));
      expect(store.tokens, isNull);
      expect(sessionEnded, 1);
    },
    skip: skip,
  );

  test(
    'sales lists the seeded catalogue with selling prices and no cost',
    () async {
      await store.write(
        await api.login(email: 'ahmed@velora.example', password: password),
      );
      final page = await products.list(q: 'VLR-BR-001');
      final bracelet = page.items.single;
      expect(bracelet.name, 'Alhambra Gold Bracelet');
      expect(bracelet.listPriceMinor, 364000);
      expect(bracelet.floorPriceMinor, 322000);
      expect(bracelet.costMinor, isNull);
      expect(bracelet.defaultMarkupBp, isNull);
      expect(page.counts, isNotNull);
      final moves = await products.movements(productId: bracelet.id);
      expect(moves.items, isNotEmpty);
      expect(
        moves.items.every(
          (m) => m.unitCostMinor == null && m.supplierName == null,
        ),
        isTrue,
      );
      await expectLater(
        products.adjust(
          productId: bracelet.id,
          quantityDelta: -1,
          reason: 'not allowed',
          idempotencyKey: newIdempotencyKey(),
        ),
        throwsA(isA<ForbiddenFailure>()),
      );
    },
    skip: skip,
  );

  test(
    'manager creates, receives, adjusts, edits and archives a product',
    () async {
      await store.write(
        await api.login(email: 'manager@velora.example', password: password),
      );
      final sku = 'LIVE-${DateTime.now().millisecondsSinceEpoch}';
      final key = newIdempotencyKey();
      const input = NewProduct(
        name: 'Contract Test Ring',
        costMinor: 100055,
        defaultMarkupBp: 3000,
        minMarkupBp: 1500,
        openingQuantity: 2,
        weight: Weight(value: '3.5', unit: WeightUnit.g),
      );
      final draft = NewProduct(
        name: input.name,
        sku: sku,
        costMinor: input.costMinor,
        defaultMarkupBp: input.defaultMarkupBp,
        minMarkupBp: input.minMarkupBp,
        openingQuantity: input.openingQuantity,
        weight: input.weight,
      );
      final created = await products.create(draft, idempotencyKey: key);
      final replayed = await products.create(draft, idempotencyKey: key);
      expect(replayed.id, created.id, reason: 'same key creates nothing new');
      expect(created.listPriceMinor, 130072);
      expect(created.weight?.display, '3.5 g');

      await expectLater(
        products.create(draft, idempotencyKey: newIdempotencyKey()),
        throwsA(
          isA<BusinessFailure>().having((f) => f.code, 'code', 'SKU_TAKEN'),
        ),
      );

      final received = await products.receive(
        productId: created.id,
        quantity: 2,
        unitCostMinor: 110055,
        idempotencyKey: newIdempotencyKey(),
      );
      expect(received.quantity, 4);
      expect(received.costMinor, 105055);

      await expectLater(
        products.adjust(
          productId: created.id,
          quantityDelta: -5,
          reason: 'too many',
          idempotencyKey: newIdempotencyKey(),
        ),
        throwsA(
          isA<BusinessFailure>()
              .having((f) => f.code, 'code', 'INSUFFICIENT_STOCK')
              .having((f) => f.details.single['available'], 'available', 4),
        ),
      );
      final emptied = await products.adjust(
        productId: created.id,
        quantityDelta: -4,
        reason: 'Contract test clean-up',
        idempotencyKey: newIdempotencyKey(),
      );
      expect(emptied.quantity, 0);
      expect(emptied.stockStatus, StockStatus.out);

      final edited = await products.update(
        created.id,
        version: emptied.version,
        changes: {'name': 'Contract Test Ring (edited)'},
      );
      expect(edited.version, emptied.version + 1);
      await expectLater(
        products.update(
          created.id,
          version: emptied.version,
          changes: {'name': 'stale'},
        ),
        throwsA(
          isA<BusinessFailure>().having(
            (f) => f.code,
            'code',
            'VERSION_CONFLICT',
          ),
        ),
      );

      final history = await products.movements(productId: created.id);
      expect(history.items.map((m) => m.type), [
        MovementType.adjustmentOut,
        MovementType.purchaseReceipt,
        MovementType.purchaseReceipt,
      ]);
      expect(history.items.first.balanceAfter, 0);

      await products.archive(created.id);
      expect((await products.list(q: sku)).items, isEmpty);
      expect((await products.get(created.id)).isArchived, isTrue);
    },
    skip: skip,
  );
}
