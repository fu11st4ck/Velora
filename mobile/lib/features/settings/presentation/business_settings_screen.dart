import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../../app/router/routes.dart';
import '../../../app/theme/tokens.dart';
import '../../../core/api/failure.dart';
import '../../../core/api/failure_messages.dart';
import '../../../core/auth/session_controller.dart';
import '../../../core/widgets/labeled_field.dart';
import '../../../core/widgets/notice.dart';
import '../../../core/widgets/primary_button.dart';
import '../../../core/widgets/sections.dart';
import '../../../core/widgets/state_views.dart';
import '../data/organization.dart';
import '../data/settings_api.dart';
import 'percent.dart';

/// H3 Business settings. The owner edits; managers see the same values read-only.
class BusinessSettingsScreen extends ConsumerWidget {
  const BusinessSettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final organization = ref.watch(organizationProvider);
    return switch (organization) {
      AsyncData(:final value) => _SettingsForm(organization: value),
      _ => Scaffold(
        appBar: AppBar(title: const Text('Business settings')),
        body: AsyncValueView<Organization>(
          value: organization,
          onRetry: () => ref.invalidate(organizationProvider),
          data: (_) => const SizedBox.shrink(),
        ),
      ),
    };
  }
}

class _SettingsForm extends ConsumerStatefulWidget {
  const _SettingsForm({required this.organization});
  final Organization organization;

  @override
  ConsumerState<_SettingsForm> createState() => _SettingsFormState();
}

class _SettingsFormState extends ConsumerState<_SettingsForm> {
  final _form = GlobalKey<FormState>();
  late Organization _saved = widget.organization;
  late final Map<String, TextEditingController> _c = {
    for (final e in _textOf(_saved).entries)
      e.key: TextEditingController(text: e.value),
  };
  bool _busy = false;
  Failure? _failure;

  static const _percentFields = {
    'maxMarkupBp',
    'defaultMarkupBp',
    'defaultMinMarkupBp',
  };
  static const _wholeFields = {
    'defaultCreditDays',
    'quotationValidityDays',
    'lowStockThreshold',
  };
  static const _requiredFields = {'name', 'currencyCode', 'timezone'};

  /// Every editable setting as the text its field shows.
  static Map<String, String> _textOf(Organization o) => {
    'name': o.name,
    'legalName': o.legalName ?? '',
    'taxRegistrationNumber': o.taxRegistrationNumber ?? '',
    'phone': o.phone ?? '',
    'email': o.email ?? '',
    'addressLine': o.addressLine ?? '',
    'city': o.city ?? '',
    'countryCode': o.countryCode ?? '',
    'invoiceFooter': o.invoiceFooter ?? '',
    'currencyCode': o.currencyCode,
    'timezone': o.timezone,
    'defaultCreditDays': '${o.defaultCreditDays}',
    'quotationValidityDays': '${o.quotationValidityDays}',
    'lowStockThreshold': '${o.lowStockThreshold}',
    if (o.maxMarkupBp != null) 'maxMarkupBp': percentText(o.maxMarkupBp!),
    if (o.defaultMarkupBp != null)
      'defaultMarkupBp': percentText(o.defaultMarkupBp!),
    if (o.defaultMinMarkupBp != null)
      'defaultMinMarkupBp': percentText(o.defaultMinMarkupBp!),
  };

  @override
  void dispose() {
    for (final c in _c.values) {
      c.dispose();
    }
    super.dispose();
  }

  /// What differs from the saved settings, in the form the API takes.
  Map<String, Object?> _changes() {
    final before = _textOf(_saved);
    final changes = <String, Object?>{};
    for (final MapEntry(:key, :value) in _c.entries) {
      final text = value.text.trim();
      if (text == before[key]) continue;
      changes[key] = _percentFields.contains(key)
          ? parsePercent(text)
          : _wholeFields.contains(key)
          ? int.parse(text)
          : text.isEmpty
          ? null
          : (key == 'currencyCode' || key == 'countryCode')
          ? text.toUpperCase()
          : text;
    }
    return changes;
  }

  Future<void> _save() async {
    if (_busy) return;
    setState(() => _failure = null);
    if (!_form.currentState!.validate()) return;
    final changes = _changes();
    final messenger = ScaffoldMessenger.of(context);
    if (changes.isEmpty) {
      messenger
        ..hideCurrentSnackBar()
        ..showSnackBar(const SnackBar(content: Text('Nothing was changed.')));
      return;
    }
    setState(() => _busy = true);
    try {
      final updated = await ref
          .read(settingsApiProvider)
          .updateOrganization(changes);
      // Currency, credit period and the other defaults reach the rest of the app through the profile.
      await ref.read(sessionControllerProvider.notifier).refreshProfile();
      if (!mounted) return;
      setState(() => _saved = updated);
      ref.invalidate(organizationProvider);
      messenger
        ..hideCurrentSnackBar()
        ..showSnackBar(const SnackBar(content: Text('Settings saved.')));
    } on Failure catch (failure) {
      if (mounted) setState(() => _failure = failure);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String _describe(Failure failure) {
    if (failure is ValidationFailure) {
      if (failure.fields.containsKey('currencyCode')) {
        return 'That is not a known currency code. Use three letters, for example AED.';
      }
      if (failure.fields.containsKey('timezone')) {
        return 'That is not a known time zone. Use a name such as Asia/Dubai.';
      }
    }
    return describeFailure(failure);
  }

  String? _max(String? v, int max) =>
      (v ?? '').trim().length > max ? 'Use at most $max characters.' : null;

  Widget _text(
    String key,
    String label, {
    required bool canEdit,
    int max = 120,
    String? helper,
    TextInputType? keyboard,
    FormFieldValidator<String>? validator,
  }) => Padding(
    padding: const EdgeInsets.only(top: Space.lg),
    child: LabeledField(
      key: Key('setting-$key'),
      label: label,
      controller: _c[key]!,
      helperText: helper,
      keyboardType: keyboard,
      enabled: canEdit && !_busy,
      validator: (v) {
        if (_requiredFields.contains(key) && (v ?? '').trim().isEmpty) {
          return 'Required.';
        }
        return validator?.call(v) ?? _max(v, max);
      },
    ),
  );

  Widget _whole(
    String key,
    String label, {
    required bool canEdit,
    required int min,
    required int max,
    String? helper,
  }) => Padding(
    padding: const EdgeInsets.only(top: Space.lg),
    child: LabeledField(
      key: Key('setting-$key'),
      label: label,
      controller: _c[key]!,
      helperText: helper,
      keyboardType: TextInputType.number,
      inputFormatters: [FilteringTextInputFormatter.digitsOnly],
      enabled: canEdit && !_busy,
      validator: (v) {
        final n = int.tryParse((v ?? '').trim());
        return n == null || n < min || n > max
            ? 'Enter a whole number from $min to $max.'
            : null;
      },
    ),
  );

  Widget _percent(String key, String label, {required bool canEdit}) => Padding(
    padding: const EdgeInsets.only(top: Space.lg),
    child: LabeledField(
      key: Key('setting-$key'),
      label: label,
      controller: _c[key]!,
      keyboardType: const TextInputType.numberWithOptions(decimal: true),
      inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]'))],
      enabled: canEdit && !_busy,
      validator: (v) {
        final bp = parsePercent(v ?? '');
        return bp == null || bp > 100000
            ? 'Enter a percentage from 0 to 1000, with up to two decimals.'
            : null;
      },
    ),
  );

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final canEdit = ref.watch(
      currentUserProvider.select((me) => me?.can('settings.manage') ?? false),
    );
    final showsPolicy = _saved.maxMarkupBp != null;
    final regionalEditable = canEdit && !_saved.regionalSettingsLocked;
    final muted = theme.textTheme.bodyMedium?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );

    return Scaffold(
      appBar: AppBar(title: const Text('Business settings')),
      bottomNavigationBar: canEdit
          ? PinnedBar(
              child: PrimaryButton(
                key: const Key('save-settings'),
                label: 'Save settings',
                busy: _busy,
                onPressed: _save,
              ),
            )
          : null,
      body: Form(
        key: _form,
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(Space.lg),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (!canEdit) ...[
                const Notice(
                  message: 'Only the owner can change these settings.',
                  tone: StatusTone.neutral,
                  icon: Icons.lock_outline,
                ),
                const SizedBox(height: Space.lg),
              ],
              if (_failure != null) ...[
                Notice(
                  key: const Key('settings-error'),
                  message: _describe(_failure!),
                ),
                const SizedBox(height: Space.lg),
              ],
              SectionCard(
                title: 'Company',
                children: [
                  Text('Printed on quotations and invoices.', style: muted),
                  _text('name', 'Business name', canEdit: canEdit),
                  _text(
                    'legalName',
                    'Legal name (optional)',
                    canEdit: canEdit,
                    max: 160,
                  ),
                  _text(
                    'taxRegistrationNumber',
                    'Tax registration number (optional)',
                    canEdit: canEdit,
                    max: 40,
                  ),
                  _text(
                    'phone',
                    'Phone (optional)',
                    canEdit: canEdit,
                    max: 30,
                    keyboard: TextInputType.phone,
                  ),
                  _text(
                    'email',
                    'Email (optional)',
                    canEdit: canEdit,
                    max: 254,
                    keyboard: TextInputType.emailAddress,
                    validator: (v) {
                      final text = (v ?? '').trim();
                      return text.isEmpty ||
                              RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')
                                  .hasMatch(text)
                          ? null
                          : 'Enter a valid email address.';
                    },
                  ),
                  _text(
                    'addressLine',
                    'Address (optional)',
                    canEdit: canEdit,
                    max: 240,
                  ),
                  _text('city', 'City (optional)', canEdit: canEdit, max: 80),
                  _text(
                    'countryCode',
                    'Country code (optional)',
                    canEdit: canEdit,
                    helper: 'Two letters, for example AE. Local phone numbers are read as numbers of this country.',
                    validator: (v) {
                      final text = (v ?? '').trim();
                      return text.isEmpty ||
                              RegExp(r'^[A-Za-z]{2}$').hasMatch(text)
                          ? null
                          : 'Use two letters, for example AE.';
                    },
                  ),
                  _text(
                    'invoiceFooter',
                    'Invoice footer (optional)',
                    canEdit: canEdit,
                    max: 400,
                    helper: 'For example payment details or a thank-you line.',
                  ),
                ],
              ),
              const SizedBox(height: Space.lg),
              SectionCard(
                title: 'Regional',
                children: [
                  if (_saved.regionalSettingsLocked)
                    Text(
                      'Fixed, because quotations or invoices already use them.',
                      key: const Key('regional-locked'),
                      style: muted,
                    )
                  else
                    Text(
                      'These can be changed only until the first quotation or invoice.',
                      style: muted,
                    ),
                  _text(
                    'currencyCode',
                    'Currency',
                    canEdit: regionalEditable,
                    validator: (v) =>
                        RegExp(r'^[A-Za-z]{3}$').hasMatch((v ?? '').trim())
                        ? null
                        : 'Use the three-letter code, for example AED.',
                  ),
                  _text(
                    'timezone',
                    'Time zone',
                    canEdit: regionalEditable,
                    max: 64,
                    helper: 'Decides which day a sale belongs to.',
                  ),
                ],
              ),
              const SizedBox(height: Space.lg),
              SectionCard(
                title: 'Sales rules',
                children: [
                  if (showsPolicy) ...[
                    _percent(
                      'maxMarkupBp',
                      'Highest markup allowed (%)',
                      canEdit: canEdit,
                    ),
                    _percent(
                      'defaultMarkupBp',
                      'Default markup for new products (%)',
                      canEdit: canEdit,
                    ),
                    _percent(
                      'defaultMinMarkupBp',
                      'Default lowest markup for new products (%)',
                      canEdit: canEdit,
                    ),
                  ],
                  _whole(
                    'defaultCreditDays',
                    'Credit period (days)',
                    canEdit: canEdit,
                    min: 0,
                    max: 365,
                    helper: 'When an unpaid balance becomes due.',
                  ),
                  _whole(
                    'quotationValidityDays',
                    'Quotations valid for (days)',
                    canEdit: canEdit,
                    min: 1,
                    max: 365,
                  ),
                  _whole(
                    'lowStockThreshold',
                    'Low-stock level (pieces)',
                    canEdit: canEdit,
                    min: 0,
                    max: 1000000,
                    helper: 'Used for products without a level of their own.',
                  ),
                ],
              ),
              const SizedBox(height: Space.lg),
              Card(
                clipBehavior: Clip.antiAlias,
                child: ListTile(
                  key: const Key('open-tax-rates'),
                  leading: const Icon(Icons.percent),
                  title: const Text('Tax rates'),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => context.push(Routes.taxRates),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
