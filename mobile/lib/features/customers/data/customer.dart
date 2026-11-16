import 'package:flutter/foundation.dart';

@immutable
class Customer {
  const Customer({
    required this.id,
    this.name,
    this.company,
    this.mobile,
    this.email,
    this.address,
    this.taxRegistrationNumber,
    this.notes,
    this.archivedAt,
    this.summary,
  });

  factory Customer.fromJson(Map<String, dynamic> json) => Customer(
    id: json['id'] as String,
    name: json['name'] as String?,
    company: json['company'] as String?,
    mobile: json['mobile'] as String?,
    email: json['email'] as String?,
    address: json['address'] as String?,
    taxRegistrationNumber: json['taxRegistrationNumber'] as String?,
    notes: json['notes'] as String?,
    archivedAt: json['archivedAt'] == null
        ? null
        : DateTime.parse(json['archivedAt'] as String),
    summary: json['summary'] == null
        ? null
        : CustomerSummary.fromJson(json['summary'] as Map<String, dynamic>),
  );

  final String id;
  final String? name;
  final String? company;

  /// E.164, e.g. `+971558204412`.
  final String? mobile;
  final String? email;
  final String? address;
  final String? taxRegistrationNumber;
  final String? notes;
  final DateTime? archivedAt;

  /// Present on the detail response only.
  final CustomerSummary? summary;

  bool get isArchived => archivedAt != null;

  /// The line shown first everywhere: the person, else the company. The server guarantees one exists.
  String get displayName => name ?? company ?? '';

  /// The company, when it is not already the display name.
  String? get secondaryName => name != null ? company : null;
}

@immutable
class CustomerSummary {
  const CustomerSummary({
    required this.invoicedMinor,
    required this.outstandingMinor,
    required this.overdueMinor,
    required this.invoiceCount,
    this.lastInvoiceAt,
  });

  factory CustomerSummary.fromJson(Map<String, dynamic> json) =>
      CustomerSummary(
        invoicedMinor: json['invoicedMinor'] as int,
        outstandingMinor: json['outstandingMinor'] as int,
        overdueMinor: json['overdueMinor'] as int,
        invoiceCount: json['invoiceCount'] as int,
        lastInvoiceAt: json['lastInvoiceAt'] == null
            ? null
            : DateTime.parse(json['lastInvoiceAt'] as String),
      );

  final int invoicedMinor;
  final int outstandingMinor;
  final int overdueMinor;
  final int invoiceCount;
  final DateTime? lastInvoiceAt;
}

/// Editable customer fields. A null value clears the field on the server.
@immutable
class CustomerInput {
  const CustomerInput({
    this.name,
    this.company,
    this.mobile,
    this.email,
    this.address,
    this.taxRegistrationNumber,
    this.notes,
  });

  final String? name;
  final String? company;
  final String? mobile;
  final String? email;
  final String? address;
  final String? taxRegistrationNumber;
  final String? notes;

  Map<String, dynamic> toJson() => {
    'name': name,
    'company': company,
    'mobile': mobile,
    'email': email,
    'address': address,
    'taxRegistrationNumber': taxRegistrationNumber,
    'notes': notes,
  };
}

@immutable
class CustomerPage {
  const CustomerPage({required this.items, required this.nextCursor});
  final List<Customer> items;
  final String? nextCursor;
}
