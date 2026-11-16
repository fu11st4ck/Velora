import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../../../app/theme/tokens.dart';
import '../../../core/api/failure.dart';
import '../../../core/api/failure_messages.dart';
import '../../../core/widgets/labeled_field.dart';
import '../../../core/widgets/notice.dart';
import '../../../core/widgets/primary_button.dart';
import '../../../core/widgets/sections.dart';
import '../../auth/data/auth_api.dart';

/// Changes the signed-in user's password. Their other devices are signed out by the server.
class ChangePasswordScreen extends ConsumerStatefulWidget {
  const ChangePasswordScreen({super.key});

  @override
  ConsumerState<ChangePasswordScreen> createState() =>
      _ChangePasswordScreenState();
}

class _ChangePasswordScreenState extends ConsumerState<ChangePasswordScreen> {
  final _form = GlobalKey<FormState>();
  final _current = TextEditingController();
  final _next = TextEditingController();
  final _confirm = TextEditingController();
  bool _busy = false;
  bool _show = false;
  Failure? _failure;

  @override
  void dispose() {
    _current.dispose();
    _next.dispose();
    _confirm.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_busy) return;
    setState(() => _failure = null);
    if (!_form.currentState!.validate()) return;
    final navigator = Navigator.of(context);
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _busy = true);
    try {
      await ref
          .read(authApiProvider)
          .changePassword(
            currentPassword: _current.text,
            newPassword: _next.text,
          );
      messenger
        ..hideCurrentSnackBar()
        ..showSnackBar(
          const SnackBar(
            content: Text(
              'Password changed. Your other devices were signed out.',
            ),
          ),
        );
      navigator.pop();
    } on Failure catch (failure) {
      if (mounted) setState(() => _failure = failure);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final toggle = IconButton(
      tooltip: _show ? 'Hide passwords' : 'Show passwords',
      icon: Icon(
        _show ? Icons.visibility_off_outlined : Icons.visibility_outlined,
      ),
      onPressed: () => setState(() => _show = !_show),
    );
    return Scaffold(
      appBar: AppBar(title: const Text('Change password')),
      bottomNavigationBar: PinnedBar(
        child: PrimaryButton(
          key: const Key('change-password-submit'),
          label: 'Change password',
          busy: _busy,
          onPressed: _submit,
        ),
      ),
      body: Form(
        key: _form,
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(Space.lg),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (_failure != null) ...[
                Notice(
                  key: const Key('change-password-error'),
                  message: describeFailure(_failure!),
                ),
                const SizedBox(height: Space.lg),
              ],
              LabeledField(
                key: const Key('current-password'),
                label: 'Current password',
                controller: _current,
                obscureText: !_show,
                enabled: !_busy,
                autofillHints: const [AutofillHints.password],
                suffix: toggle,
                validator: (v) =>
                    (v ?? '').isEmpty ? 'Enter your current password.' : null,
              ),
              const SizedBox(height: Space.lg),
              LabeledField(
                key: const Key('new-password'),
                label: 'New password',
                controller: _next,
                obscureText: !_show,
                enabled: !_busy,
                autofillHints: const [AutofillHints.newPassword],
                helperText: 'At least 10 characters.',
                validator: (v) {
                  final value = v ?? '';
                  if (value.length < 10) return 'Use at least 10 characters.';
                  if (value.length > 200) return 'Use at most 200 characters.';
                  if (value == _current.text) {
                    return 'Choose a password different from the current one.';
                  }
                  return null;
                },
              ),
              const SizedBox(height: Space.lg),
              LabeledField(
                key: const Key('confirm-password'),
                label: 'New password again',
                controller: _confirm,
                obscureText: !_show,
                enabled: !_busy,
                autofillHints: const [AutofillHints.newPassword],
                validator: (v) =>
                    v == _next.text ? null : 'The two passwords do not match.',
              ),
            ],
          ),
        ),
      ),
    );
  }
}
