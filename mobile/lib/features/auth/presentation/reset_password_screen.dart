import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../../app/router/routes.dart';
import '../../../app/theme/tokens.dart';
import '../../../core/api/failure.dart';
import '../../../core/api/failure_messages.dart';
import '../../../core/widgets/labeled_field.dart';
import '../../../core/widgets/notice.dart';
import '../../../core/widgets/primary_button.dart';
import '../data/auth_api.dart';
import 'auth_scaffold.dart';
import 'validators.dart';

/// A3 Reset password, opened from the emailed link (`velora://reset-password?token=…`).
class ResetPasswordScreen extends ConsumerStatefulWidget {
  const ResetPasswordScreen({super.key, required this.token});
  final String? token;

  @override
  ConsumerState<ResetPasswordScreen> createState() =>
      _ResetPasswordScreenState();
}

class _ResetPasswordScreenState extends ConsumerState<ResetPasswordScreen> {
  final _form = GlobalKey<FormState>();
  final _password = TextEditingController();
  final _confirm = TextEditingController();
  bool _busy = false;
  bool _done = false;
  Failure? _failure;

  @override
  void dispose() {
    _password.dispose();
    _confirm.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_busy) return;
    setState(() => _failure = null);
    if (!_form.currentState!.validate()) return;
    setState(() => _busy = true);
    try {
      await ref
          .read(authApiProvider)
          .resetPassword(token: widget.token!, newPassword: _password.text);
      if (mounted) setState(() => _done = true);
    } on Failure catch (failure) {
      if (mounted) setState(() => _failure = failure);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final token = widget.token;
    if (token == null || token.isEmpty) {
      return AuthScaffold(
        title: 'Link not valid',
        children: [
          const Notice(
            message: 'This reset link is incomplete. Request a new one.',
          ),
          const SizedBox(height: Space.xxl),
          OutlinedButton(
            onPressed: () => context.go(Routes.forgotPassword),
            child: const Text('Request a new link'),
          ),
        ],
      );
    }
    if (_done) {
      return AuthScaffold(
        title: 'Password changed',
        children: [
          const Notice(
            message:
                'Your password was changed and all devices were signed out.',
            tone: StatusTone.success,
          ),
          const SizedBox(height: Space.xxl),
          PrimaryButton(
            label: 'Sign in',
            onPressed: () => context.go(Routes.login),
          ),
        ],
      );
    }
    return AuthScaffold(
      title: 'Choose a new password',
      children: [
        if (_failure != null) ...[
          Notice(message: describeFailure(_failure!)),
          const SizedBox(height: Space.lg),
        ],
        Form(
          key: _form,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              LabeledField(
                key: const Key('reset-password'),
                label: 'New password',
                controller: _password,
                obscureText: true,
                textInputAction: TextInputAction.next,
                autofillHints: const [AutofillHints.newPassword],
                helperText: 'At least 10 characters. Avoid common passwords and your email name.',
                validator: Validators.newPassword,
                enabled: !_busy,
              ),
              const SizedBox(height: Space.lg),
              LabeledField(
                key: const Key('reset-confirm'),
                label: 'Confirm new password',
                controller: _confirm,
                obscureText: true,
                textInputAction: TextInputAction.done,
                autofillHints: const [AutofillHints.newPassword],
                validator: (v) =>
                    v == _password.text ? null : 'The passwords do not match.',
                enabled: !_busy,
                onSubmitted: (_) => _submit(),
              ),
            ],
          ),
        ),
        const SizedBox(height: Space.xxl),
        PrimaryButton(
          key: const Key('reset-submit'),
          label: 'Change password',
          busy: _busy,
          onPressed: _submit,
        ),
      ],
    );
  }
}
