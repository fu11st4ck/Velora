import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../../../app/theme/tokens.dart';
import '../../../core/api/failure.dart';
import '../../../core/api/failure_messages.dart';
import '../../../core/api/idempotency.dart';
import '../../../core/widgets/labeled_field.dart';
import '../../../core/widgets/notice.dart';
import '../../../core/widgets/primary_button.dart';
import '../../../core/widgets/sections.dart';
import '../../../core/widgets/state_views.dart';
import '../data/customer.dart';
import '../../../core/offline/sync_engine.dart';
import '../data/customers_api.dart';
import 'customer_controllers.dart';

/// E3 New / Edit customer. Pops with the saved [Customer], so callers such as the customer
/// picker can use the result directly.
class CustomerFormScreen extends ConsumerWidget {
  const CustomerFormScreen({super.key, this.customerId, this.initialText});
  final String? customerId;

  /// Search text that led here; pre-fills the name or the mobile number.
  final String? initialText;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final id = customerId;
    if (id == null) return _CustomerForm(initialText: initialText);
    final customer = ref.watch(customerProvider(id));
    return customer.hasValue
        ? _CustomerForm(existing: customer.value)
        : Scaffold(
            appBar: AppBar(title: const Text('Edit customer')),
            body: AsyncValueView<Customer>(
              value: customer,
              onRetry: () => ref.invalidate(customerProvider(id)),
              data: (_) => const SizedBox.shrink(),
            ),
          );
  }
}

class _CustomerForm extends ConsumerStatefulWidget {
  const _CustomerForm({this.existing, this.initialText});
  final Customer? existing;
  final String? initialText;

  @override
  ConsumerState<_CustomerForm> createState() => _CustomerFormState();
}

final _phoneLike = RegExp(r'^[+\d][\d\s().-]{5,}$');
final _email = RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$');

class _CustomerFormState extends ConsumerState<_CustomerForm> {
  final _form = GlobalKey<FormState>();
  late final Customer? _existing = widget.existing;
  late final bool _initialIsPhone = _phoneLike.hasMatch(
    widget.initialText?.trim() ?? '',
  );
  late final _name = TextEditingController(
    text: _existing?.name ?? (_initialIsPhone ? null : widget.initialText),
  );
  late final _company = TextEditingController(text: _existing?.company);
  late final _mobile = TextEditingController(
    text: _existing?.mobile ?? (_initialIsPhone ? widget.initialText : null),
  );
  late final _emailField = TextEditingController(text: _existing?.email);
  late final _address = TextEditingController(text: _existing?.address);
  late final _trn = TextEditingController(
    text: _existing?.taxRegistrationNumber,
  );
  late final _notes = TextEditingController(text: _existing?.notes);

  String _idempotencyKey = newIdempotencyKey();
  bool _busy = false;
  bool _dirty = false;
  Failure? _failure;
  String? _mobileError;

  bool get _isEdit => _existing != null;

  @override
  void dispose() {
    for (final c in [
      _name,
      _company,
      _mobile,
      _emailField,
      _address,
      _trn,
      _notes,
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  String? _nullIfBlank(TextEditingController c) =>
      c.text.trim().isEmpty ? null : c.text.trim();

  String? _max(String? v, int max) =>
      (v ?? '').trim().length > max ? 'Use at most $max characters.' : null;

  /// When the number already belongs to a customer, asks whether to use that customer instead.
  /// Returns the existing customer to use, or null to go ahead and create a new one.
  /// Throws [_Cancelled] when the user backs out.
  Future<Customer?> _resolveDuplicate(String mobile) async {
    final List<Customer> matches;
    try {
      matches = await ref.read(customersApiProvider).findByMobile(mobile);
    } on Failure {
      return null; // The check is a convenience; the save below reports any real problem.
    }
    if (matches.isEmpty || !mounted) return null;
    final match = matches.first;
    // The form is idle while the question is on screen.
    setState(() => _busy = false);
    final choice = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('This number is already saved'),
        content: Text(
          [match.displayName, ?match.secondaryName, ?match.mobile].join('\n'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop('new'),
            child: const Text('Create new anyway'),
          ),
          TextButton(
            key: const Key('use-existing'),
            onPressed: () => Navigator.of(context).pop('existing'),
            child: const Text('Use existing'),
          ),
        ],
      ),
    );
    if (choice == 'existing') return match;
    if (choice != 'new') throw const _Cancelled();
    if (mounted) setState(() => _busy = true);
    return null;
  }

  Future<void> _submit() async {
    if (_busy) return;
    setState(() {
      _failure = null;
      _mobileError = null;
    });
    if (!_form.currentState!.validate()) return;

    final input = CustomerInput(
      name: _nullIfBlank(_name),
      company: _nullIfBlank(_company),
      mobile: _nullIfBlank(_mobile),
      email: _nullIfBlank(_emailField),
      address: _nullIfBlank(_address),
      taxRegistrationNumber: _nullIfBlank(_trn),
      notes: _nullIfBlank(_notes),
    );
    final api = ref.read(customersApiProvider);
    final navigator = Navigator.of(context);
    final messenger = ScaffoldMessenger.of(context);

    setState(() => _busy = true);
    try {
      final Customer saved;
      if (_isEdit) {
        saved = await api.update(_existing!.id, input);
      } else {
        final existing = input.mobile == null
            ? null
            : await _resolveDuplicate(input.mobile!);
        if (existing != null) {
          _dirty = false;
          navigator.pop(existing);
          return;
        }
        saved = await api.create(input, idempotencyKey: _idempotencyKey);
      }
      if (!mounted) return;
      refreshCustomerData(ref, saved.id);
      messenger.showSnackBar(
        SnackBar(
          content: Text(
            _isEdit
                ? '${saved.displayName} updated'
                : ref
                          .read(syncProvider.notifier)
                          .pendingCustomerOperation(saved.id) !=
                      null
                ? '${saved.displayName} saved on this device. They are sent when you are back online.'
                : '${saved.displayName} added',
          ),
        ),
      );
      _dirty = false;
      navigator.pop(saved);
    } on _Cancelled {
      // The user closed the duplicate prompt; stay on the form.
    } on Failure catch (failure) {
      if (!mounted) return;
      setState(() {
        if (failure is BusinessFailure || failure is ValidationFailure) {
          _idempotencyKey = newIdempotencyKey();
        }
        if (failure is ValidationFailure &&
            failure.fields['mobile'] == 'phone') {
          _mobileError = 'Enter a valid phone number. Include the country code for numbers abroad.';
        } else {
          _failure = failure;
        }
      });
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<bool> _confirmDiscard() async {
    final discard = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Discard changes?'),
        content: const Text('What you entered will not be saved.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Keep editing'),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Discard'),
          ),
        ],
      ),
    );
    return discard ?? false;
  }

  @override
  Widget build(BuildContext context) => PopScope(
    canPop: !_dirty,
    onPopInvokedWithResult: (didPop, _) async {
      if (didPop) return;
      final navigator = Navigator.of(context);
      if (await _confirmDiscard()) {
        _dirty = false;
        navigator.pop();
      }
    },
    child: Scaffold(
      appBar: AppBar(title: Text(_isEdit ? 'Edit customer' : 'New customer')),
      bottomNavigationBar: PinnedBar(
        child: PrimaryButton(
          key: const Key('save-customer'),
          label: _isEdit ? 'Save changes' : 'Save customer',
          busy: _busy,
          onPressed: _submit,
        ),
      ),
      body: Form(
        key: _form,
        onChanged: () => setState(() => _dirty = true),
        child: SingleChildScrollView(
          // Not a lazy list: every field must stay built so the whole form is validated.
          padding: const EdgeInsets.all(Space.lg),
          child: AutofillGroup(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (_failure != null) ...[
                  Notice(message: describeFailure(_failure!)),
                  const SizedBox(height: Space.lg),
                ],
                LabeledField(
                  key: const Key('field-name'),
                  label: 'Name',
                  controller: _name,
                  hint: 'Full name',
                  textInputAction: TextInputAction.next,
                  autofillHints: const [AutofillHints.name],
                  enabled: !_busy,
                  validator: (v) {
                    if ((v ?? '').trim().isEmpty &&
                        _company.text.trim().isEmpty) {
                      return 'Enter a name or a company.';
                    }
                    return _max(v, 160);
                  },
                ),
                const SizedBox(height: Space.lg),
                LabeledField(
                  key: const Key('field-company'),
                  label: 'Company',
                  controller: _company,
                  helperText: 'A name or a company is required.',
                  textInputAction: TextInputAction.next,
                  autofillHints: const [AutofillHints.organizationName],
                  enabled: !_busy,
                  validator: (v) => _max(v, 160),
                ),
                const SizedBox(height: Space.lg),
                LabeledField(
                  key: const Key('field-mobile'),
                  label: 'WhatsApp / mobile',
                  controller: _mobile,
                  hint: '+971 50 123 4567',
                  errorText: _mobileError,
                  keyboardType: TextInputType.phone,
                  textInputAction: TextInputAction.next,
                  autofillHints: const [AutofillHints.telephoneNumber],
                  enabled: !_busy,
                  validator: (v) {
                    final text = (v ?? '').trim();
                    if (text.isEmpty) return null;
                    return _phoneLike.hasMatch(text) && text.length <= 32
                        ? null
                        : 'Enter a valid phone number.';
                  },
                ),
                const SizedBox(height: Space.lg),
                LabeledField(
                  key: const Key('field-email'),
                  label: 'Email',
                  controller: _emailField,
                  keyboardType: TextInputType.emailAddress,
                  textInputAction: TextInputAction.next,
                  autofillHints: const [AutofillHints.email],
                  enabled: !_busy,
                  validator: (v) {
                    final text = (v ?? '').trim();
                    if (text.isEmpty) return null;
                    return _email.hasMatch(text)
                        ? _max(v, 254)
                        : 'Enter a valid email address.';
                  },
                ),
                const SizedBox(height: Space.lg),
                LabeledField(
                  key: const Key('field-address'),
                  label: 'Address',
                  controller: _address,
                  textInputAction: TextInputAction.next,
                  autofillHints: const [AutofillHints.fullStreetAddress],
                  enabled: !_busy,
                  validator: (v) => _max(v, 240),
                ),
                const SizedBox(height: Space.lg),
                LabeledField(
                  key: const Key('field-trn'),
                  label: 'Tax registration no.',
                  controller: _trn,
                  helperText: 'Printed on tax invoices for business customers.',
                  textInputAction: TextInputAction.next,
                  enabled: !_busy,
                  validator: (v) => _max(v, 40),
                ),
                const SizedBox(height: Space.lg),
                LabeledField(
                  key: const Key('field-notes'),
                  label: 'Notes',
                  controller: _notes,
                  helperText: 'Only visible to your team.',
                  textInputAction: TextInputAction.done,
                  enabled: !_busy,
                  validator: (v) => _max(v, 1000),
                ),
              ],
            ),
          ),
        ),
      ),
    ),
  );
}

class _Cancelled implements Exception {
  const _Cancelled();
}
