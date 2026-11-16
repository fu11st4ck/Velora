import 'package:flutter/foundation.dart';

import '../../../app/theme/tokens.dart';

enum PaymentMethod {
  cash('CASH', 'Cash'),
  bankTransfer('BANK_TRANSFER', 'Bank transfer');

  const PaymentMethod(this.wire, this.label);
  final String wire;
  final String label;

  static PaymentMethod parse(String value) =>
      values.firstWhere((m) => m.wire == value);
}

enum PaymentStatus {
  unpaid,
  partial,
  paid;

  static PaymentStatus parse(String value) => switch (value) {
    'UNPAID' => PaymentStatus.unpaid,
    'PARTIAL' => PaymentStatus.partial,
    'PAID' => PaymentStatus.paid,
    _ => throw FormatException('Unknown payment status "$value"'),
  };
}

enum QuotationStatus {
  open('Open', StatusTone.neutral),
  converted('Converted', StatusTone.success),
  expired('Expired', StatusTone.warning),
  cancelled('Cancelled', StatusTone.danger);

  const QuotationStatus(this.label, this.tone);
  final String label;
  final StatusTone tone;

  static QuotationStatus parse(String value) =>
      values.firstWhere((s) => s.name.toUpperCase() == value);
}

/// What the status pill of an invoice says. Derived from the server's fields, in priority order.
({String label, StatusTone tone}) invoiceStatusOf({
  required bool cancelled,
  required bool overdue,
  required PaymentStatus paymentStatus,
}) {
  if (cancelled) return (label: 'Cancelled', tone: StatusTone.danger);
  if (overdue) return (label: 'Overdue', tone: StatusTone.danger);
  return switch (paymentStatus) {
    PaymentStatus.paid => (label: 'Paid', tone: StatusTone.success),
    PaymentStatus.partial => (
      label: 'Partially paid',
      tone: StatusTone.warning,
    ),
    PaymentStatus.unpaid => (label: 'Unpaid', tone: StatusTone.warning),
  };
}

@immutable
class DocumentParty {
  const DocumentParty({
    required this.id,
    this.name,
    this.company,
    this.mobile,
    this.email,
    this.address,
    this.taxRegistrationNumber,
  });

  factory DocumentParty.fromJson(Map<String, dynamic> json) => DocumentParty(
    id: json['id'] as String,
    name: json['name'] as String?,
    company: json['company'] as String?,
    mobile: json['mobile'] as String?,
    email: json['email'] as String?,
    address: json['address'] as String?,
    taxRegistrationNumber: json['taxRegistrationNumber'] as String?,
  );

  final String id;
  final String? name;
  final String? company;
  final String? mobile;
  final String? email;
  final String? address;
  final String? taxRegistrationNumber;

  /// Documents are addressed to the company when there is one.
  String get displayName => company ?? name ?? '';
  String? get secondaryName => company != null ? name : null;
}

/// One row of the combined documents list.
@immutable
class DocumentSummary {
  const DocumentSummary({
    required this.isInvoice,
    required this.id,
    required this.number,
    required this.issuedAt,
    required this.customer,
    required this.salespersonName,
    required this.totalMinor,
    this.cancelled = false,
    this.paymentStatus,
    this.isOverdue = false,
    this.balanceMinor = 0,
    this.dueDate,
    this.quotationStatus,
    this.validUntil,
  });

  factory DocumentSummary.fromJson(Map<String, dynamic> json) {
    final isInvoice = json['type'] == 'INVOICE';
    return DocumentSummary(
      isInvoice: isInvoice,
      id: json['id'] as String,
      number: json['number'] as String,
      issuedAt: DateTime.parse(json['issuedAt'] as String),
      customer: DocumentParty.fromJson(
        json['customer'] as Map<String, dynamic>,
      ),
      salespersonName:
          (json['salesperson'] as Map<String, dynamic>)['fullName'] as String,
      totalMinor: json['totalMinor'] as int,
      cancelled: json['status'] == 'CANCELLED',
      paymentStatus: isInvoice
          ? PaymentStatus.parse(json['paymentStatus'] as String)
          : null,
      isOverdue: json['isOverdue'] as bool? ?? false,
      balanceMinor: json['balanceMinor'] as int? ?? 0,
      dueDate: json['dueDate'] as String?,
      quotationStatus: isInvoice
          ? null
          : QuotationStatus.parse(json['quotationStatus'] as String),
      validUntil: json['validUntil'] as String?,
    );
  }

  final bool isInvoice;
  final String id;
  final String number;
  final DateTime issuedAt;
  final DocumentParty customer;
  final String salespersonName;
  final int totalMinor;
  final bool cancelled;
  final PaymentStatus? paymentStatus;
  final bool isOverdue;
  final int balanceMinor;

  /// `YYYY-MM-DD` in the business's timezone.
  final String? dueDate;
  final QuotationStatus? quotationStatus;
  final String? validUntil;

  ({String label, StatusTone tone}) get status => isInvoice
      ? invoiceStatusOf(
          cancelled: cancelled,
          overdue: isOverdue,
          paymentStatus: paymentStatus!,
        )
      : (
          label: quotationStatus == QuotationStatus.open
              ? 'Quotation'
              : 'Quotation · ${quotationStatus!.label.toLowerCase()}',
          tone: quotationStatus!.tone,
        );
}

@immutable
class DocumentLine {
  const DocumentLine({
    required this.lineNo,
    required this.productId,
    required this.name,
    required this.sku,
    required this.quantity,
    required this.unitPriceMinor,
    required this.lineTotalMinor,
    this.returnedQuantity = 0,
    this.unitCostMinor,
    this.markupBp,
  });

  factory DocumentLine.fromJson(Map<String, dynamic> json) => DocumentLine(
    lineNo: json['lineNo'] as int,
    productId: json['productId'] as String,
    name: json['name'] as String,
    sku: json['sku'] as String,
    quantity: json['quantity'] as int,
    returnedQuantity: json['returnedQuantity'] as int? ?? 0,
    unitPriceMinor: json['unitPriceMinor'] as int,
    lineTotalMinor: json['lineTotalMinor'] as int,
    unitCostMinor: json['unitCostMinor'] as int?,
    markupBp: json['markupBp'] as int?,
  );

  final int lineNo;
  final String productId;
  final String name;
  final String sku;
  final int quantity;
  final int returnedQuantity;
  final int unitPriceMinor;
  final int lineTotalMinor;

  /// Manager-only; absent for the sales role.
  final int? unitCostMinor;
  final int? markupBp;

  int get returnable => quantity - returnedQuantity;
}

@immutable
class TaxLine {
  const TaxLine({
    required this.name,
    required this.rateBp,
    required this.amountMinor,
    this.id,
  });

  factory TaxLine.fromJson(Map<String, dynamic> json) => TaxLine(
    id: json['id'] as String?,
    name: json['name'] as String,
    rateBp: json['rateBp'] as int,
    amountMinor: json['amountMinor'] as int,
  );

  final String? id;
  final String name;
  final int rateBp;
  final int amountMinor;
}

@immutable
class Payment {
  const Payment({
    required this.id,
    required this.isRefund,
    required this.method,
    required this.amountMinor,
    required this.receivedAt,
    required this.recordedByName,
    this.reference,
    this.note,
  });

  factory Payment.fromJson(Map<String, dynamic> json) => Payment(
    id: json['id'] as String,
    isRefund: json['kind'] == 'REFUND',
    method: PaymentMethod.parse(json['method'] as String),
    amountMinor: json['amountMinor'] as int,
    reference: json['reference'] as String?,
    note: json['note'] as String?,
    receivedAt: DateTime.parse(json['receivedAt'] as String),
    recordedByName:
        (json['recordedBy'] as Map<String, dynamic>)['fullName'] as String,
  );

  final String id;
  final bool isRefund;
  final PaymentMethod method;
  final int amountMinor;
  final String? reference;
  final String? note;
  final DateTime receivedAt;
  final String recordedByName;
}

@immutable
class SalesReturn {
  const SalesReturn({
    required this.id,
    required this.number,
    required this.reason,
    required this.totalMinor,
    required this.refundMinor,
    required this.createdAt,
    required this.units,
  });

  factory SalesReturn.fromJson(Map<String, dynamic> json) => SalesReturn(
    id: json['id'] as String,
    number: json['number'] as String,
    reason: json['reason'] as String,
    totalMinor: json['totalMinor'] as int,
    refundMinor: json['refundMinor'] as int,
    createdAt: DateTime.parse(json['createdAt'] as String),
    units: (json['lines'] as List<dynamic>).fold(
      0,
      (sum, l) => sum + ((l as Map<String, dynamic>)['quantity'] as int),
    ),
  );

  final String id;
  final String number;
  final String reason;
  final int totalMinor;
  final int refundMinor;
  final DateTime createdAt;
  final int units;
}

@immutable
class Profit {
  const Profit({
    required this.costMinor,
    required this.grossProfitMinor,
    this.marginBp,
  });

  factory Profit.fromJson(Map<String, dynamic> json) => Profit(
    costMinor: json['costMinor'] as int,
    grossProfitMinor: json['grossProfitMinor'] as int,
    marginBp: json['marginBp'] as int?,
  );

  final int costMinor;
  final int grossProfitMinor;
  final int? marginBp;
}

@immutable
class Invoice {
  const Invoice({
    required this.id,
    required this.number,
    required this.cancelled,
    required this.issuedAt,
    required this.customer,
    required this.salespersonName,
    required this.lines,
    required this.subtotalMinor,
    required this.discountMinor,
    required this.tax,
    required this.totalMinor,
    required this.returnedMinor,
    required this.paidMinor,
    required this.balanceMinor,
    required this.paymentStatus,
    required this.isOverdue,
    required this.payments,
    required this.returns,
    this.dueDate,
    this.notes,
    this.quotationNumber,
    this.cancelReason,
    this.profit,
  });

  factory Invoice.fromJson(Map<String, dynamic> json) => Invoice(
    id: json['id'] as String,
    number: json['number'] as String,
    cancelled: json['status'] == 'CANCELLED',
    issuedAt: DateTime.parse(json['issuedAt'] as String),
    customer: DocumentParty.fromJson(json['customer'] as Map<String, dynamic>),
    salespersonName:
        (json['salesperson'] as Map<String, dynamic>)['fullName'] as String,
    lines: (json['lines'] as List<dynamic>)
        .map((l) => DocumentLine.fromJson(l as Map<String, dynamic>))
        .toList(),
    subtotalMinor: json['subtotalMinor'] as int,
    discountMinor: json['discountMinor'] as int,
    tax: TaxLine.fromJson(json['tax'] as Map<String, dynamic>),
    totalMinor: json['totalMinor'] as int,
    returnedMinor: json['returnedMinor'] as int,
    paidMinor: json['paidMinor'] as int,
    balanceMinor: json['balanceMinor'] as int,
    paymentStatus: PaymentStatus.parse(json['paymentStatus'] as String),
    isOverdue: json['isOverdue'] as bool,
    dueDate: json['dueDate'] as String?,
    notes: json['notes'] as String?,
    payments: (json['payments'] as List<dynamic>)
        .map((p) => Payment.fromJson(p as Map<String, dynamic>))
        .toList(),
    returns: (json['returns'] as List<dynamic>)
        .map((r) => SalesReturn.fromJson(r as Map<String, dynamic>))
        .toList(),
    quotationNumber:
        (json['quotation'] as Map<String, dynamic>?)?['number'] as String?,
    cancelReason:
        (json['cancellation'] as Map<String, dynamic>?)?['reason'] as String?,
    profit: json['profit'] == null
        ? null
        : Profit.fromJson(json['profit'] as Map<String, dynamic>),
  );

  final String id;
  final String number;
  final bool cancelled;
  final DateTime issuedAt;
  final DocumentParty customer;
  final String salespersonName;
  final List<DocumentLine> lines;
  final int subtotalMinor;
  final int discountMinor;
  final TaxLine tax;
  final int totalMinor;
  final int returnedMinor;
  final int paidMinor;
  final int balanceMinor;
  final PaymentStatus paymentStatus;
  final bool isOverdue;
  final String? dueDate;
  final String? notes;
  final List<Payment> payments;
  final List<SalesReturn> returns;
  final String? quotationNumber;
  final String? cancelReason;

  /// Manager-only; absent for the sales role.
  final Profit? profit;

  ({String label, StatusTone tone}) get status => invoiceStatusOf(
    cancelled: cancelled,
    overdue: isOverdue,
    paymentStatus: paymentStatus,
  );
  bool get canTakePayment => !cancelled && balanceMinor > 0;
  bool get hasReturnableItems =>
      !cancelled && lines.any((l) => l.returnable > 0);
}

@immutable
class Quotation {
  const Quotation({
    required this.id,
    required this.number,
    required this.status,
    required this.issuedAt,
    required this.customer,
    required this.salespersonName,
    required this.lines,
    required this.subtotalMinor,
    required this.discountMinor,
    required this.tax,
    required this.totalMinor,
    this.validUntil,
    this.notes,
    this.invoiceId,
    this.invoiceNumber,
  });

  factory Quotation.fromJson(Map<String, dynamic> json) {
    final invoice = json['invoice'] as Map<String, dynamic>?;
    return Quotation(
      id: json['id'] as String,
      number: json['number'] as String,
      status: QuotationStatus.parse(json['status'] as String),
      issuedAt: DateTime.parse(json['issuedAt'] as String),
      validUntil: json['validUntil'] as String?,
      customer: DocumentParty.fromJson(
        json['customer'] as Map<String, dynamic>,
      ),
      salespersonName:
          (json['salesperson'] as Map<String, dynamic>)['fullName'] as String,
      lines: (json['lines'] as List<dynamic>)
          .map((l) => DocumentLine.fromJson(l as Map<String, dynamic>))
          .toList(),
      subtotalMinor: json['subtotalMinor'] as int,
      discountMinor: json['discountMinor'] as int,
      tax: TaxLine.fromJson(json['tax'] as Map<String, dynamic>),
      totalMinor: json['totalMinor'] as int,
      notes: json['notes'] as String?,
      invoiceId: invoice?['id'] as String?,
      invoiceNumber: invoice?['number'] as String?,
    );
  }

  final String id;
  final String number;
  final QuotationStatus status;
  final DateTime issuedAt;
  final String? validUntil;
  final DocumentParty customer;
  final String salespersonName;
  final List<DocumentLine> lines;
  final int subtotalMinor;
  final int discountMinor;
  final TaxLine tax;
  final int totalMinor;
  final String? notes;
  final String? invoiceId;
  final String? invoiceNumber;
}

/// Filters of the documents list, as chips.
enum DocumentFilter {
  all('All', null, null),
  unpaid('Unpaid', 'unpaid,partial', 'invoice'),
  overdue('Overdue', 'overdue', 'invoice'),
  paid('Paid', 'paid', 'invoice'),
  quotations('Quotations', null, 'quotation'),
  cancelled('Cancelled', 'cancelled', 'invoice');

  const DocumentFilter(this.label, this.status, this.type);
  final String label;
  final String? status;
  final String? type;
}
