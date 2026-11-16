import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../../app/router/routes.dart';
import '../../../app/theme/tokens.dart';
import '../../../core/api/failure.dart';
import '../../../core/api/failure_messages.dart';
import '../../../core/auth/session.dart';
import '../../../core/auth/session_controller.dart';
import '../../../core/widgets/labeled_field.dart';
import '../../../core/widgets/notice.dart';
import '../../../core/widgets/primary_button.dart';
import 'auth_scaffold.dart';
import 'validators.dart';

/// A1 Login (docs/mobile-screen-specifications.md).
class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _form = GlobalKey<FormState>();
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _obscure = true;
  bool _busy = false;
  Failure? _failure;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_busy) return;
    setState(() => _failure = null);
    if (!_form.currentState!.validate()) return;
    setState(() => _busy = true);
    try {
      await ref
          .read(sessionControllerProvider.notifier)
          .signIn(email: _email.text, password: _password.text);
      // On success the router redirects away from this screen.
    } on Failure catch (failure) {
      if (mounted) setState(() => _failure = failure);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final session = ref.watch(sessionControllerProvider);
    final expired = session is SignedOut && session.expired;
    return AuthScaffold(
      title: 'Sign in to Velora',
      subtitle: 'Sales & Inventory',
      children: [
        if (_failure != null) ...[
          Notice(message: describeFailure(_failure!)),
          const SizedBox(height: Space.lg),
        ] else if (expired) ...[
          const Notice(
            message: 'Your session has ended. Please sign in again.',
            tone: StatusTone.warning,
          ),
          const SizedBox(height: Space.lg),
        ],
        Form(
          key: _form,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              LabeledField(
                key: const Key('login-email'),
                label: 'Email',
                controller: _email,
                hint: 'you@company.com',
                keyboardType: TextInputType.emailAddress,
                textInputAction: TextInputAction.next,
                autofillHints: const [
                  AutofillHints.username,
                  AutofillHints.email,
                ],
                validator: Validators.email,
                enabled: !_busy,
              ),
              const SizedBox(height: Space.lg),
              LabeledField(
                key: const Key('login-password'),
                label: 'Password',
                controller: _password,
                obscureText: _obscure,
                textInputAction: TextInputAction.done,
                autofillHints: const [AutofillHints.password],
                validator: Validators.requiredPassword,
                enabled: !_busy,
                onSubmitted: (_) => _submit(),
                suffix: IconButton(
                  tooltip: _obscure ? 'Show password' : 'Hide password',
                  icon: Icon(
                    _obscure
                        ? Icons.visibility_outlined
                        : Icons.visibility_off_outlined,
                  ),
                  onPressed: () => setState(() => _obscure = !_obscure),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: Space.xxl),
        PrimaryButton(
          key: const Key('login-submit'),
          label: 'Sign in',
          busy: _busy,
          onPressed: _submit,
        ),
        const SizedBox(height: Space.sm),
        TextButton(
          onPressed: _busy ? null : () => context.push(Routes.forgotPassword),
          child: const Text('Forgot password?'),
        ),
      ],
    );
  }
}
