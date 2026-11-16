import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../../app/theme/tokens.dart';

/// Text field with a persistent label above it (design system §5): the label stays visible
/// while typing, and errors appear directly below the field.
class LabeledField extends StatelessWidget {
  const LabeledField({
    super.key,
    required this.label,
    required this.controller,
    this.hint,
    this.errorText,
    this.validator,
    this.keyboardType,
    this.textInputAction,
    this.autofillHints,
    this.obscureText = false,
    this.suffix,
    this.enabled = true,
    this.onSubmitted,
    this.inputFormatters,
    this.helperText,
  });

  final String label;
  final TextEditingController controller;
  final String? hint;
  final String? errorText;
  final String? helperText;
  final FormFieldValidator<String>? validator;
  final TextInputType? keyboardType;
  final TextInputAction? textInputAction;
  final Iterable<String>? autofillHints;
  final bool obscureText;
  final Widget? suffix;
  final bool enabled;
  final ValueChanged<String>? onSubmitted;
  final List<TextInputFormatter>? inputFormatters;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        ExcludeSemantics(
          child: Text(
            label,
            style: theme.textTheme.labelMedium?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
        ),
        const SizedBox(height: Space.sm),
        // Screen readers announce the label with the field even though it is drawn above it.
        Semantics(
          label: label,
          child: TextFormField(
            controller: controller,
            enabled: enabled,
            validator: validator,
            keyboardType: keyboardType,
            textInputAction: textInputAction,
            autofillHints: autofillHints,
            obscureText: obscureText,
            autocorrect: false,
            enableSuggestions: !obscureText,
            onFieldSubmitted: onSubmitted,
            inputFormatters: inputFormatters,
            style: theme.textTheme.bodyLarge,
            decoration: InputDecoration(
              hintText: hint,
              errorText: errorText,
              helperText: helperText,
              helperMaxLines: 3,
              suffixIcon: suffix,
            ),
          ),
        ),
      ],
    );
  }
}
