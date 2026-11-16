import 'package:flutter/foundation.dart';

import '../../../core/auth/session.dart';

/// The business profile and settings (`GET /organization`). The markup policy is null for the
/// sales role: the server does not send it.
@immutable
class Organization {
  const Organization({
    required this.name,
    required this.currencyCode,
    required this.timezone,
    required this.lowStockThreshold,
    required this.defaultCreditDays,
    required this.quotationValidityDays,
    this.legalName,
    this.taxRegistrationNumber,
    this.phone,
    this.email,
    this.addressLine,
    this.city,
    this.countryCode,
    this.invoiceFooter,
    this.maxMarkupBp,
    this.defaultMarkupBp,
    this.defaultMinMarkupBp,
    this.regionalSettingsLocked = true,
  });

  factory Organization.fromJson(Map<String, dynamic> json) => Organization(
    name: json['name'] as String,
    legalName: json['legalName'] as String?,
    taxRegistrationNumber: json['taxRegistrationNumber'] as String?,
    phone: json['phone'] as String?,
    email: json['email'] as String?,
    addressLine: json['addressLine'] as String?,
    city: json['city'] as String?,
    countryCode: json['countryCode'] as String?,
    invoiceFooter: json['invoiceFooter'] as String?,
    currencyCode: json['currencyCode'] as String,
    timezone: json['timezone'] as String,
    lowStockThreshold: json['lowStockThreshold'] as int,
    defaultCreditDays: json['defaultCreditDays'] as int,
    quotationValidityDays: json['quotationValidityDays'] as int,
    maxMarkupBp: json['maxMarkupBp'] as int?,
    defaultMarkupBp: json['defaultMarkupBp'] as int?,
    defaultMinMarkupBp: json['defaultMinMarkupBp'] as int?,
    regionalSettingsLocked: json['regionalSettingsLocked'] as bool? ?? true,
  );

  final String name;
  final String? legalName;
  final String? taxRegistrationNumber;
  final String? phone;
  final String? email;
  final String? addressLine;
  final String? city;
  final String? countryCode;
  final String? invoiceFooter;
  final String currencyCode;
  final String timezone;
  final int lowStockThreshold;
  final int defaultCreditDays;
  final int quotationValidityDays;
  final int? maxMarkupBp;
  final int? defaultMarkupBp;
  final int? defaultMinMarkupBp;

  /// Currency and time zone can no longer change once a quotation or invoice exists.
  final bool regionalSettingsLocked;
}

@immutable
class ManagedTaxRate {
  const ManagedTaxRate({
    required this.id,
    required this.name,
    required this.rateBp,
    required this.isDefault,
    required this.isActive,
  });

  factory ManagedTaxRate.fromJson(Map<String, dynamic> json) => ManagedTaxRate(
    id: json['id'] as String,
    name: json['name'] as String,
    rateBp: json['rateBp'] as int,
    isDefault: json['isDefault'] as bool,
    isActive: json['isActive'] as bool,
  );

  final String id;
  final String name;
  final int rateBp;
  final bool isDefault;
  final bool isActive;
}

@immutable
class TeamMember {
  const TeamMember({
    required this.memberId,
    required this.fullName,
    required this.email,
    required this.role,
    required this.isActive,
    required this.isPending,
    this.lastLoginAt,
  });

  factory TeamMember.fromJson(Map<String, dynamic> json) => TeamMember(
    memberId: json['memberId'] as String,
    fullName: json['fullName'] as String,
    email: json['email'] as String,
    role: Role.parse(json['role'] as String),
    isActive: json['isActive'] as bool,
    isPending: json['isPending'] as bool,
    lastLoginAt: json['lastLoginAt'] == null
        ? null
        : DateTime.parse(json['lastLoginAt'] as String),
  );

  final String memberId;
  final String fullName;
  final String email;
  final Role role;
  final bool isActive;

  /// Invited, but has not signed in yet.
  final bool isPending;
  final DateTime? lastLoginAt;
}

/// One of the signed-in user's devices.
@immutable
class DeviceSession {
  const DeviceSession({
    required this.id,
    required this.signedInAt,
    required this.lastActiveAt,
    required this.isCurrent,
    this.deviceName,
  });

  factory DeviceSession.fromJson(Map<String, dynamic> json) => DeviceSession(
    id: json['id'] as String,
    deviceName: json['deviceName'] as String?,
    signedInAt: DateTime.parse(json['signedInAt'] as String),
    lastActiveAt: DateTime.parse(json['lastActiveAt'] as String),
    isCurrent: json['isCurrent'] as bool,
  );

  final String id;
  final String? deviceName;
  final DateTime signedInAt;
  final DateTime lastActiveAt;
  final bool isCurrent;
}
