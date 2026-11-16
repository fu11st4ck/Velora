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
import 'package:velora/features/customers/data/customer.dart';
import 'package:velora/features/customers/data/customers_api.dart';
import 'package:velora/features/documents/data/document.dart';
import 'package:velora/features/documents/data/documents_api.dart';
import 'package:velora/features/products/data/product.dart';
import 'package:velora/features/products/data/products_api.dart';
import 'package:velora/features/sell/data/sales_api.dart';

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
  late CustomersApi customers;
  late SalesApi sales;
  late DocumentsApi documents;
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
    customers = CustomersApi(dio);
    sales = SalesApi(dio);
    documents = DocumentsApi(dio);
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

  test('customers: create, find by mobile, search, edit, detail and archive', () async {
    await store.write(
      await api.login(email: 'ahmed@velora.example', password: password),
    );
    // A unique UAE mobile number per run: 050 + seven digits.
    final local =
        '050${(DateTime.now().millisecondsSinceEpoch % 10000000).toString().padLeft(7, '0')}';
    final e164 = '+971${local.substring(1)}';
    final key = newIdempotencyKey();
    final input = CustomerInput(
      name: 'Contract Customer',
      company: 'Contract Co',
      mobile: local,
      email: 'contract@example.com',
    );
    final created = await customers.create(input, idempotencyKey: key);
    expect(
      (await customers.create(input, idempotencyKey: key)).id,
      created.id,
      reason: 'same key creates nothing new',
    );
    expect(created.mobile, e164, reason: 'stored in international format');

    expect((await customers.findByMobile(local)).map((c) => c.id), [
      created.id,
    ]);
    expect(
      (await customers.list(q: local.substring(3))).items.map((c) => c.id),
      contains(created.id),
    );

    await expectLater(
      customers.create(
        const CustomerInput(name: 'Bad Phone', mobile: '12345'),
        idempotencyKey: newIdempotencyKey(),
      ),
      throwsA(
        isA<ValidationFailure>().having((f) => f.fields, 'fields', {
          'mobile': 'phone',
        }),
      ),
    );
    await expectLater(
      customers.create(
        const CustomerInput(mobile: '+971501234567'),
        idempotencyKey: newIdempotencyKey(),
      ),
      throwsA(
        isA<ValidationFailure>().having((f) => f.fields, 'fields', {
          'name': 'nameOrCompanyRequired',
        }),
      ),
    );

    final edited = await customers.update(
      created.id,
      CustomerInput(
        name: 'Contract Customer',
        company: 'Contract Co',
        mobile: e164,
        address: 'Dubai',
      ),
    );
    expect(edited.email, isNull, reason: 'a field sent as null is cleared');
    expect(edited.address, 'Dubai');

    final detail = await customers.get(created.id);
    expect(detail.summary?.invoiceCount, 0);
    expect(detail.summary?.outstandingMinor, 0);

    await expectLater(
      customers.archive(created.id),
      throwsA(isA<ForbiddenFailure>()),
      reason: 'sales cannot archive',
    );
    await store.write(
      await api.login(email: 'manager@velora.example', password: password),
    );
    await customers.archive(created.id);
    expect(await customers.findByMobile(local), isEmpty);
    expect((await customers.get(created.id)).isArchived, isTrue);
  }, skip: skip);

  test(
    'sales: preview, quotation, invoice, payment, PDF, return and cancel',
    () async {
      Future<void> signIn(String who) async => store.write(
        await api.login(email: '$who@velora.example', password: password),
      );
      final stamp = DateTime.now().millisecondsSinceEpoch;

      // A product of its own, so stock assertions do not depend on other runs.
      await signIn('manager');
      final product = await products.create(
        NewProduct(
          name: 'Contract Sale Ring',
          sku: 'SALE-$stamp',
          costMinor: 100000,
          defaultMarkupBp: 3000,
          minMarkupBp: 1500,
          openingQuantity: 5,
        ),
        idempotencyKey: newIdempotencyKey(),
      );
      expect(product.listPriceMinor, 130000);
      expect(product.floorPriceMinor, 115000);

      await signIn('ahmed');
      final customer = await customers.create(
        CustomerInput(
          name: 'Sale Customer',
          mobile: '052${(stamp % 10000000).toString().padLeft(7, '0')}',
        ),
        idempotencyKey: newIdempotencyKey(),
      );
      expect(await sales.taxRates(), isNotEmpty);

      SaleLine line(int quantity, [int price = 130000]) => SaleLine(
        productId: product.id,
        quantity: quantity,
        unitPriceMinor: price,
      );
      final preview = await sales.preview(
        lines: [line(2)],
        discountMinor: 10000,
      );
      expect(preview.valid, isTrue);
      expect(preview.subtotalMinor, 260000);
      // Tax on the discounted total, half-up, in integer minor units.
      final tax = (250000 * preview.tax.rateBp + 5000) ~/ 10000;
      expect(preview.tax.amountMinor, tax);
      expect(preview.totalMinor, 250000 + tax);

      final tooLow = await sales.preview(
        lines: [line(1, 100000)],
        discountMinor: 0,
      );
      expect(tooLow.valid, isFalse);
      expect(tooLow.issues.single.single.code, 'PRICE_BELOW_MINIMUM');
      expect(tooLow.issues.single.single.floorPriceMinor, 115000);
      final tooMany = await sales.preview(lines: [line(6)], discountMinor: 0);
      expect(tooMany.issues.single.single.code, 'INSUFFICIENT_STOCK');
      expect(tooMany.issues.single.single.available, 5);

      final quotation = await sales.createQuotation(
        customerId: customer.id,
        lines: [line(2)],
        discountMinor: 10000,
        idempotencyKey: newIdempotencyKey(),
      );
      expect(quotation.status, QuotationStatus.open);
      expect(quotation.totalMinor, preview.totalMinor);
      expect((await products.get(product.id)).quantity, 5, reason: 'no stock');

      final key = newIdempotencyKey();
      Future<Invoice> create() => sales.createInvoice(
        customerId: customer.id,
        quotationId: quotation.id,
        lines: [line(2)],
        discountMinor: 10000,
        receivedMinor: 100000,
        method: PaymentMethod.cash,
        creditDays: 14,
        idempotencyKey: key,
      );
      final invoice = await create();
      expect((await create()).id, invoice.id, reason: 'same key, one invoice');
      expect(invoice.totalMinor, preview.totalMinor);
      expect(invoice.paymentStatus, PaymentStatus.partial);
      expect(invoice.balanceMinor, preview.totalMinor - 100000);
      expect(invoice.quotationNumber, quotation.number);
      expect(invoice.profit, isNull, reason: 'sales never receive profit');
      expect(invoice.lines.single.unitCostMinor, isNull);
      expect((await products.get(product.id)).quantity, 3);
      expect(
        (await documents.quotation(quotation.id)).status,
        QuotationStatus.converted,
      );

      await expectLater(
        documents.recordPayment(
          invoice.id,
          amountMinor: invoice.balanceMinor + 1,
          method: PaymentMethod.cash,
          idempotencyKey: newIdempotencyKey(),
        ),
        throwsA(isA<Failure>()),
        reason: 'cannot pay more than the balance',
      );
      final paid = await documents.recordPayment(
        invoice.id,
        amountMinor: invoice.balanceMinor,
        method: PaymentMethod.bankTransfer,
        reference: 'LIVE-$stamp',
        idempotencyKey: newIdempotencyKey(),
      );
      expect(paid.paymentStatus, PaymentStatus.paid);
      expect(paid.payments, hasLength(2));

      final listed = await documents.list(q: invoice.number);
      expect(listed.items.single.id, invoice.id);
      expect(listed.items.single.paymentStatus, PaymentStatus.paid);
      final pdf = await documents.pdf(isInvoice: true, id: invoice.id);
      expect(String.fromCharCodes(pdf.take(5)), '%PDF-');

      await expectLater(
        documents.cancelInvoice(
          invoice.id,
          reason: 'not allowed',
          refundMethod: PaymentMethod.cash,
          idempotencyKey: newIdempotencyKey(),
        ),
        throwsA(isA<ForbiddenFailure>()),
        reason: 'sales cannot cancel',
      );

      // A second, unpaid invoice for the manager to cancel.
      final credit = await sales.createInvoice(
        customerId: customer.id,
        lines: [line(1)],
        discountMinor: 0,
        creditDays: 30,
        idempotencyKey: newIdempotencyKey(),
      );
      expect(credit.paymentStatus, PaymentStatus.unpaid);
      expect(credit.payments, isEmpty);

      await signIn('manager');
      final seen = await documents.invoice(invoice.id);
      expect(seen.profit, isNotNull, reason: 'managers receive profit');
      expect(seen.lines.single.unitCostMinor, 100000);

      final returned = await documents.createReturn(
        invoice.id,
        reason: 'Contract test return',
        lines: [(lineNo: seen.lines.single.lineNo, quantity: 1, restock: true)],
        refundMethod: PaymentMethod.cash,
        idempotencyKey: newIdempotencyKey(),
      );
      expect(returned.returns.single.units, 1);
      expect(returned.returnedMinor, returned.returns.single.totalMinor);
      expect(returned.returns.single.refundMinor, returned.returnedMinor);
      expect(returned.lines.single.returnedQuantity, 1);
      expect(returned.balanceMinor, 0);
      expect((await products.get(product.id)).quantity, 3, reason: '5−2−1+1');

      final cancelled = await documents.cancelInvoice(
        credit.id,
        reason: 'Contract test cancel',
        idempotencyKey: newIdempotencyKey(),
      );
      expect(cancelled.cancelled, isTrue);
      expect(cancelled.cancelReason, 'Contract test cancel');
      expect((await products.get(product.id)).quantity, 4);
    },
    skip: skip,
  );
}
