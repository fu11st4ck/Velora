import 'package:flutter/foundation.dart';

import '../api/failure.dart';

enum Role {
  owner,
  manager,
  sales;

  static Role parse(String value) => switch (value) {
    'OWNER' => Role.owner,
    'MANAGER' => Role.manager,
    'SALES' => Role.sales,
    _ => throw FormatException('Unknown role "$value"'),
  };

  String get label => switch (this) {
    Role.owner => 'Owner',
    Role.manager => 'Manager',
    Role.sales => 'Sales',
  };
}

@immutable
class TaxRate {
  const TaxRate({required this.id, required this.name, required this.rateBp});

  factory TaxRate.fromJson(Map<String, dynamic> json) => TaxRate(
    id: json['id'] as String,
    name: json['name'] as String,
    rateBp: json['rateBp'] as int,
  );

  final String id;
  final String name;
  final int rateBp;
}

/// Organization settings the app needs for formatting and defaults. Never hardcoded in the app.
@immutable
class OrgSettings {
  const OrgSettings({
    required this.currencyCode,
    required this.currencyExponent,
    required this.timezone,
    required this.locale,
    required this.defaultCreditDays,
    required this.quotationValidityDays,
    required this.lowStockThreshold,
    required this.allowOfflineSales,
    this.maxMarkupBp,
    this.defaultTaxRate,
  });

  factory OrgSettings.fromJson(Map<String, dynamic> json) => OrgSettings(
    currencyCode: json['currencyCode'] as String,
    currencyExponent: json['currencyExponent'] as int,
    timezone: json['timezone'] as String,
    locale: json['locale'] as String,
    defaultCreditDays: json['defaultCreditDays'] as int,
    quotationValidityDays: json['quotationValidityDays'] as int,
    lowStockThreshold: json['lowStockThreshold'] as int,
    allowOfflineSales: json['allowOfflineSales'] as bool,
    maxMarkupBp: json['maxMarkupBp'] as int?,
    defaultTaxRate: json['defaultTaxRate'] == null
        ? null
        : TaxRate.fromJson(json['defaultTaxRate'] as Map<String, dynamic>),
  );

  final String currencyCode;
  final int currencyExponent;
  final String timezone;
  final String locale;
  final int defaultCreditDays;
  final int quotationValidityDays;
  final int lowStockThreshold;
  final bool allowOfflineSales;

  /// Absent for the sales role: the server does not send pricing policy to it.
  final int? maxMarkupBp;
  final TaxRate? defaultTaxRate;
}

/// The signed-in user as returned by `GET /auth/me`.
@immutable
class Me {
  const Me({
    required this.userId,
    required this.fullName,
    required this.email,
    required this.memberId,
    required this.role,
    required this.organizationId,
    required this.organizationName,
    required this.permissions,
    required this.settings,
  });

  factory Me.fromJson(Map<String, dynamic> json) {
    final user = json['user'] as Map<String, dynamic>;
    final membership = json['membership'] as Map<String, dynamic>;
    final organization = membership['organization'] as Map<String, dynamic>;
    return Me(
      userId: user['id'] as String,
      fullName: user['fullName'] as String,
      email: user['email'] as String,
      memberId: membership['memberId'] as String,
      role: Role.parse(membership['role'] as String),
      organizationId: organization['id'] as String,
      organizationName: organization['name'] as String,
      permissions: (json['permissions'] as List<dynamic>)
          .cast<String>()
          .toSet(),
      settings: OrgSettings.fromJson(json['settings'] as Map<String, dynamic>),
    );
  }

  final String userId;
  final String fullName;
  final String email;
  final String memberId;
  final Role role;
  final String organizationId;
  final String organizationName;
  final Set<String> permissions;
  final OrgSettings settings;

  String get firstName => fullName.trim().split(RegExp(r'\s+')).first;

  /// UI affordance only — the server enforces every permission.
  bool can(String permission) => permissions.contains(permission);
}

sealed class SessionState {
  const SessionState();
}

/// Start-up: stored tokens are being checked.
class SessionLoading extends SessionState {
  const SessionLoading();
}

class SignedOut extends SessionState {
  const SignedOut({this.expired = false});

  /// True when the server ended the session (as opposed to the user signing out).
  final bool expired;
}

class SignedIn extends SessionState {
  const SignedIn(this.me);
  final Me me;
}

/// Tokens exist but the profile could not be loaded (for example, offline at start-up).
class SessionUnavailable extends SessionState {
  const SessionUnavailable(this.failure);
  final Failure failure;
}
