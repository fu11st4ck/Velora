import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../../app/theme/tokens.dart';
import '../../../core/api/failure.dart';
import '../../../core/api/failure_messages.dart';
import '../../../core/widgets/labeled_field.dart';
import '../../../core/widgets/notice.dart';
import '../../../core/widgets/primary_button.dart';
import '../data/auth_api.dart';
import 'auth_scaffold.dart';
import 'validators.dart';

/// A2 Forgot password. The confirmation never reveals whether the address has an account.
class ForgotPasswordScreen extends ConsumerStatefulWidget {
  const ForgotPasswordScreen({super.key});

  @override
  ConsumerState<ForgotPasswordScreen> createState() =>
      _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends ConsumerState<ForgotPasswordScreen> {
  final _form = GlobalKey<FormState>();
  final _email = TextEditingController();
  bool _busy = false;
  bool _sent = false;
  Failure? _failure;

  @override
  void dispose() {
    _email.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_busy) return;
    setState(() => _failure = null);
    if (!_form.currentState!.validate()) return;
    setState(() => _busy = true);
    try {
      await ref.read(authApiProvider).forgotPassword(_email.text.trim());
      if (mounted) setState(() => _sent = true);
    } on Failure catch (failure) {
      if (mounted) setState(() => _failure = failure);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_sent) {
      return AuthScaffold(
        showBack: true,
        title: 'Check your email',
        children: [
          const Notice(
            message: 'If that address has an account, a reset link is on its way. Open it on this phone.',
            tone: StatusTone.success,
          ),
          const SizedBox(height: Space.xxl),
          OutlinedButton(
            onPressed: () => context.pop(),
            child: const Text('Back to sign in'),
          ),
        ],
      );
    }
    return AuthScaffold(
      showBack: true,
      title: 'Reset your password',
      subtitle: 'Enter your email and we will send you a link to choose a new password.',
      children: [
        if (_failure != null) ...[
          Notice(message: describeFailure(_failure!)),
          const SizedBox(height: Space.lg),
        ],
        Form(
          key: _form,
          child: LabeledField(
            key: const Key('forgot-email'),
            label: 'Email',
            controller: _email,
            hint: 'you@company.com',
            keyboardType: TextInputType.emailAddress,
            textInputAction: TextInputAction.done,
            autofillHints: const [AutofillHints.email],
            validator: Validators.email,
            enabled: !_busy,
            onSubmitted: (_) => _submit(),
          ),
        ),
        const SizedBox(height: Space.xxl),
        PrimaryButton(
          key: const Key('forgot-submit'),
          label: 'Send reset link',
          busy: _busy,
          onPressed: _submit,
        ),
      ],
    );
  }
}
